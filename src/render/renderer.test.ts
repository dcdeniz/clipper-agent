import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caption, ClipCandidate, SourceVideo } from '../core/types.js';

const { execaMock } = vi.hoisted(() => ({ execaMock: vi.fn() }));
vi.mock('execa', () => ({ execa: execaMock }));

import { buildFfmpegArgs, escapeDrawText, TARGET_HEIGHT, TARGET_WIDTH } from './renderer.js';

describe('escapeDrawText', () => {
  it('escapes ffmpeg drawtext special characters', () => {
    expect(escapeDrawText('a:b')).toBe('a\\:b');
    expect(escapeDrawText("it's")).toBe("it\\'s");
    expect(escapeDrawText('100%')).toBe('100\\%');
    expect(escapeDrawText('a\\b')).toBe('a\\\\b');
  });

  it('escapes backslashes before other characters', () => {
    // A literal backslash followed by a colon must not be conflated.
    expect(escapeDrawText('\\:')).toBe('\\\\\\:');
  });

  it('encodes newlines', () => {
    expect(escapeDrawText('line1\nline2')).toBe('line1\\nline2');
    expect(escapeDrawText('line1\r\nline2')).toBe('line1\\nline2');
  });
});

describe('buildFfmpegArgs', () => {
  const base = {
    inputPath: '/data/source.mp4',
    startSec: 12,
    endSec: 24,
    outputPath: '/data/clips/cand-1.mp4',
    captionText: 'Wait, what?!',
    encoder: 'libx264',
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
  };

  it('cuts the requested window with -ss/-to', () => {
    const args = buildFfmpegArgs(base);
    expect(args).toContain('-ss');
    expect(args[args.indexOf('-ss') + 1]).toBe('12');
    expect(args).toContain('-to');
    expect(args[args.indexOf('-to') + 1]).toBe('24');
  });

  it('passes input and output paths', () => {
    const args = buildFfmpegArgs(base);
    expect(args[args.indexOf('-i') + 1]).toBe('/data/source.mp4');
    expect(args[args.length - 1]).toBe('/data/clips/cand-1.mp4');
  });

  it('scales and crops to the vertical target', () => {
    const args = buildFfmpegArgs(base);
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain(
      `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase`,
    );
    expect(vf).toContain(`crop=${TARGET_WIDTH}:${TARGET_HEIGHT}`);
  });

  it('burns in escaped caption text via drawtext', () => {
    const args = buildFfmpegArgs(base);
    const vf = args[args.indexOf('-vf') + 1]!;
    // ':' and '!' — only ':' is escaped; the quote-wrapped value must contain escaped text.
    expect(vf).toContain("drawtext=text='Wait, what?!'");
  });

  it('uses the provided encoder', () => {
    const args = buildFfmpegArgs({ ...base, encoder: 'h264_videotoolbox' });
    expect(args[args.indexOf('-c:v') + 1]).toBe('h264_videotoolbox');
  });

  it('escapes a caption that contains drawtext specials', () => {
    const args = buildFfmpegArgs({ ...base, captionText: "50%: it's over" });
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain("text='50\\%\\: it\\'s over'");
  });
});

describe('FfmpegRenderer.render', () => {
  beforeEach(() => {
    vi.resetModules();
    execaMock.mockReset();
    execaMock.mockResolvedValue({ exitCode: 0 });
    process.env.CLIPPER_DATA_DIR = '/tmp/clipper-render-test';
  });

  afterEach(() => {
    delete process.env.CLIPPER_DATA_DIR;
  });

  const source: SourceVideo = {
    id: 'src-1',
    url: 'https://example.com/v',
    platform: 'twitch',
    title: 'Stream',
    durationSec: 7200,
    localPath: '/data/source.mp4',
    downloadedAt: '2026-06-13T00:00:00.000Z',
  };
  const candidate: ClipCandidate = {
    id: 'cand-1',
    sourceId: 'src-1',
    startSec: 12,
    endSec: 24,
    score: 90,
    reason: 'big play',
    transcriptText: 'no way',
  };
  const caption: Caption = { text: 'No Way!' };

  it('invokes ffmpeg and returns a rendered Clip', async () => {
    const { resetConfigCache } = await import('../config/index.js');
    resetConfigCache();
    const { FfmpegRenderer } = await import('./renderer.js');
    const { ffmpegBinary } = await import('../core/platform.js');
    const { dataPaths } = await import('../core/paths.js');

    const clip = await new FfmpegRenderer().render(source, candidate, caption);

    expect(execaMock).toHaveBeenCalledTimes(1);
    const [bin, args] = execaMock.mock.calls[0]!;
    expect(bin).toBe(ffmpegBinary());
    expect(Array.isArray(args)).toBe(true);

    const expectedPath = `${dataPaths().clips}/cand-1.mp4`;
    expect(clip.renderedPath).toBe(expectedPath);
    expect(clip.status).toBe('rendered');
    expect(clip.candidateId).toBe('cand-1');
    expect(clip.sourceId).toBe('src-1');
    expect(clip.caption).toEqual(caption);
    expect(args).toContain(expectedPath);
  });
});
