/**
 * Cross-platform data directories. Works the same on Windows 11 (dev) and the
 * Mac mini (24/7 prod) by deriving an OS-appropriate base dir via env-paths,
 * overridable with CLIPPER_DATA_DIR.
 *
 * Always build paths through these helpers — never hardcode separators.
 */
import envPaths from 'env-paths';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '../config/index.js';

function baseDir(): string {
  const override = getConfig().runtime.dataDir;
  if (override) return override;
  // suffix:'' keeps the dir name as "clipper-agent" without an OS-specific suffix.
  return envPaths('clipper-agent', { suffix: '' }).data;
}

export interface DataPaths {
  /** Root data directory. */
  root: string;
  /** Downloaded source videos. */
  downloads: string;
  /** Rendered clips. */
  clips: string;
  /** Persistent work queue / job state. */
  work: string;
  /** Transcripts and intermediate artifacts. */
  artifacts: string;
  /** Log files (when file logging is enabled). */
  logs: string;
}

export function dataPaths(): DataPaths {
  const root = baseDir();
  return {
    root,
    downloads: join(root, 'downloads'),
    clips: join(root, 'clips'),
    work: join(root, 'work'),
    artifacts: join(root, 'artifacts'),
    logs: join(root, 'logs'),
  };
}

/** Ensure all data directories exist. Safe to call repeatedly. */
export async function ensureDataDirs(): Promise<DataPaths> {
  const paths = dataPaths();
  await Promise.all(
    [paths.downloads, paths.clips, paths.work, paths.artifacts, paths.logs].map((p) =>
      mkdir(p, { recursive: true }),
    ),
  );
  return paths;
}
