/**
 * YouTube publisher — uploads a rendered clip as a YouTube Short via the Data API.
 *
 * Flow:
 *   1. Exchange the long-lived `refreshToken` for a short-lived access token at
 *      https://oauth2.googleapis.com/token (grant_type=refresh_token).
 *   2. POST the snippet/status JSON to the resumable upload endpoint to obtain an
 *      upload session URL (returned in the `Location` response header).
 *   3. PUT the raw file bytes to that session URL.
 *
 * The title is derived from the clip caption and `#Shorts` is appended so YouTube
 * classifies the (vertical, <60s) video as a Short.
 *
 * See: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 *
 * Requires a real `YOUTUBE_REFRESH_TOKEN` (+ client id/secret) to validate
 * end-to-end; without credentials `publish()` returns a `skipped` result.
 */
import { readFile } from 'node:fs/promises';
import type { Logger } from '../core/logger.js';
import { createLogger } from '../core/logger.js';
import { getConfig } from '../config/index.js';
import type { Publisher } from '../core/contracts.js';
import type { Clip, PublishResult, PublishTarget } from '../core/types.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RESUMABLE_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface VideoResource {
  id?: string;
  error?: { message?: string };
}

export class YouTubePublisher implements Publisher {
  readonly target: PublishTarget = 'youtube';
  private readonly log: Logger;

  constructor(log: Logger = createLogger('publish:youtube')) {
    this.log = log;
  }

  async publish(clip: Clip): Promise<PublishResult> {
    const { clientId, clientSecret, refreshToken } = getConfig().publish.youtube;
    if (!clientId || !clientSecret || !refreshToken) {
      this.log.warn('skipping youtube publish: missing credentials');
      return { target: this.target, status: 'skipped', error: 'missing credentials' };
    }
    if (!clip.renderedPath) {
      return { target: this.target, status: 'failed', error: 'clip has no renderedPath' };
    }

    try {
      const bytes = await readFile(clip.renderedPath);
      const accessToken = await this.getAccessToken(clientId, clientSecret, refreshToken);
      const uploadUrl = await this.initResumableUpload(
        accessToken,
        clip.caption.text,
        bytes.byteLength,
      );
      const videoId = await this.uploadBytes(uploadUrl, accessToken, bytes);
      const url = `https://www.youtube.com/shorts/${videoId}`;
      this.log.info({ videoId }, 'youtube short uploaded');
      return { target: this.target, status: 'published', postId: videoId, url };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error({ error }, 'youtube publish failed');
      return { target: this.target, status: 'failed', error };
    }
  }

  /** Step 1: exchange the refresh token for a short-lived access token. */
  private async getAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || json.error || !json.access_token) {
      throw new Error(
        `youtube token exchange failed: ${res.status} ${json.error_description ?? json.error ?? ''}`.trim(),
      );
    }
    return json.access_token;
  }

  /** Step 2: start a resumable upload session and return its upload URL. */
  private async initResumableUpload(
    accessToken: string,
    caption: string,
    fileSize: number,
  ): Promise<string> {
    const title = `${caption} #Shorts`.slice(0, 100);
    const snippet = {
      snippet: {
        title,
        description: `${caption}\n\n#Shorts`,
      },
      status: {
        privacyStatus: 'public',
      },
    };

    const res = await fetch(RESUMABLE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify(snippet),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`youtube resumable init failed: ${res.status} ${text}`);
    }
    const uploadUrl = res.headers.get('location') ?? res.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('youtube resumable init missing Location header');
    }
    return uploadUrl;
  }

  /** Step 3: PUT the file bytes to the resumable session URL. */
  private async uploadBytes(
    uploadUrl: string,
    accessToken: string,
    bytes: Buffer,
  ): Promise<string> {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'video/mp4',
        'Content-Length': String(bytes.byteLength),
      },
      body: bytes,
    });

    const json = (await res.json().catch(() => ({}))) as VideoResource;
    if (!res.ok || json.error || !json.id) {
      throw new Error(
        `youtube upload failed: ${res.status} ${json.error?.message ?? 'no video id'}`,
      );
    }
    return json.id;
  }
}
