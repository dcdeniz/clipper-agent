/**
 * {@link Transcriber} backed by Groq's Whisper API. Transcribes a source video's
 * local media file and maps the verbose JSON response to a {@link Transcript}.
 */
import Groq from 'groq-sdk';
import { createReadStream } from 'node:fs';
import { getConfig, requireValue } from '../config/index.js';
import type { Transcriber } from '../core/contracts.js';
import { createLogger } from '../core/logger.js';
import type { SourceVideo, Transcript, TranscriptSegment } from '../core/types.js';

const log = createLogger('transcribe');

/** Whisper model used for transcription (fast, accurate, timestamped). */
export const TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';

/** Shape of a `verbose_json` segment as returned by the Whisper API at runtime. */
interface VerboseSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

/** Shape of the `verbose_json` transcription response at runtime. */
interface VerboseTranscription {
  text?: unknown;
  language?: unknown;
  segments?: unknown;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class GroqWhisperTranscriber implements Transcriber {
  private client: Groq | undefined;

  /** Lazily construct the Groq client so the API key is only required on use. */
  private getClient(): Groq {
    if (!this.client) {
      const apiKey = requireValue(getConfig().llm.groqApiKey, 'GROQ_API_KEY');
      this.client = new Groq({ apiKey });
    }
    return this.client;
  }

  async transcribe(source: SourceVideo): Promise<Transcript> {
    const client = this.getClient();
    log.debug({ id: source.id, localPath: source.localPath }, 'transcribing source');

    const response = await client.audio.transcriptions.create({
      file: createReadStream(source.localPath),
      model: TRANSCRIBE_MODEL,
      response_format: 'verbose_json',
    });

    // The SDK types `create` as returning only `{ text }`; verbose_json adds
    // `language` and `segments` at runtime, so we read those defensively.
    const verbose = response as unknown as VerboseTranscription;

    const rawSegments = Array.isArray(verbose.segments) ? verbose.segments : [];
    const segments: TranscriptSegment[] = rawSegments.map((raw): TranscriptSegment => {
      const seg = raw as VerboseSegment;
      return {
        start: asNumber(seg.start),
        end: asNumber(seg.end),
        text: asString(seg.text).trim(),
      };
    });

    const fullText =
      asString(verbose.text).trim() ||
      segments
        .map((s) => s.text)
        .join(' ')
        .trim();

    const transcript: Transcript = {
      sourceId: source.id,
      language: asString(verbose.language) || 'unknown',
      segments,
      fullText,
    };
    log.info(
      { id: source.id, segments: transcript.segments.length, language: transcript.language },
      'transcribed source',
    );
    return transcript;
  }
}
