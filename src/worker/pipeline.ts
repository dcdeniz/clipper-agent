/**
 * End-to-end clip pipeline: a source URL in, reviewable clips out.
 *
 *   download -> transcribe -> detect candidates -> (per candidate) caption -> render -> submit for review
 *
 * Dependencies are injectable so the orchestration can be unit-tested without
 * hitting the network, the LLM, or ffmpeg. Defaults wire the real implementations.
 */
import type {
  CaptionWriter,
  ClipDetector,
  Downloader,
  Renderer,
  Transcriber,
} from '../core/contracts.js';
import type { Clip, ClipCandidate, SourceVideo } from '../core/types.js';
import { createLogger } from '../core/logger.js';
import { ensureDataDirs } from '../core/paths.js';
import { YtDlpDownloader } from '../ingest/index.js';
import { GroqWhisperTranscriber } from '../transcribe/index.js';
import { ClaudeClipDetector } from '../research/index.js';
import { ClaudeCaptionWriter, FfmpegRenderer } from '../render/index.js';
import { ReviewStore } from '../harness/index.js';

const log = createLogger('pipeline');

/** A sink for clips that have been rendered and are awaiting human review. */
export interface ClipSink {
  submit(clip: Clip): Promise<void>;
}

export interface PipelineDeps {
  downloader: Downloader;
  transcriber: Transcriber;
  detector: ClipDetector;
  captionWriter: CaptionWriter;
  renderer: Renderer;
  /** Where finished clips go to await the review gate. */
  reviewSink: ClipSink;
}

export interface PipelineOptions {
  /** Max number of clip candidates to render from a source. */
  limit?: number;
  /** Minimum virality score (0–100) for a candidate to be rendered. */
  minScore?: number;
}

export interface PipelineResult {
  source: SourceVideo;
  candidates: ClipCandidate[];
  clips: Clip[];
  /** Per-candidate failures that did not abort the whole run. */
  failures: Array<{ candidateId: string; error: string }>;
}

/** Build the default production dependency set (real implementations). */
export function defaultPipelineDeps(): PipelineDeps {
  return {
    downloader: new YtDlpDownloader(),
    transcriber: new GroqWhisperTranscriber(),
    detector: new ClaudeClipDetector(),
    captionWriter: new ClaudeCaptionWriter(),
    renderer: new FfmpegRenderer(),
    reviewSink: new ReviewStore(),
  };
}

/**
 * Run the full pipeline for one source URL. Per-candidate errors (a caption or
 * render failing) are collected into `failures` so one bad clip doesn't sink the
 * whole batch; failures in download/transcribe/detect abort the run.
 */
export async function runClipPipeline(
  url: string,
  opts: PipelineOptions = {},
  deps: PipelineDeps = defaultPipelineDeps(),
): Promise<PipelineResult> {
  await ensureDataDirs();

  log.info({ url }, 'pipeline: downloading source');
  const source = await deps.downloader.download(url);

  log.info({ sourceId: source.id, durationSec: source.durationSec }, 'pipeline: transcribing');
  const transcript = await deps.transcriber.transcribe(source);

  log.info({ sourceId: source.id }, 'pipeline: detecting clip candidates');
  const candidates = await deps.detector.detect(transcript, {
    limit: opts.limit,
    minScore: opts.minScore,
  });
  log.info({ count: candidates.length }, 'pipeline: candidates selected');

  const clips: Clip[] = [];
  const failures: PipelineResult['failures'] = [];

  for (const candidate of candidates) {
    try {
      const caption = await deps.captionWriter.write(candidate);
      const clip = await deps.renderer.render(source, candidate, caption);
      await deps.reviewSink.submit(clip);
      clips.push(clip);
      log.info(
        { clipId: clip.id, score: candidate.score },
        'pipeline: clip rendered & queued for review',
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ candidateId: candidate.id, error });
      log.error({ candidateId: candidate.id, error }, 'pipeline: candidate failed');
    }
  }

  log.info(
    { sourceId: source.id, rendered: clips.length, failed: failures.length },
    'pipeline: complete',
  );
  return { source, candidates, clips, failures };
}
