import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clip } from '../core/types.js';
import { ReviewStore } from './reviewStore.js';
import { start } from './server.js';

function makeClip(id: string, renderedPath?: string): Clip {
  return {
    id,
    candidateId: `cand-${id}`,
    sourceId: 'src-1',
    startSec: 5,
    endSec: 20,
    caption: { text: `caption ${id}` },
    renderedPath,
    status: 'captioned',
  };
}

function baseUrl(server: Server): string {
  const addr = server.address();
  if (typeof addr !== 'object' || !addr) throw new Error('no address');
  return `http://localhost:${addr.port}`;
}

describe('review server', () => {
  let dir: string;
  let store: ReviewStore;
  let server: Server;
  let url: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'review-srv-'));
    store = new ReviewStore({ filePath: join(dir, 'review.json') });
    server = await start(store, 0);
    url = baseUrl(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('GET / serves the HTML review page', async () => {
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Clips awaiting review');
  });

  it('GET /api/clips lists clips and filters by status', async () => {
    await store.submit(makeClip('a'));
    await store.submit(makeClip('b'));
    const all = (await (await fetch(`${url}/api/clips`)).json()) as Clip[];
    expect(all).toHaveLength(2);

    const pending = (await (await fetch(`${url}/api/clips?status=rendered`)).json()) as Clip[];
    expect(pending).toHaveLength(2);
    const approved = (await (await fetch(`${url}/api/clips?status=approved`)).json()) as Clip[];
    expect(approved).toHaveLength(0);
  });

  it('POST approve updates the store', async () => {
    await store.submit(makeClip('a'));
    const res = await fetch(`${url}/api/clips/a/approve`, { method: 'POST' });
    expect(res.status).toBe(200);
    const clip = (await res.json()) as Clip;
    expect(clip.status).toBe('approved');
    expect((await store.get('a'))?.status).toBe('approved');
  });

  it('POST reject with reason updates the store', async () => {
    await store.submit(makeClip('a'));
    const res = await fetch(`${url}/api/clips/a/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'low energy' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Clip).status).toBe('rejected');
    expect((await store.get('a'))?.status).toBe('rejected');
  });

  it('approve of an unknown id returns 404', async () => {
    const res = await fetch(`${url}/api/clips/missing/approve`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('GET /clip/:id/video streams the rendered file with a content-type', async () => {
    const videoPath = join(dir, 'a.mp4');
    await writeFile(videoPath, Buffer.from('fake-mp4-bytes'));
    await store.submit(makeClip('a', videoPath));
    const res = await fetch(`${url}/clip/a/video`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(await res.text()).toBe('fake-mp4-bytes');
  });

  it('GET /clip/:id/video returns 404 when there is no rendered file', async () => {
    await store.submit(makeClip('a')); // no renderedPath
    expect((await fetch(`${url}/clip/a/video`)).status).toBe(404);
  });

  it('unknown routes return 404', async () => {
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });
});
