import { describe, expect, it } from 'vitest';
import { CLIP_MAX_SEC, CLIP_MIN_SEC, isValidClipLength, windowDurationSec } from './types.js';

describe('clip length rules', () => {
  it('computes window duration', () => {
    expect(windowDurationSec({ startSec: 100, endSec: 115 })).toBe(15);
  });

  it('accepts windows within the 10-20s bound', () => {
    expect(isValidClipLength({ startSec: 0, endSec: CLIP_MIN_SEC })).toBe(true);
    expect(isValidClipLength({ startSec: 0, endSec: 15 })).toBe(true);
    expect(isValidClipLength({ startSec: 0, endSec: CLIP_MAX_SEC })).toBe(true);
  });

  it('rejects windows that are too short or too long', () => {
    expect(isValidClipLength({ startSec: 0, endSec: 9.9 })).toBe(false);
    expect(isValidClipLength({ startSec: 0, endSec: 20.1 })).toBe(false);
  });
});
