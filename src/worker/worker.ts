/**
 * Long-running queue worker — the process that runs 24/7 on the Mac mini.
 *
 * It polls the file-backed job queue, runs the clip pipeline for each enqueued
 * source URL, and shuts down cleanly on SIGINT/SIGTERM (so launchd can restart
 * it). The same code runs as a one-shot in dev (drain once and exit).
 */
import { createLogger } from '../core/logger.js';
import { FileJobQueue, type Job, type JobQueue } from '../core/queue.js';
import { runClipPipeline, type PipelineOptions } from './pipeline.js';

const log = createLogger('worker');

/** Job type for "download this source and produce reviewable clips". */
export const JOB_CLIP_SOURCE = 'clip-source';

export interface ClipSourcePayload {
  url: string;
  options?: PipelineOptions;
}

/** Enqueue a source URL for the worker to process. */
export async function enqueueSource(
  url: string,
  options?: PipelineOptions,
  queue: JobQueue = new FileJobQueue(),
): Promise<Job<ClipSourcePayload>> {
  return queue.enqueue<ClipSourcePayload>(JOB_CLIP_SOURCE, { url, options });
}

async function handleJob(job: Job): Promise<void> {
  switch (job.type) {
    case JOB_CLIP_SOURCE: {
      const payload = job.payload as ClipSourcePayload;
      await runClipPipeline(payload.url, payload.options ?? {});
      return;
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

export interface WorkerOptions {
  /** How long to wait between polls when the queue is empty (ms). */
  pollIntervalMs?: number;
  /** Drain the queue once and return instead of running forever (dev/test). */
  once?: boolean;
  /** Queue implementation (defaults to the on-disk FileJobQueue). */
  queue?: JobQueue;
  /** Abort signal for graceful shutdown (defaults to SIGINT/SIGTERM handlers). */
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run the worker loop. Returns when aborted (daemon mode) or when the queue is
 * empty in `once` mode.
 */
export async function runWorker(opts: WorkerOptions = {}): Promise<void> {
  const queue = opts.queue ?? new FileJobQueue();
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const signal = opts.signal ?? installSignalHandlers();

  log.info({ once: Boolean(opts.once), pollIntervalMs }, 'worker: started');

  while (!signal.aborted) {
    const job = await queue.claimNext();
    if (!job) {
      if (opts.once) break;
      await sleep(pollIntervalMs);
      continue;
    }

    log.info({ jobId: job.id, type: job.type }, 'worker: processing job');
    try {
      await handleJob(job);
      await queue.complete(job.id);
      log.info({ jobId: job.id }, 'worker: job done');
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await queue.fail(job.id, error);
      log.error({ jobId: job.id, error }, 'worker: job failed');
    }
  }

  log.info('worker: stopped');
}

/** Wire SIGINT/SIGTERM to an AbortController so launchd can stop us cleanly. */
function installSignalHandlers(): AbortSignal {
  const controller = new AbortController();
  const stop = (sig: string) => {
    log.info({ signal: sig }, 'worker: shutdown signal received');
    controller.abort();
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  return controller.signal;
}
