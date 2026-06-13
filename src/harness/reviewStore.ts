/**
 * Persistence for the human review gate.
 *
 * After clips are rendered they are parked here ("rendered" = pending review)
 * until a human approves or rejects them. State is a single JSON file on disk so
 * decisions survive restarts; the file is rewritten atomically on every change.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clip, ClipStatus } from '../core/types.js';
import { dataPaths } from '../core/paths.js';

const REVIEW_FILENAME = 'review.json';

/** A clip plus review-gate metadata. */
export interface ReviewRecord {
  clip: Clip;
  /** ISO timestamp the clip was submitted for review. */
  submittedAt: string;
  /** ISO timestamp of the latest approve/reject decision, if any. */
  decidedAt?: string;
  /** Reason captured when a clip is rejected. */
  rejectionReason?: string;
}

interface ReviewFile {
  records: ReviewRecord[];
}

export interface ReviewStoreOptions {
  /** Override the on-disk JSON path (used by tests). */
  filePath?: string;
}

/** File-backed store for clips moving through the review gate. */
export class ReviewStore {
  private readonly filePath: string;

  constructor(opts: ReviewStoreOptions = {}) {
    this.filePath = opts.filePath ?? join(dataPaths().work, REVIEW_FILENAME);
  }

  private async read(): Promise<ReviewFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as ReviewFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { records: [] };
      throw err;
    }
  }

  /** Rewrite the whole file atomically (write temp + rename). */
  private async write(data: ReviewFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }

  /** Record a rendered clip as pending review. */
  async submit(clip: Clip): Promise<void> {
    const data = await this.read();
    const record: ReviewRecord = {
      clip: { ...clip, status: 'rendered' },
      submittedAt: new Date().toISOString(),
    };
    const idx = data.records.findIndex((r) => r.clip.id === clip.id);
    if (idx >= 0) data.records[idx] = record;
    else data.records.push(record);
    await this.write(data);
  }

  /** All clips still awaiting a decision (status 'rendered'). */
  async listPending(): Promise<Clip[]> {
    return this.list('rendered');
  }

  /** All clips, or only those with the given status. */
  async list(status?: ClipStatus): Promise<Clip[]> {
    const data = await this.read();
    const records = status ? data.records.filter((r) => r.clip.status === status) : data.records;
    return records.map((r) => r.clip);
  }

  /** Look up a single clip by id. */
  async get(id: string): Promise<Clip | undefined> {
    const data = await this.read();
    return data.records.find((r) => r.clip.id === id)?.clip;
  }

  /** Approve a clip, moving it to status 'approved'. */
  async approve(id: string): Promise<Clip> {
    return this.decide(id, (record) => {
      record.clip.status = 'approved';
      record.decidedAt = new Date().toISOString();
      delete record.rejectionReason;
    });
  }

  /** Reject a clip, moving it to status 'rejected' and storing the reason. */
  async reject(id: string, reason?: string): Promise<Clip> {
    return this.decide(id, (record) => {
      record.clip.status = 'rejected';
      record.decidedAt = new Date().toISOString();
      if (reason !== undefined) record.rejectionReason = reason;
    });
  }

  private async decide(id: string, fn: (record: ReviewRecord) => void): Promise<Clip> {
    const data = await this.read();
    const record = data.records.find((r) => r.clip.id === id);
    if (!record) throw new Error(`Review record not found: ${id}`);
    fn(record);
    await this.write(data);
    return record.clip;
  }
}
