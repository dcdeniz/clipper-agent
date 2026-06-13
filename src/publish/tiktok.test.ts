import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../config/index.js';
import { TikTokPublisher } from './tiktok.js';
import type { Clip } from '../core/types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('fake-video-bytes')),
}));

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
    caption: { text: 'wild moment' },
    renderedPath: '/tmp/clip-1.mp4',
    status: 'rendered',
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigCache();
  vi.clearAllMocks();
});

describe('TikTokPublisher', () => {
  it('runs the direct-post happy path and returns published', async () => {
    vi.stubEnv('TIKTOK_ACCESS_TOKEN', 'tok-123');
    resetConfigCache();

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/post/publish/video/init/')) {
        return new Response(
          JSON.stringify({
            data: { publish_id: 'pub-9', upload_url: 'https://upload.tiktok/abc' },
            error: { code: 'ok' },
          }),
          { status: 200 },
        );
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new TikTokPublisher(silentLog).publish(makeClip());

    expect(result).toEqual({ target: 'tiktok', status: 'published', postId: 'pub-9' });

    const [initUrl, initOpts] = fetchMock.mock.calls[0]!;
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/video/init/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ih = (initOpts as any).headers;
    expect(ih.Authorization).toBe('Bearer tok-123');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initBody = JSON.parse((initOpts as any).body);
    expect(initBody.source_info.source).toBe('FILE_UPLOAD');
    expect(initBody.source_info.video_size).toBe(16);

    const [uploadUrl, uploadOpts] = fetchMock.mock.calls[1]!;
    expect(uploadUrl).toBe('https://upload.tiktok/abc');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uo = uploadOpts as any;
    expect(uo.method).toBe('PUT');
    expect(uo.headers['Content-Range']).toBe('bytes 0-15/16');
    expect(uo.headers['Content-Type']).toBe('video/mp4');
  });

  it('returns failed when the init call errors', async () => {
    vi.stubEnv('TIKTOK_ACCESS_TOKEN', 'tok-123');
    resetConfigCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );

    const result = await new TikTokPublisher(silentLog).publish(makeClip());
    expect(result.target).toBe('tiktok');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('401');
  });

  it('returns skipped when credentials are missing', async () => {
    resetConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new TikTokPublisher(silentLog).publish(makeClip());
    expect(result).toEqual({
      target: 'tiktok',
      status: 'skipped',
      error: 'missing credentials',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
