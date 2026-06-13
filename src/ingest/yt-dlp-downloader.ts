/**
 * {@link Downloader} backed by yt-dlp. Fetches source metadata, downloads the
 * media file into the data downloads dir, and derives a {@link SourceVideo}.
 */
import { execa } from 'execa';
import { createHash } from 'node:crypto';
import type { Downloader, DownloadOptions } from '../core/contracts.js';
import { createLogger } from '../core/logger.js';
import { dataPaths, ensureDataDirs } from '../core/paths.js';
import { ytDlpBinary } from '../core/platform.js';
import type { SourceVideo } from '../core/types.js';
import { detectPlatform } from './platform.js';

const log = createLogger('ingest');

/** Subset of the yt-dlp `--dump-single-json` payload we rely on. */
interface YtDlpMetadata {
  id?: unknown;
  title?: unknown;
  duration?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Stable fallback id derived from the URL when yt-dlp does not supply one. */
function hashUrl(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

export class YtDlpDownloader implements Downloader {
  async download(url: string, opts?: DownloadOptions): Promise<SourceVideo> {
    await ensureDataDirs();
    const bin = ytDlpBinary();
    const outDir = opts?.outDir ?? dataPaths().downloads;

    // 1) Fetch metadata as JSON (no download yet).
    log.debug({ url }, 'fetching yt-dlp metadata');
    const metaResult = await execa(bin, ['--dump-single-json', '--no-warnings', url]);
    let meta: YtDlpMetadata;
    try {
      meta = JSON.parse(metaResult.stdout) as YtDlpMetadata;
    } catch (err) {
      throw new Error(`Failed to parse yt-dlp metadata JSON: ${(err as Error).message}`);
    }

    const id = asString(meta.id) ?? hashUrl(url);
    const title = asString(meta.title) ?? id;
    const durationSec = asNumber(meta.duration) ?? 0;

    // 2) Download the media file to a deterministic path inside outDir.
    //    %(ext)s lets yt-dlp choose the container; we print the final path.
    const outputTemplate = `${outDir}/${id}.%(ext)s`;
    const downloadArgs = ['--no-warnings', '--no-progress', '-o', outputTemplate];
    if (opts?.maxHeight !== undefined) {
      downloadArgs.push(
        '-f',
        `bestvideo[height<=${opts.maxHeight}]+bestaudio/best[height<=${opts.maxHeight}]`,
      );
    }
    // --print after_move:filepath emits the final on-disk path (post-merge/rename).
    downloadArgs.push('--print', 'after_move:filepath', url);

    log.debug({ url, outDir, id }, 'downloading source via yt-dlp');
    const dlResult = await execa(bin, downloadArgs);
    const localPath = dlResult.stdout.trim().split('\n').pop()?.trim();
    if (!localPath) {
      throw new Error('yt-dlp did not report a downloaded file path');
    }

    const source: SourceVideo = {
      id,
      url,
      platform: detectPlatform(url),
      title,
      durationSec,
      localPath,
      downloadedAt: new Date().toISOString(),
    };
    log.info({ id: source.id, platform: source.platform }, 'downloaded source video');
    return source;
  }
}
