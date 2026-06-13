/**
 * Instagram publisher — implements the Instagram Graph API Reels publishing flow.
 *
 * Flow:
 *   1. POST .../{businessAccountId}/media with media_type=REELS, a publicly
 *      reachable `video_url`, and a `caption` to create a media container.
 *   2. POST .../{businessAccountId}/media_publish with the returned creation id.
 *
 * See: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
 *
 * IMPORTANT LIMITATION: the Graph API does NOT accept raw file uploads for Reels.
 * It requires a publicly reachable `video_url` — the rendered clip must first be
 * hosted somewhere Instagram's servers can fetch it (e.g. S3/CDN). This adapter
 * therefore takes a `videoUrl` resolver (via constructor options) that maps a
 * {@link Clip} to its hosted URL. Validating end-to-end requires real credentials
 * AND a publicly hosted clip URL.
 */
import type { Logger } from '../core/logger.js';
import { createLogger } from '../core/logger.js';
import { getConfig } from '../config/index.js';
import type { Publisher } from '../core/contracts.js';
import type { Clip, PublishResult, PublishTarget } from '../core/types.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** Resolves the publicly reachable hosted URL for a rendered clip. */
export type VideoUrlResolver = (clip: Clip) => string | undefined;

export interface InstagramPublisherOptions {
  /**
   * Resolver that returns the public `video_url` Instagram will fetch. Required
   * because the Graph API cannot accept raw bytes. If omitted, publish() returns
   * a `failed` result explaining the clip must be hosted first.
   */
  resolveVideoUrl?: VideoUrlResolver;
  log?: Logger;
}

interface IgContainerResponse {
  id?: string;
  error?: { message?: string; code?: number };
}

interface IgPublishResponse {
  id?: string;
  error?: { message?: string; code?: number };
}

export class InstagramPublisher implements Publisher {
  readonly target: PublishTarget = 'instagram';
  private readonly log: Logger;
  private readonly resolveVideoUrl: VideoUrlResolver;

  constructor(opts: InstagramPublisherOptions = {}) {
    this.log = opts.log ?? createLogger('publish:instagram');
    this.resolveVideoUrl = opts.resolveVideoUrl ?? (() => undefined);
  }

  async publish(clip: Clip): Promise<PublishResult> {
    const { accessToken, businessAccountId } = getConfig().publish.instagram;
    if (!accessToken || !businessAccountId) {
      this.log.warn('skipping instagram publish: missing credentials');
      return { target: this.target, status: 'skipped', error: 'missing credentials' };
    }

    const videoUrl = this.resolveVideoUrl(clip);
    if (!videoUrl) {
      return {
        target: this.target,
        status: 'failed',
        error: 'instagram requires a publicly reachable video_url (clip must be hosted)',
      };
    }

    try {
      const creationId = await this.createContainer(
        businessAccountId,
        accessToken,
        videoUrl,
        clip.caption.text,
      );
      const mediaId = await this.publishContainer(businessAccountId, accessToken, creationId);
      this.log.info({ mediaId }, 'instagram reel published');
      return { target: this.target, status: 'published', postId: mediaId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error({ error }, 'instagram publish failed');
      return { target: this.target, status: 'failed', error };
    }
  }

  /** Step 1: create a REELS media container, returning its creation id. */
  private async createContainer(
    businessAccountId: string,
    accessToken: string,
    videoUrl: string,
    caption: string,
  ): Promise<string> {
    const url = `${GRAPH_BASE}/${businessAccountId}/media`;
    const body = new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      access_token: accessToken,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const json = (await res.json().catch(() => ({}))) as IgContainerResponse;
    if (!res.ok || json.error || !json.id) {
      throw new Error(
        `instagram container failed: ${res.status} ${json.error?.message ?? 'no creation id'}`,
      );
    }
    return json.id;
  }

  /** Step 2: publish a previously created container by its creation id. */
  private async publishContainer(
    businessAccountId: string,
    accessToken: string,
    creationId: string,
  ): Promise<string> {
    const url = `${GRAPH_BASE}/${businessAccountId}/media_publish`;
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const json = (await res.json().catch(() => ({}))) as IgPublishResponse;
    if (!res.ok || json.error || !json.id) {
      throw new Error(
        `instagram publish failed: ${res.status} ${json.error?.message ?? 'no media id'}`,
      );
    }
    return json.id;
  }
}
