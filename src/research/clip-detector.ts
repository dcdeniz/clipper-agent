/**
 * Claude-backed implementation of the {@link ClipDetector} contract.
 *
 * Given a {@link Transcript}, asks Claude to identify the most clip-worthy
 * 10–20s windows for shortform (TikTok/Reels/Shorts). The model sees the
 * transcript segments *with timestamps* so it can choose real start/end times,
 * and is asked for structured JSON. The raw windows are then post-processed by
 * {@link normalizeWindows} to enforce the clip-length rule, score/limit filters,
 * sorting, and transcript-text attachment.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ClipDetector, DetectOptions } from '../core/contracts.js';
import type { ClipCandidate, Transcript } from '../core/types.js';
import { CLIP_MAX_SEC, CLIP_MIN_SEC } from '../core/types.js';
import { getConfig, requireValue } from '../config/index.js';
import { createLogger } from '../core/logger.js';
import type { RawWindow } from './normalize.js';
import { normalizeWindows } from './normalize.js';

const log = createLogger('research');

const SYSTEM_PROMPT = [
  'You are a viral shortform video editor. You are given a timestamped transcript',
  'of a long-form livestream or VOD. Your job is to find the most clip-worthy',
  `moments for TikTok, Instagram Reels, and YouTube Shorts. Each clip MUST be`,
  `between ${CLIP_MIN_SEC} and ${CLIP_MAX_SEC} seconds long.`,
  '',
  'Favor moments that are self-contained, high-energy, funny, surprising,',
  'emotionally charged, or controversial — anything that would make a viewer stop',
  'scrolling. Choose start and end times that land on natural sentence boundaries',
  'using the timestamps you are given.',
  '',
  'Respond with ONLY a JSON array (no prose, no markdown fences). Each element is',
  'an object: {"startSec": number, "endSec": number, "score": number, "reason": string}.',
  'startSec/endSec are in seconds. score is 0-100 (higher = more clip-worthy).',
  'reason is a short rationale. Return at most 20 candidates, best first.',
].join('\n');

/** Tunable construction options (mainly for testing / dependency injection). */
export interface ClaudeClipDetectorOptions {
  /** Inject a preconstructed Anthropic client (e.g. a mock in tests). */
  client?: Anthropic;
  /** Override the model id (defaults to config `llm.researchModel`). */
  model?: string;
  /** Max output tokens for the model response. */
  maxTokens?: number;
}

export class ClaudeClipDetector implements ClipDetector {
  private client: Anthropic | undefined;
  private readonly injectedClient: Anthropic | undefined;
  private readonly modelOverride: string | undefined;
  private readonly maxTokens: number;

  constructor(opts: ClaudeClipDetectorOptions = {}) {
    this.injectedClient = opts.client;
    this.modelOverride = opts.model;
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  /** Lazily construct (and cache) the Anthropic client so missing keys only fail on use. */
  private getClient(): Anthropic {
    if (this.injectedClient) return this.injectedClient;
    if (!this.client) {
      const apiKey = requireValue(getConfig().llm.anthropicApiKey, 'ANTHROPIC_API_KEY');
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  private get model(): string {
    return this.modelOverride ?? getConfig().llm.researchModel;
  }

  async detect(transcript: Transcript, opts: DetectOptions = {}): Promise<ClipCandidate[]> {
    if (transcript.segments.length === 0) {
      log.warn({ sourceId: transcript.sourceId }, 'empty transcript; no candidates');
      return [];
    }

    const userPrompt = buildUserPrompt(transcript);

    const response = await this.getClient().messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = extractText(response.content);
    const raw = parseWindows(text);
    log.debug(
      { sourceId: transcript.sourceId, rawCount: raw.length },
      'parsed raw windows from model',
    );

    const candidates = normalizeWindows(raw, transcript.sourceId, {
      limit: opts.limit,
      minScore: opts.minScore,
      transcript,
    });
    log.info(
      { sourceId: transcript.sourceId, candidateCount: candidates.length },
      'produced clip candidates',
    );
    return candidates;
  }
}

/** Build the timestamped transcript prompt fed to the model. */
export function buildUserPrompt(transcript: Transcript): string {
  const lines = transcript.segments.map((seg) => {
    const start = seg.start.toFixed(1);
    const end = seg.end.toFixed(1);
    return `[${start} - ${end}] ${seg.text.trim()}`;
  });
  return [
    `Language: ${transcript.language}`,
    `Source duration (last segment end): ${lastEnd(transcript).toFixed(1)}s`,
    '',
    'Transcript segments:',
    ...lines,
  ].join('\n');
}

function lastEnd(transcript: Transcript): number {
  let max = 0;
  for (const seg of transcript.segments) {
    if (seg.end > max) max = seg.end;
  }
  return max;
}

/** Pull the concatenated text out of the model's content blocks. */
function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('');
}

/**
 * Robustly parse a JSON array of windows from model output.
 *
 * Tolerates markdown code fences and leading/trailing prose by extracting the
 * first balanced `[ ... ]` span. Returns `[]` if nothing parseable is found, so
 * a malformed response degrades to "no candidates" rather than throwing.
 */
export function parseWindows(text: string): RawWindow[] {
  const json = extractJsonArray(text);
  if (json === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const windows: RawWindow[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const startSec = toNumber(obj.startSec);
    const endSec = toNumber(obj.endSec);
    const score = toNumber(obj.score);
    if (startSec === undefined || endSec === undefined || score === undefined) continue;
    windows.push({
      startSec,
      endSec,
      score,
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    });
  }
  return windows;
}

/** Extract the first balanced top-level JSON array substring, if any. */
function extractJsonArray(text: string): string | undefined {
  const start = text.indexOf('[');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
