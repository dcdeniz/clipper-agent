import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../config/index.js';
import { YouTubePublisher } from './youtube.js';
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
    caption: { text: 'no way he did that' },
    renderedPath: '/tmp/clip-1.mp4',
    status: 'rendered',
  };
}

function setCreds(): void {
  vi.stubEnv('YOUTUBE_CLIENT_ID', 'cid');
  vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'csecret');
  vi.stubEnv('YOUTUBE_REFRESH_TOKEN', 'rtok');
  resetConfigCache();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigCache();
  vi.clearAllMocks();
});

describe('YouTubePublisher', () => {
  it('exchanges token, starts resumable upload, and publishes a Short', async () => {
    setCreds();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'access-1' }), { status: 200 });
      }
      if (url.includes('uploadType=resumable')) {
        return new Response('', {
          status: 200,
          headers: { Location: 'https://upload.youtube/session-1' },
        });
      }
      if (url === 'https://upload.youtube/session-1') {
        return new Response(JSON.stringify({ id: 'vid-77' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new YouTubePublisher(silentLog).publish(makeClip());

    expect(result).toEqual({
      target: 'youtube',
      status: 'published',
      postId: 'vid-77',
      url: 'https://www.youtube.com/shorts/vid-77',
    });

    const [tokenUrl, tokenOpts] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tbody = (tokenOpts as any).body as URLSearchParams;
    expect(tbody.get('grant_type')).toBe('refresh_token');
    expect(tbody.get('refresh_token')).toBe('rtok');

    const [initUrl, initOpts] = fetchMock.mock.calls[1]!;
    expect(initUrl).toBe(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const io = initOpts as any;
    expect(io.headers.Authorization).toBe('Bearer access-1');
    const snippet = JSON.parse(io.body);
    expect(snippet.snippet.title).toContain('#Shorts');
    expect(snippet.snippet.title).toContain('no way he did that');

    const [putUrl, putOpts] = fetchMock.mock.calls[2]!;
    expect(putUrl).toBe('https://upload.youtube/session-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((putOpts as any).method).toBe('PUT');
  });

  it('returns failed when the token exchange errors', async () => {
    setCreds();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );

    const result = await new YouTubePublisher(silentLog).publish(makeClip());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('invalid_grant');
  });

  it('returns skipped when credentials are missing', async () => {
    resetConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new YouTubePublisher(silentLog).publish(makeClip());
    expect(result).toEqual({
      target: 'youtube',
      status: 'skipped',
      error: 'missing credentials',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
