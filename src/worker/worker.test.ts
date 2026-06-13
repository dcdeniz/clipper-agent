import { describe, expect, it, vi } from 'vitest';
import type { Job, JobQueue } from '../core/queue.js';

// Mock the pipeline so the worker test exercises only queue orchestration.
const runClipPipeline = vi.fn(async () => ({
  source: {} as never,
  candidates: [],
  clips: [],
  failures: [],
}));
vi.mock('./pipeline.js', () => ({ runClipPipeline }));

const { runWorker, enqueueSource, JOB_CLIP_SOURCE } = await import('./worker.js');

/** In-memory JobQueue for tests. */
function memoryQueue(initial: Job[] = []): JobQueue {
  const jobs = [...initial];
  return {
    enqueue: vi.fn(async (type, payload) => {
      const job: Job = {
        id: `j${jobs.length + 1}`,
        type,
        payload,
        status: 'pending',
        attempts: 0,
        createdAt: '',
        updatedAt: '',
      };
      jobs.push(job);
      return job;
    }),
    claimNext: vi.fn(async () => {
      const job = jobs.find((j) => j.status === 'pending');
      if (job) job.status = 'running';
      return job;
    }),
    complete: vi.fn(async (id) => {
      const j = jobs.find((x) => x.id === id);
      if (j) j.status = 'done';
    }),
    fail: vi.fn(async (id, error) => {
      const j = jobs.find((x) => x.id === id);
      if (j) {
        j.status = 'failed';
        j.error = error;
      }
    }),
    list: vi.fn(async (status) => (status ? jobs.filter((j) => j.status === status) : jobs)),
  };
}

describe('runWorker (once mode)', () => {
  it('processes a clip-source job and marks it done', async () => {
    runClipPipeline.mockClear();
    const queue = memoryQueue();
    await enqueueSource('https://twitch.tv/v/1', { limit: 3 }, queue);

    await runWorker({ once: true, queue });

    expect(runClipPipeline).toHaveBeenCalledWith('https://twitch.tv/v/1', { limit: 3 });
    expect(queue.complete).toHaveBeenCalled();
    const done = await queue.list('done');
    expect(done).toHaveLength(1);
    expect(done[0]?.type).toBe(JOB_CLIP_SOURCE);
  });

  it('marks a job failed when the pipeline throws', async () => {
    runClipPipeline.mockRejectedValueOnce(new Error('pipeline boom'));
    const queue = memoryQueue();
    await enqueueSource('https://twitch.tv/v/2', undefined, queue);

    await runWorker({ once: true, queue });

    expect(queue.fail).toHaveBeenCalled();
    const failed = await queue.list('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toContain('pipeline boom');
  });
});
