import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../config/index.js';
import { InstagramPublisher } from './instagram.js';
import type { Clip } from '../core/types.js';

const silentLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeClip(): Clip {
  return {
    id: 'clip-1',
    candidateId: 'cand-1',
    sourceId: 'src-1',
    startSec: 0,
    endSec: 15,
    caption: { text: 'insane play' },
    renderedPath: '/tmp/clip-1.mp4',
    status: 'rendered',
  };
}

function setCreds(): void {
  vi.stubEnv('INSTAGRAM_ACCESS_TOKEN', 'ig-tok');
  vi.stubEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', 'biz-1');
  resetConfigCache();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigCache();
  vi.clearAllMocks();
});

describe('InstagramPublisher', () => {
  it('creates a REELS container then publishes it (happy path)', async () => {
    setCreds();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/biz-1/media')) {
        return new Response(JSON.stringify({ id: 'creation-7' }), { status: 200 });
      }
      if (url.endsWith('/biz-1/media_publish')) {
        return new Response(JSON.stringify({ id: 'media-42' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pub = new InstagramPublisher({
      log: silentLog,
      resolveVideoUrl: () => 'https://cdn.example/clip-1.mp4',
    });
    const result = await pub.publish(makeClip());

    expect(result).toEqual({ target: 'instagram', status: 'published', postId: 'media-42' });

    const [containerUrl, containerOpts] = fetchMock.mock.calls[0]!;
    expect(containerUrl).toBe('https://graph.facebook.com/v21.0/biz-1/media');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (containerOpts as any).body as URLSearchParams;
    expect(body.get('media_type')).toBe('REELS');
    expect(body.get('video_url')).toBe('https://cdn.example/clip-1.mp4');
    expect(body.get('caption')).toBe('insane play');
    expect(body.get('access_token')).toBe('ig-tok');

    const [publishUrl, publishOpts] = fetchMock.mock.calls[1]!;
    expect(publishUrl).toBe('https://graph.facebook.com/v21.0/biz-1/media_publish');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pbody = (publishOpts as any).body as URLSearchParams;
    expect(pbody.get('creation_id')).toBe('creation-7');
  });

  it('returns failed when the container creation errors', async () => {
    setCreds();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'bad url' } }), { status: 400 }),
      ),
    );

    const pub = new InstagramPublisher({
      log: silentLog,
      resolveVideoUrl: () => 'https://cdn.example/clip-1.mp4',
    });
    const result = await pub.publish(makeClip());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('bad url');
  });

  it('returns failed when no public video_url can be resolved', async () => {
    setCreds();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new InstagramPublisher({ log: silentLog }).publish(makeClip());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('publicly reachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns skipped when credentials are missing', async () => {
    resetConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new InstagramPublisher({ log: silentLog }).publish(makeClip());
    expect(result).toEqual({
      target: 'instagram',
      status: 'skipped',
      error: 'missing credentials',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
