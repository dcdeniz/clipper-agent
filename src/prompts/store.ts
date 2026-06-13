/**
 * File-backed {@link PromptStore}.
 *
 * On-disk format: one JSON file per template version named
 * `<name>.<version>.json` inside a prompts directory (default: a `prompts`
 * subdir of {@link dataPaths}().root). Each file contains a serialized
 * {@link PromptTemplate}.
 *
 * Built-in templates (see {@link BUILTIN_PROMPTS}) act as a fallback: if a
 * requested template is not on disk, the matching built-in is used. Call
 * {@link FilePromptStore.seedBuiltins} to materialize the built-ins to disk.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { PromptStore, PromptTemplate } from '../core/contracts.js';
import { createLogger } from '../core/logger.js';
import { dataPaths } from '../core/paths.js';
import { BUILTIN_PROMPTS } from './builtins.js';
import { interpolate } from './interpolate.js';

const log = createLogger('prompts');

const promptTemplateSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  template: z.string(),
  variables: z.array(z.string()),
  description: z.string().optional(),
});

/** Suffix for on-disk template files. */
const FILE_EXT = '.json';

export interface FilePromptStoreOptions {
  /**
   * Directory to load/save templates from. Defaults to a `prompts` subdir of
   * the data root. Override for tests.
   */
  dir?: string;
  /**
   * When true (default), templates not found on disk fall back to the bundled
   * {@link BUILTIN_PROMPTS}.
   */
  useBuiltins?: boolean;
}

/**
 * Compares two dotted version strings (e.g. "1.10.0" > "1.2.0"). Numeric
 * segments compare numerically; non-numeric segments compare lexically. Returns
 * a negative/zero/positive number suitable for `Array.prototype.sort`.
 */
export function compareVersions(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const ap = as[i] ?? '0';
    const bp = bs[i] ?? '0';
    const an = Number(ap);
    const bn = Number(bp);
    const bothNumeric = !Number.isNaN(an) && !Number.isNaN(bn);
    if (bothNumeric) {
      if (an !== bn) return an - bn;
    } else if (ap !== bp) {
      return ap < bp ? -1 : 1;
    }
  }
  return 0;
}

export class FilePromptStore implements PromptStore {
  private readonly dir: string;
  private readonly useBuiltins: boolean;

  constructor(opts: FilePromptStoreOptions = {}) {
    this.dir = opts.dir ?? join(dataPaths().root, 'prompts');
    this.useBuiltins = opts.useBuiltins ?? true;
  }

  /** The directory this store reads from / writes to. */
  get directory(): string {
    return this.dir;
  }

  /** Reads every `<name>.<version>.json` template from disk. */
  private async loadFromDisk(): Promise<PromptTemplate[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = entries.filter((f) => f.endsWith(FILE_EXT));
    const out: PromptTemplate[] = [];
    for (const file of files) {
      const full = join(this.dir, file);
      try {
        const raw = await readFile(full, 'utf8');
        out.push(promptTemplateSchema.parse(JSON.parse(raw)));
      } catch (err) {
        log.warn({ file: full, err }, 'skipping invalid prompt template file');
      }
    }
    return out;
  }

  /**
   * All templates: those on disk, plus any built-in whose (name, version) is not
   * already present on disk (when `useBuiltins`).
   */
  async list(): Promise<PromptTemplate[]> {
    const onDisk = await this.loadFromDisk();
    if (!this.useBuiltins) return onDisk;
    const have = new Set(onDisk.map((t) => `${t.name}@${t.version}`));
    const merged = [...onDisk];
    for (const b of BUILTIN_PROMPTS) {
      if (!have.has(`${b.name}@${b.version}`)) merged.push(b);
    }
    return merged;
  }

  /**
   * Returns the template for `name`. When `version` is given, returns that exact
   * version; otherwise returns the highest version available. Throws if none
   * match.
   */
  async get(name: string, version?: string): Promise<PromptTemplate> {
    const all = await this.list();
    const candidates = all.filter((t) => t.name === name);
    if (candidates.length === 0) {
      throw new Error(`No prompt template named "${name}"`);
    }
    if (version !== undefined) {
      const exact = candidates.find((t) => t.version === version);
      if (!exact) {
        const known = candidates.map((t) => t.version).join(', ');
        throw new Error(`Prompt template "${name}" has no version "${version}" (have: ${known})`);
      }
      return exact;
    }
    return candidates.reduce((latest, t) =>
      compareVersions(t.version, latest.version) > 0 ? t : latest,
    );
  }

  /**
   * Renders a template by interpolating `vars`. Throws if a declared variable
   * (or any `{{placeholder}}` in the template) is absent from `vars`.
   */
  async render(
    name: string,
    vars: Record<string, string | number>,
    version?: string,
  ): Promise<string> {
    const tmpl = await this.get(name, version);
    const declaredMissing = tmpl.variables.filter(
      (v) => !Object.prototype.hasOwnProperty.call(vars, v),
    );
    if (declaredMissing.length > 0) {
      throw new Error(
        `Prompt "${name}" missing declared variable(s): ${declaredMissing
          .slice()
          .sort()
          .join(', ')}`,
      );
    }
    return interpolate(tmpl.template, vars);
  }

  /** Persists a template to disk as `<name>.<version>.json`. */
  async save(template: PromptTemplate): Promise<void> {
    const validated = promptTemplateSchema.parse(template);
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${validated.name}.${validated.version}${FILE_EXT}`);
    await writeFile(file, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    log.debug({ file }, 'saved prompt template');
  }

  /**
   * Writes any built-in templates that are not yet on disk. Existing files are
   * left untouched. Returns the names of templates written.
   */
  async seedBuiltins(): Promise<string[]> {
    const onDisk = await this.loadFromDisk();
    const have = new Set(onDisk.map((t) => `${t.name}@${t.version}`));
    const written: string[] = [];
    for (const b of BUILTIN_PROMPTS) {
      if (have.has(`${b.name}@${b.version}`)) continue;
      await this.save(b);
      written.push(`${b.name}@${b.version}`);
    }
    return written;
  }
}
