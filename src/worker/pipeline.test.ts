import { describe, expect, it, vi } from 'vitest';
import type {
  CaptionWriter,
  ClipDetector,
  Downloader,
  Renderer,
  Transcriber,
} from '../core/contracts.js';
import type { Caption, Clip, ClipCandidate, SourceVideo, Transcript } from '../core/types.js';
import { runClipPipeline, type ClipSink, type PipelineDeps } from './pipeline.js';

const source: SourceVideo = {
  id: 'src1',
  url: 'https://twitch.tv/v/1',
  platform: 'twitch',
  title: 'Test Stream',
  durationSec: 7200,
  localPath: '/tmp/src1.mp4',
  downloadedAt: '2026-01-01T00:00:00.000Z',
};

const transcript: Transcript = {
  sourceId: 'src1',
  language: 'en',
  segments: [{ start: 0, end: 15, text: 'hello world' }],
  fullText: 'hello world',
};

function candidate(id: string, score: number): ClipCandidate {
  return {
    id,
    sourceId: 'src1',
    startSec: 0,
    endSec: 15,
    score,
    reason: 'r',
    transcriptText: 'hello',
  };
}

function makeDeps(overrides: Partial<PipelineDeps> = {}): {
  deps: PipelineDeps;
  submitted: Clip[];
} {
  const submitted: Clip[] = [];
  const downloader: Downloader = { download: vi.fn(async () => source) };
  const transcriber: Transcriber = { transcribe: vi.fn(async () => transcript) };
  const detector: ClipDetector = {
    detect: vi.fn(async () => [candidate('c1', 90), candidate('c2', 80)]),
  };
  const captionWriter: CaptionWriter = {
    write: vi.fn(async (c: ClipCandidate): Promise<Caption> => ({ text: `caption ${c.id}` })),
  };
  const renderer: Renderer = {
    render: vi.fn(
      async (_s, c: ClipCandidate): Promise<Clip> => ({
        id: `clip-${c.id}`,
        candidateId: c.id,
        sourceId: 'src1',
        startSec: c.startSec,
        endSec: c.endSec,
        caption: { text: 'x' },
        renderedPath: `/tmp/clip-${c.id}.mp4`,
        status: 'rendered',
      }),
    ),
  };
  const reviewSink: ClipSink = {
    submit: vi.fn(async (clip: Clip) => {
      submitted.push(clip);
    }),
  };
  return {
    deps: { downloader, transcriber, detector, captionWriter, renderer, reviewSink, ...overrides },
    submitted,
  };
}

describe('runClipPipeline', () => {
  it('runs download -> transcribe -> detect -> caption -> render -> submit for each candidate', async () => {
    const { deps, submitted } = makeDeps();
    const result = await runClipPipeline('https://twitch.tv/v/1', { limit: 5 }, deps);

    expect(deps.downloader.download).toHaveBeenCalledWith('https://twitch.tv/v/1');
    expect(deps.transcriber.transcribe).toHaveBeenCalledWith(source);
    expect(deps.detector.detect).toHaveBeenCalledWith(transcript, {
      limit: 5,
      minScore: undefined,
    });
    expect(deps.captionWriter.write).toHaveBeenCalledTimes(2);
    expect(deps.renderer.render).toHaveBeenCalledTimes(2);
    expect(submitted).toHaveLength(2);
    expect(result.clips).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it('collects per-candidate failures without aborting the run', async () => {
    const { deps } = makeDeps();
    (deps.renderer.render as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('ffmpeg boom'))
      .mockImplementationOnce(async (_s, c: ClipCandidate) => ({
        id: `clip-${c.id}`,
        candidateId: c.id,
        sourceId: 'src1',
        startSec: c.startSec,
        endSec: c.endSec,
        caption: { text: 'x' },
        renderedPath: `/tmp/clip-${c.id}.mp4`,
        status: 'rendered' as const,
      }));

    const result = await runClipPipeline('https://twitch.tv/v/1', {}, deps);
    expect(result.clips).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error).toContain('ffmpeg boom');
  });
});
