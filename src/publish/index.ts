/**
 * Publishing module barrel + factory.
 *
 * Exposes one {@link Publisher} per supported {@link PublishTarget} and a
 * {@link createPublishers} factory to instantiate the requested (or all) adapters.
 */
import type { Publisher } from '../core/contracts.js';
import type { PublishTarget } from '../core/types.js';
import { TikTokPublisher } from './tiktok.js';
import { InstagramPublisher } from './instagram.js';
import type { InstagramPublisherOptions } from './instagram.js';
import { YouTubePublisher } from './youtube.js';

export { TikTokPublisher } from './tiktok.js';
export { InstagramPublisher } from './instagram.js';
export type { InstagramPublisherOptions, VideoUrlResolver } from './instagram.js';
export { YouTubePublisher } from './youtube.js';

const ALL_TARGETS: PublishTarget[] = ['tiktok', 'instagram', 'youtube'];

export interface CreatePublishersOptions {
  /** Options forwarded to the Instagram adapter (e.g. the video URL resolver). */
  instagram?: InstagramPublisherOptions;
}

/**
 * Instantiate publishers for the requested targets (defaults to all).
 * Order of the returned array matches the requested `targets` order.
 */
export function createPublishers(
  targets: PublishTarget[] = ALL_TARGETS,
  opts: CreatePublishersOptions = {},
): Publisher[] {
  return targets.map((target) => {
    switch (target) {
      case 'tiktok':
        return new TikTokPublisher();
      case 'instagram':
        return new InstagramPublisher(opts.instagram);
      case 'youtube':
        return new YouTubePublisher();
    }
  });
}
