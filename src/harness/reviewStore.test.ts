import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clip } from '../core/types.js';
import { ReviewStore } from './reviewStore.js';

function makeClip(id: string): Clip {
  return {
    id,
    candidateId: `cand-${id}`,
    sourceId: 'src-1',
    startSec: 10,
    endSec: 25,
    caption: { text: `caption ${id}` },
    renderedPath: `/tmp/${id}.mp4`,
    status: 'captioned',
  };
}

describe('ReviewStore', () => {
  let dir: string;
  let store: ReviewStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'review-'));
    store = new ReviewStore({ filePath: join(dir, 'review.json') });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submit records a clip as pending (rendered) and lists it', async () => {
    await store.submit(makeClip('a'));
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('a');
    expect(pending[0]?.status).toBe('rendered');
  });

  it('approve transitions status to approved and removes it from pending', async () => {
    await store.submit(makeClip('a'));
    const approved = await store.approve('a');
    expect(approved.status).toBe('approved');
    expect(await store.listPending()).toHaveLength(0);
    expect(await store.list('approved')).toHaveLength(1);
  });

  it('reject transitions to rejected and stores the reason', async () => {
    await store.submit(makeClip('a'));
    const rejected = await store.reject('a', 'too boring');
    expect(rejected.status).toBe('rejected');
    expect(await store.listPending()).toHaveLength(0);
    const rejectedList = await store.list('rejected');
    expect(rejectedList).toHaveLength(1);
    // reason lives in the record, not the Clip — verify via the persisted file shape.
    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(dir, 'review.json'), 'utf8'),
    );
    expect(raw).toContain('too boring');
  });

  it('get returns the clip or undefined', async () => {
    await store.submit(makeClip('a'));
    expect((await store.get('a'))?.id).toBe('a');
    expect(await store.get('missing')).toBeUndefined();
  });

  it('throws clear errors for unknown ids', async () => {
    await expect(store.approve('nope')).rejects.toThrow(/not found: nope/);
    await expect(store.reject('nope')).rejects.toThrow(/not found: nope/);
  });

  it('list with no status returns everything; submit is idempotent on id', async () => {
    await store.submit(makeClip('a'));
    await store.submit(makeClip('b'));
    await store.approve('a');
    await store.submit(makeClip('a')); // re-submit resets to rendered
    expect(await store.list()).toHaveLength(2);
    expect((await store.get('a'))?.status).toBe('rendered');
  });
});
