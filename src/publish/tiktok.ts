/**
 * TikTok publisher — implements the TikTok Content Posting API direct-post flow.
 *
 * Flow (FILE_UPLOAD source):
 *   1. POST .../v2/post/publish/video/init/ with Bearer accessToken to obtain a
 *      `publish_id` and a pre-signed `upload_url`.
 *   2. PUT the raw file bytes to `upload_url` with the correct `Content-Range`
 *      and `Content-Type` headers.
 *
 * See: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/
 *
 * Requires a real `TIKTOK_ACCESS_TOKEN` with the `video.publish` scope to validate
 * end-to-end; without credentials `publish()` returns a `skipped` result.
 */
import { readFile } from 'node:fs/promises';
import type { Logger } from '../core/logger.js';
import { createLogger } from '../core/logger.js';
import { getConfig } from '../config/index.js';
import type { Publisher } from '../core/contracts.js';
import type { Clip, PublishResult, PublishTarget } from '../core/types.js';

const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

interface TikTokInitResponse {
  data?: {
    publish_id?: string;
    upload_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export class TikTokPublisher implements Publisher {
  readonly target: PublishTarget = 'tiktok';
  private readonly log: Logger;

  constructor(log: Logger = createLogger('publish:tiktok')) {
    this.log = log;
  }

  async publish(clip: Clip): Promise<PublishResult> {
    const accessToken = getConfig().publish.tiktok.accessToken;
    if (!accessToken) {
      this.log.warn('skipping tiktok publish: missing access token');
      return { target: this.target, status: 'skipped', error: 'missing credentials' };
    }
    if (!clip.renderedPath) {
      return { target: this.target, status: 'failed', error: 'clip has no renderedPath' };
    }

    try {
      const bytes = await readFile(clip.renderedPath);
      const { publishId, uploadUrl } = await this.initUpload(accessToken, bytes.byteLength);
      await this.uploadFile(uploadUrl, bytes);
      this.log.info({ publishId }, 'tiktok upload complete');
      return { target: this.target, status: 'published', postId: publishId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error({ error }, 'tiktok publish failed');
      return { target: this.target, status: 'failed', error };
    }
  }

  /** Step 1: initialize a direct-post upload and obtain the pre-signed upload URL. */
  private async initUpload(
    accessToken: string,
    videoSize: number,
  ): Promise<{ publishId: string; uploadUrl: string }> {
    const res = await fetch(INIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`tiktok init failed: ${res.status} ${text}`);
    }

    const json = (await res.json()) as TikTokInitResponse;
    if (json.error && json.error.code && json.error.code !== 'ok') {
      throw new Error(`tiktok init error: ${json.error.code} ${json.error.message ?? ''}`.trim());
    }
    const publishId = json.data?.publish_id;
    const uploadUrl = json.data?.upload_url;
    if (!publishId || !uploadUrl) {
      throw new Error('tiktok init response missing publish_id/upload_url');
    }
    return { publishId, uploadUrl };
  }

  /** Step 2: PUT the file bytes to the pre-signed upload URL (single chunk). */
  private async uploadFile(uploadUrl: string, bytes: Buffer): Promise<void> {
    const size = bytes.byteLength;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${size - 1}/${size}`,
        'Content-Length': String(size),
      },
      body: bytes,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`tiktok upload failed: ${res.status} ${text}`);
    }
  }
}
