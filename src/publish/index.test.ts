import { describe, expect, it } from 'vitest';
import {
  createPublishers,
  TikTokPublisher,
  InstagramPublisher,
  YouTubePublisher,
} from './index.js';
import type { PublishTarget } from '../core/types.js';

describe('createPublishers', () => {
  it('creates all publishers by default in target order', () => {
    const pubs = createPublishers();
    expect(pubs.map((p) => p.target)).toEqual(['tiktok', 'instagram', 'youtube']);
    expect(pubs[0]).toBeInstanceOf(TikTokPublisher);
    expect(pubs[1]).toBeInstanceOf(InstagramPublisher);
    expect(pubs[2]).toBeInstanceOf(YouTubePublisher);
  });

  it('creates only the requested targets, preserving order', () => {
    const targets: PublishTarget[] = ['youtube', 'tiktok'];
    const pubs = createPublishers(targets);
    expect(pubs.map((p) => p.target)).toEqual(['youtube', 'tiktok']);
  });

  it('forwards instagram options', () => {
    const pubs = createPublishers(['instagram'], {
      instagram: { resolveVideoUrl: () => 'https://cdn/x.mp4' },
    });
    expect(pubs[0]).toBeInstanceOf(InstagramPublisher);
  });
});
