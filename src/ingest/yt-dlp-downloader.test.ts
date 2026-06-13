import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock execa so no real yt-dlp process runs.
const { execaMock } = vi.hoisted(() => ({ execaMock: vi.fn() }));
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

// Avoid touching the real filesystem when ensuring data dirs.
vi.mock('../core/paths.js', () => ({
  dataPaths: () => ({
    root: '/data',
    downloads: '/data/downloads',
    clips: '/data/clips',
    work: '/data/work',
    artifacts: '/data/artifacts',
    logs: '/data/logs',
  }),
  ensureDataDirs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../core/platform.js', () => ({
  ytDlpBinary: () => 'yt-dlp',
}));

import { YtDlpDownloader } from './yt-dlp-downloader.js';

const META = {
  id: 'vid123',
  title: 'Epic Stream Moment',
  duration: 7200,
};

describe('YtDlpDownloader', () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it('fetches metadata and downloads, producing a SourceVideo', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: JSON.stringify(META) }) // metadata call
      .mockResolvedValueOnce({ stdout: '/data/downloads/vid123.mp4\n' }); // download call

    const dl = new YtDlpDownloader();
    const url = 'https://www.twitch.tv/videos/123456';
    const source = await dl.download(url);

    // First call: metadata dump.
    expect(execaMock).toHaveBeenNthCalledWith(1, 'yt-dlp', [
      '--dump-single-json',
      '--no-warnings',
      url,
    ]);

    // Second call: download with output template + print path.
    const secondArgs = execaMock.mock.calls[1] as [string, string[]];
    expect(secondArgs[0]).toBe('yt-dlp');
    expect(secondArgs[1]).toContain('-o');
    expect(secondArgs[1]).toContain('/data/downloads/vid123.%(ext)s');
    expect(secondArgs[1]).toContain('--print');
    expect(secondArgs[1]).toContain('after_move:filepath');
    expect(secondArgs[1]).toContain(url);

    expect(source).toMatchObject({
      id: 'vid123',
      url,
      platform: 'twitch',
      title: 'Epic Stream Moment',
      durationSec: 7200,
      localPath: '/data/downloads/vid123.mp4',
    });
    expect(typeof source.downloadedAt).toBe('string');
    expect(Number.isNaN(Date.parse(source.downloadedAt))).toBe(false);
  });

  it('passes a format filter when maxHeight is given', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: JSON.stringify(META) })
      .mockResolvedValueOnce({ stdout: '/data/downloads/vid123.mp4' });

    await new YtDlpDownloader().download('https://youtu.be/abc', { maxHeight: 1080 });

    const secondArgs = execaMock.mock.calls[1] as [string, string[]];
    expect(secondArgs[1]).toContain('-f');
    expect(secondArgs[1].join(' ')).toContain('height<=1080');
  });

  it('honors an outDir override', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: JSON.stringify(META) })
      .mockResolvedValueOnce({ stdout: '/custom/vid123.mp4' });

    const source = await new YtDlpDownloader().download('https://youtu.be/abc', {
      outDir: '/custom',
    });

    const secondArgs = execaMock.mock.calls[1] as [string, string[]];
    expect(secondArgs[1]).toContain('/custom/vid123.%(ext)s');
    expect(source.localPath).toBe('/custom/vid123.mp4');
  });

  it('hashes the url for an id when yt-dlp omits one', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ title: 'No Id', duration: 10 }) })
      .mockResolvedValueOnce({ stdout: '/data/downloads/somefile.mp4' });

    const source = await new YtDlpDownloader().download('https://kick.com/streamer');
    expect(source.id).toMatch(/^[0-9a-f]{16}$/);
    expect(source.platform).toBe('kick');
  });

  it('throws when metadata JSON is invalid', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'not json' });
    await expect(new YtDlpDownloader().download('https://youtu.be/abc')).rejects.toThrow(
      /parse yt-dlp metadata/i,
    );
  });

  it('throws when no downloaded path is reported', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: JSON.stringify(META) })
      .mockResolvedValueOnce({ stdout: '   ' });
    await expect(new YtDlpDownloader().download('https://youtu.be/abc')).rejects.toThrow(
      /did not report a downloaded file path/i,
    );
  });
});
