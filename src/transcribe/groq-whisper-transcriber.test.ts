import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceVideo } from '../core/types.js';

// Mock the groq SDK: default export is the Groq client class.
const { createMock, GroqCtor } = vi.hoisted(() => {
  const createMock = vi.fn();
  const GroqCtor = vi.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: createMock } },
  }));
  return { createMock, GroqCtor };
});
vi.mock('groq-sdk', () => ({ default: GroqCtor }));

// Avoid touching the real filesystem when reading the media file.
vi.mock('node:fs', () => ({
  createReadStream: vi.fn().mockReturnValue('FAKE_STREAM'),
}));

// Provide a Groq API key via config.
vi.mock('../config/index.js', () => ({
  getConfig: () => ({
    llm: { groqApiKey: 'test-key' },
    runtime: { logLevel: 'silent', logFormat: 'json' },
  }),
  requireValue: <T>(value: T | undefined, name: string): T => {
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required configuration: ${name}`);
    }
    return value;
  },
}));

import { GroqWhisperTranscriber, TRANSCRIBE_MODEL } from './groq-whisper-transcriber.js';

const SOURCE: SourceVideo = {
  id: 'vid123',
  url: 'https://youtu.be/abc',
  platform: 'youtube',
  title: 'Test',
  durationSec: 100,
  localPath: '/data/downloads/vid123.mp4',
  downloadedAt: '2026-06-13T00:00:00.000Z',
};

describe('GroqWhisperTranscriber', () => {
  beforeEach(() => {
    createMock.mockReset();
    GroqCtor.mockClear();
  });

  it('uses the turbo model + verbose_json and maps the response to a Transcript', async () => {
    createMock.mockResolvedValueOnce({
      text: 'Hello world. Goodbye world.',
      language: 'en',
      segments: [
        { start: 0, end: 1.5, text: ' Hello world.' },
        { start: 1.5, end: 3.0, text: ' Goodbye world.' },
      ],
    });

    const transcript = await new GroqWhisperTranscriber().transcribe(SOURCE);

    expect(TRANSCRIBE_MODEL).toBe('whisper-large-v3-turbo');
    const callArg = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg.model).toBe('whisper-large-v3-turbo');
    expect(callArg.response_format).toBe('verbose_json');
    expect(callArg.file).toBe('FAKE_STREAM');

    expect(transcript).toEqual({
      sourceId: 'vid123',
      language: 'en',
      fullText: 'Hello world. Goodbye world.',
      segments: [
        { start: 0, end: 1.5, text: 'Hello world.' },
        { start: 1.5, end: 3.0, text: 'Goodbye world.' },
      ],
    });
  });

  it('falls back to joined segment text when top-level text is absent', async () => {
    createMock.mockResolvedValueOnce({
      language: 'es',
      segments: [
        { start: 0, end: 1, text: 'Hola' },
        { start: 1, end: 2, text: 'mundo' },
      ],
    });

    const transcript = await new GroqWhisperTranscriber().transcribe(SOURCE);
    expect(transcript.fullText).toBe('Hola mundo');
    expect(transcript.language).toBe('es');
  });

  it('handles a missing segments array gracefully', async () => {
    createMock.mockResolvedValueOnce({ text: 'only text', language: 'en' });
    const transcript = await new GroqWhisperTranscriber().transcribe(SOURCE);
    expect(transcript.segments).toEqual([]);
    expect(transcript.fullText).toBe('only text');
  });

  it('constructs the Groq client lazily with the configured key', async () => {
    createMock.mockResolvedValueOnce({ text: 'x', language: 'en', segments: [] });
    const t = new GroqWhisperTranscriber();
    expect(GroqCtor).not.toHaveBeenCalled();
    await t.transcribe(SOURCE);
    expect(GroqCtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    // Second call reuses the same client.
    createMock.mockResolvedValueOnce({ text: 'y', language: 'en', segments: [] });
    await t.transcribe(SOURCE);
    expect(GroqCtor).toHaveBeenCalledTimes(1);
  });
});
