/**
 * Publish step — runs after the human review gate. Takes approved clips and
 * pushes them to the requested platforms via the publish adapters.
 */
import type { PublishResult, PublishTarget } from '../core/types.js';
import { createLogger } from '../core/logger.js';
import { ReviewStore } from '../harness/index.js';
import { createPublishers, type CreatePublishersOptions } from '../publish/index.js';

const log = createLogger('publish');

export interface PublishApprovedOptions {
  /** Which platforms to publish to (defaults to all). */
  targets?: PublishTarget[];
  /** Adapter options (e.g. Instagram video URL resolver). */
  adapters?: CreatePublishersOptions;
  /** Review store to pull approved clips from (defaults to the on-disk store). */
  reviewStore?: ReviewStore;
}

export interface PublishedClipResult {
  clipId: string;
  results: PublishResult[];
}

/**
 * Publish every approved-but-unpublished clip. Each clip is marked `published`
 * in the review store once at least one target succeeds.
 */
export async function publishApproved(
  opts: PublishApprovedOptions = {},
): Promise<PublishedClipResult[]> {
  const store = opts.reviewStore ?? new ReviewStore();
  const publishers = createPublishers(opts.targets, opts.adapters);

  const approved = await store.list('approved');
  log.info({ count: approved.length }, 'publish: approved clips to process');

  const out: PublishedClipResult[] = [];
  for (const clip of approved) {
    const results: PublishResult[] = [];
    for (const publisher of publishers) {
      const result = await publisher.publish(clip);
      results.push(result);
      log.info(
        { clipId: clip.id, target: result.target, status: result.status },
        'publish: target result',
      );
    }
    if (results.some((r) => r.status === 'published')) {
      await store.markPublished(clip.id);
    }
    out.push({ clipId: clip.id, results });
  }
  return out;
}
