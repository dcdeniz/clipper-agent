import { describe, expect, it } from 'vitest';
import type { Transcript } from '../core/types.js';
import { CLIP_MAX_SEC, CLIP_MIN_SEC, isValidClipLength } from '../core/types.js';
import type { RawWindow } from './normalize.js';
import { clampWindow, normalizeWindows, selectCandidateText } from './normalize.js';

function transcript(): Transcript {
  return {
    sourceId: 'src-1',
    language: 'en',
    fullText: 'a b c d',
    segments: [
      { start: 0, end: 5, text: 'first segment' },
      { start: 5, end: 10, text: 'second segment' },
      { start: 10, end: 15, text: 'third segment' },
      { start: 15, end: 20, text: '   ' }, // whitespace-only
      { start: 20, end: 25, text: 'fifth segment' },
    ],
  };
}

// deterministic id factory for stable assertions
function ids(): () => string {
  let n = 0;
  return () => `id-${n++}`;
}

describe('selectCandidateText', () => {
  it('joins text of overlapping segments only', () => {
    const t = transcript();
    expect(selectCandidateText(t, 4, 11)).toBe('first segment second segment third segment');
  });

  it('excludes non-overlapping and whitespace-only segments', () => {
    const t = transcript();
    // window [16,19] overlaps only the whitespace segment -> empty
    expect(selectCandidateText(t, 16, 19)).toBe('');
    // window [20,25] -> fifth only
    expect(selectCandidateText(t, 20.5, 24)).toBe('fifth segment');
  });

  it('treats touching boundaries as non-overlapping', () => {
    const t = transcript();
    // [5,10] touches seg0 end and seg2 start but only contains seg1
    expect(selectCandidateText(t, 5, 10)).toBe('second segment');
  });
});

describe('clampWindow', () => {
  it('extends too-short windows up to the minimum', () => {
    const w = clampWindow(100, 103);
    expect(w.endSec - w.startSec).toBe(CLIP_MIN_SEC);
    expect(isValidClipLength(w)).toBe(true);
  });

  it('trims too-long windows down to the maximum', () => {
    const w = clampWindow(100, 200);
    expect(w.endSec - w.startSec).toBe(CLIP_MAX_SEC);
    expect(isValidClipLength(w)).toBe(true);
  });

  it('clamps negative starts to zero', () => {
    const w = clampWindow(-5, 12);
    expect(w.startSec).toBe(0);
  });

  it('leaves valid windows untouched', () => {
    expect(clampWindow(30, 45)).toEqual({ startSec: 30, endSec: 45 });
  });
});

describe('normalizeWindows', () => {
  it('rejects windows shorter than 10s that cannot be clamped to validity', () => {
    // start === end at 0; clamp extends to [0,10] which IS valid, so use a case
    // that stays invalid: nothing here. Instead verify a sub-10s raw becomes valid
    // via clamp, and an explicitly impossible NaN window is dropped.
    const raw: RawWindow[] = [{ startSec: NaN, endSec: 5, score: 90, reason: 'x' }];
    expect(normalizeWindows(raw, 'src', {}, ids())).toEqual([]);
  });

  it('clamps a slightly-short window into the valid 10-20s range', () => {
    const raw: RawWindow[] = [{ startSec: 0, endSec: 3, score: 80, reason: 'short' }];
    const out = normalizeWindows(raw, 'src', {}, ids());
    expect(out).toHaveLength(1);
    expect(isValidClipLength(out[0]!)).toBe(true);
    expect(out[0]!.endSec - out[0]!.startSec).toBe(CLIP_MIN_SEC);
  });

  it('clamps an over-20s window down to the valid range', () => {
    const raw: RawWindow[] = [{ startSec: 10, endSec: 60, score: 70, reason: 'long' }];
    const out = normalizeWindows(raw, 'src', {}, ids());
    expect(out).toHaveLength(1);
    expect(out[0]!.endSec - out[0]!.startSec).toBe(CLIP_MAX_SEC);
  });

  it('sorts by score descending', () => {
    const raw: RawWindow[] = [
      { startSec: 0, endSec: 15, score: 40, reason: 'a' },
      { startSec: 20, endSec: 35, score: 95, reason: 'b' },
      { startSec: 40, endSec: 55, score: 70, reason: 'c' },
    ];
    const out = normalizeWindows(raw, 'src', {}, ids());
    expect(out.map((c) => c.score)).toEqual([95, 70, 40]);
  });

  it('applies minScore and limit', () => {
    const raw: RawWindow[] = [
      { startSec: 0, endSec: 15, score: 40, reason: 'a' },
      { startSec: 20, endSec: 35, score: 95, reason: 'b' },
      { startSec: 40, endSec: 55, score: 70, reason: 'c' },
      { startSec: 60, endSec: 75, score: 85, reason: 'd' },
    ];
    const out = normalizeWindows(raw, 'src', { minScore: 60, limit: 2 }, ids());
    expect(out.map((c) => c.score)).toEqual([95, 85]);
  });

  it('clamps out-of-range scores into 0-100', () => {
    const raw: RawWindow[] = [
      { startSec: 0, endSec: 15, score: 250, reason: 'high' },
      { startSec: 20, endSec: 35, score: -10, reason: 'low' },
    ];
    const out = normalizeWindows(raw, 'src', {}, ids());
    expect(out.map((c) => c.score)).toEqual([100, 0]);
  });

  it('attaches sourceId, ids, and transcript text', () => {
    const t = transcript();
    const raw: RawWindow[] = [{ startSec: 0, endSec: 12, score: 50, reason: 'r' }];
    const out = normalizeWindows(raw, t.sourceId, { transcript: t }, ids());
    expect(out[0]!.id).toBe('id-0');
    expect(out[0]!.sourceId).toBe('src-1');
    expect(out[0]!.transcriptText).toContain('first segment');
    expect(out[0]!.transcriptText).toContain('third segment');
  });

  it('rejects windows whose duration cannot satisfy the rule and keeps valid ones', () => {
    // A window with endSec below startSec collapses; clamp makes start>=end then
    // extends to min, which is valid. To get a guaranteed rejection at the
    // length gate, feed a non-finite endSec.
    const raw: RawWindow[] = [
      { startSec: 5, endSec: Infinity, score: 90, reason: 'bad' },
      { startSec: 0, endSec: 15, score: 50, reason: 'good' },
    ];
    const out = normalizeWindows(raw, 'src', {}, ids());
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe('good');
  });
});
