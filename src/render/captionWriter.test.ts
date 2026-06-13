import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipCandidate } from '../core/types.js';

// Mock the Anthropic SDK so no real network calls are made.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = { create: createMock };
      constructor(_opts: unknown) {}
    },
  };
});

const candidate: ClipCandidate = {
  id: 'cand-1',
  sourceId: 'src-1',
  startSec: 10,
  endSec: 22,
  score: 87,
  reason: 'A wild moment',
  transcriptText: 'You will not believe what just happened on stream.',
};

describe('ClaudeCaptionWriter', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.CLIPPER_CAPTION_MODEL;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLIPPER_CAPTION_MODEL;
  });

  it('uses the configured caption model (default) and returns a Caption', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '  This Stream Moment Broke The Internet  ' }],
    });

    const { resetConfigCache } = await import('../config/index.js');
    resetConfigCache();
    const { ClaudeCaptionWriter } = await import('./captionWriter.js');

    const caption = await new ClaudeCaptionWriter().write(candidate);

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0]![0] as { model: string };
    expect(arg.model).toBe('claude-sonnet-4-6');
    expect(caption.text).toBe('This Stream Moment Broke The Internet');
    expect(caption.style).toBeDefined();
  });

  it('honors a custom caption model from env', async () => {
    process.env.CLIPPER_CAPTION_MODEL = 'claude-opus-4-8';
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'Boom' }] });

    const { resetConfigCache } = await import('../config/index.js');
    resetConfigCache();
    const { ClaudeCaptionWriter } = await import('./captionWriter.js');

    await new ClaudeCaptionWriter().write(candidate);

    const arg = createMock.mock.calls[0]![0] as { model: string };
    expect(arg.model).toBe('claude-opus-4-8');
  });

  it('throws when the model returns no text', async () => {
    createMock.mockResolvedValue({ content: [] });

    const { resetConfigCache } = await import('../config/index.js');
    resetConfigCache();
    const { ClaudeCaptionWriter } = await import('./captionWriter.js');

    await expect(new ClaudeCaptionWriter().write(candidate)).rejects.toThrow(/no text/);
  });

  it('throws a clear error when the API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'x' }] });

    const { resetConfigCache } = await import('../config/index.js');
    resetConfigCache();
    const { ClaudeCaptionWriter } = await import('./captionWriter.js');

    await expect(new ClaudeCaptionWriter().write(candidate)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
