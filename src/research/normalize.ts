/**
 * Pure post-processing for clip-window proposals returned by the research agent.
 *
 * These functions are deterministic and side-effect free so they can be unit
 * tested directly without mocking the LLM. They enforce the project clip-length
 * rule (10–20s), attach covered transcript text + ids, and sort by score.
 */
import { randomUUID } from 'node:crypto';
import type { ClipCandidate, Transcript } from '../core/types.js';
import { CLIP_MAX_SEC, CLIP_MIN_SEC, isValidClipLength, windowDurationSec } from '../core/types.js';

/** A raw window proposal as parsed from the model's JSON output. */
export interface RawWindow {
  startSec: number;
  endSec: number;
  /** Virality score, 0–100. */
  score: number;
  reason: string;
}

/**
 * Concatenate the transcript text of every segment that overlaps [startSec, endSec].
 *
 * A segment overlaps the window if it starts before the window ends and ends
 * after the window starts. Pure: depends only on its arguments.
 */
export function selectCandidateText(
  transcript: Transcript,
  startSec: number,
  endSec: number,
): string {
  const parts: string[] = [];
  for (const seg of transcript.segments) {
    if (seg.start < endSec && seg.end > startSec) {
      const text = seg.text.trim();
      if (text.length > 0) parts.push(text);
    }
  }
  return parts.join(' ');
}

/**
 * Clamp a window toward the 10–20s rule.
 *
 * - Too short: extend the end forward to reach {@link CLIP_MIN_SEC} (never moving
 *   start before 0).
 * - Too long: trim the end back to {@link CLIP_MAX_SEC}.
 *
 * Returns a window with non-negative start. Length validity is still checked
 * afterwards by {@link normalizeWindows} (a clamp can't fix e.g. start === end
 * when the source is shorter than the minimum).
 */
export function clampWindow(
  startSec: number,
  endSec: number,
): { startSec: number; endSec: number } {
  const start = Math.max(0, startSec);
  let end = Math.max(start, endSec);
  const duration = end - start;
  if (duration < CLIP_MIN_SEC) {
    end = start + CLIP_MIN_SEC;
  } else if (duration > CLIP_MAX_SEC) {
    end = start + CLIP_MAX_SEC;
  }
  return { startSec: start, endSec: end };
}

/** Options controlling which normalized candidates are kept. */
export interface NormalizeOptions {
  /** Max number of candidates to return (after sorting). */
  limit?: number;
  /** Minimum virality score (0–100) to include. */
  minScore?: number;
  /**
   * Transcript used to attach covered text per candidate. Optional so the clamp/
   * filter/sort logic can be exercised on its own.
   */
  transcript?: Transcript;
}

/**
 * Clamp → filter (length + minScore) → sort (score desc) → limit.
 *
 * Pure and deterministic given a fixed id generator. Each surviving window
 * becomes a {@link ClipCandidate} with a generated id, the provided `sourceId`,
 * and (when a transcript is supplied) the covered transcript text.
 */
export function normalizeWindows(
  raw: readonly RawWindow[],
  sourceId: string,
  opts: NormalizeOptions = {},
  idFactory: () => string = randomUUID,
): ClipCandidate[] {
  const minScore = opts.minScore ?? 0;

  const candidates: ClipCandidate[] = [];
  for (const window of raw) {
    if (!Number.isFinite(window.startSec) || !Number.isFinite(window.endSec)) continue;
    if (!Number.isFinite(window.score)) continue;

    const { startSec, endSec } = clampWindow(window.startSec, window.endSec);
    if (!isValidClipLength({ startSec, endSec })) continue;

    const score = clampScore(window.score);
    if (score < minScore) continue;

    const transcriptText = opts.transcript
      ? selectCandidateText(opts.transcript, startSec, endSec)
      : '';

    candidates.push({
      id: idFactory(),
      sourceId,
      startSec,
      endSec,
      score,
      reason: typeof window.reason === 'string' ? window.reason.trim() : '',
      transcriptText,
    });
  }

  candidates.sort((a, b) => b.score - a.score || windowDurationSec(a) - windowDurationSec(b));

  const limit = opts.limit;
  if (limit !== undefined && limit >= 0 && candidates.length > limit) {
    return candidates.slice(0, limit);
  }
  return candidates;
}

/** Clamp a score into the inclusive 0–100 range. */
function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}
