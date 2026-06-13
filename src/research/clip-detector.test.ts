import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Anthropic SDK so no real network call is made. The default export is
// a class whose instances expose `messages.create`.
const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));

import type { Transcript } from '../core/types.js';
import { isValidClipLength } from '../core/types.js';
import { resetConfigCache } from '../config/index.js';
import { ClaudeClipDetector, parseWindows } from './clip-detector.js';

// Provide an API key so the lazily-constructed (mocked) client passes requireValue.
process.env.ANTHROPIC_API_KEY = 'test-key';
resetConfigCache();

function transcript(): Transcript {
  return {
    sourceId: 'vod-123',
    language: 'en',
    fullText: 'whatever',
    segments: [
      { start: 0, end: 6, text: 'intro chatter' },
      { start: 6, end: 14, text: 'the funny moment happens here' },
      { start: 14, end: 22, text: 'reaction and laughter' },
      { start: 22, end: 40, text: 'a long rambling tangent that drags on' },
      { start: 40, end: 52, text: 'shocking plot twist reveal' },
    ],
  };
}

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

describe('parseWindows', () => {
  it('parses a bare JSON array', () => {
    const out = parseWindows('[{"startSec":1,"endSec":15,"score":80,"reason":"x"}]');
    expect(out).toEqual([{ startSec: 1, endSec: 15, score: 80, reason: 'x' }]);
  });

  it('parses JSON wrapped in markdown fences and prose', () => {
    const text =
      'Here you go:\n```json\n[{"startSec":2,"endSec":16,"score":90,"reason":"y"}]\n```\nDone.';
    const out = parseWindows(text);
    expect(out).toEqual([{ startSec: 2, endSec: 16, score: 90, reason: 'y' }]);
  });

  it('returns empty array on garbage', () => {
    expect(parseWindows('no json here')).toEqual([]);
    expect(parseWindows('[ not valid json')).toEqual([]);
  });

  it('skips malformed entries', () => {
    const out = parseWindows(
      '[{"startSec":1,"endSec":15,"score":80}, {"reason":"missing nums"}, 42]',
    );
    expect(out).toHaveLength(1);
  });
});

describe('ClaudeClipDetector.detect', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('parses, filters, sorts, and limits candidates from a mocked response', async () => {
    const canned = JSON.stringify([
      { startSec: 6, endSec: 14, score: 95, reason: 'funny moment' },
      { startSec: 40, endSec: 52, score: 88, reason: 'plot twist' },
      { startSec: 0, endSec: 3, score: 30, reason: 'too short raw (clamps)' },
      { startSec: 22, endSec: 100, score: 50, reason: 'too long raw (clamps)' },
    ]);
    createMock.mockResolvedValue(textResponse(canned));

    const detector = new ClaudeClipDetector({ model: 'test-model' });
    const candidates = await detector.detect(transcript(), { limit: 3, minScore: 40 });

    // minScore 40 drops the score-30 entry; limit 3 keeps the rest.
    expect(candidates).toHaveLength(3);
    // sorted by score desc
    expect(candidates.map((c) => c.score)).toEqual([95, 88, 50]);
    // all satisfy the clip-length rule
    for (const c of candidates) {
      expect(isValidClipLength(c)).toBe(true);
    }
    // top candidate carries covered transcript text + ids + sourceId
    expect(candidates[0]!.sourceId).toBe('vod-123');
    expect(candidates[0]!.id).toBeTruthy();
    expect(candidates[0]!.transcriptText).toContain('funny moment');
  });

  it('passes a timestamped transcript to the model', async () => {
    createMock.mockResolvedValue(textResponse('[]'));
    const detector = new ClaudeClipDetector({ model: 'test-model' });
    await detector.detect(transcript());

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0]![0] as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(arg.model).toBe('test-model');
    const userContent = arg.messages[0]!.content;
    expect(userContent).toContain('[6.0 - 14.0]');
    expect(userContent).toContain('the funny moment happens here');
  });

  it('returns no candidates for an empty transcript without calling the model', async () => {
    const detector = new ClaudeClipDetector();
    const empty: Transcript = { sourceId: 's', language: 'en', fullText: '', segments: [] };
    const out = await detector.detect(empty);
    expect(out).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('degrades to empty candidates on unparseable model output', async () => {
    createMock.mockResolvedValue(textResponse('sorry, I cannot help with that'));
    const detector = new ClaudeClipDetector();
    const out = await detector.detect(transcript());
    expect(out).toEqual([]);
  });
});
