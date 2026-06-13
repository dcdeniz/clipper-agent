import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PromptTemplate } from '../core/contracts.js';
import { BUILTIN_PROMPTS } from './builtins.js';
import { FilePromptStore, compareVersions } from './store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prompts-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sample = (version: string): PromptTemplate => ({
  name: 'greet',
  version,
  template: 'Hello {{who}}',
  variables: ['who'],
  description: 'test',
});

describe('compareVersions', () => {
  it('orders numeric segments numerically', () => {
    expect(compareVersions('1.10.0', '1.2.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });
});

describe('FilePromptStore', () => {
  it('round-trips save and load from a temp dir', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: false });
    const tmpl = sample('1.0.0');
    await store.save(tmpl);
    const loaded = await store.get('greet', '1.0.0');
    expect(loaded).toEqual(tmpl);
  });

  it('returns the latest version when version omitted', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: false });
    await store.save(sample('1.0.0'));
    await store.save(sample('1.10.0'));
    await store.save(sample('1.2.0'));
    const latest = await store.get('greet');
    expect(latest.version).toBe('1.10.0');
  });

  it('throws for an unknown name', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: false });
    await expect(store.get('nope')).rejects.toThrow(/no prompt template named/i);
  });

  it('throws for an unknown version', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: false });
    await store.save(sample('1.0.0'));
    await expect(store.get('greet', '9.9.9')).rejects.toThrow(/no version/i);
  });

  it('renders by interpolating declared variables', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: false });
    await store.save(sample('1.0.0'));
    expect(await store.render('greet', { who: 'world' })).toBe('Hello world');
  });

  it('throws on a missing declared variable', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: false });
    await store.save(sample('1.0.0'));
    await expect(store.render('greet', {})).rejects.toThrow(/missing declared variable/i);
  });

  it('exposes built-ins as a fallback without touching disk', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: true });
    const research = await store.get('clip-research');
    expect(research.name).toBe('clip-research');
    const caption = await store.get('caption-writer');
    expect(caption.name).toBe('caption-writer');

    const listed = await store.list();
    for (const b of BUILTIN_PROMPTS) {
      expect(listed.some((t) => t.name === b.name && t.version === b.version)).toBe(true);
    }
  });

  it('built-in templates declare every placeholder they reference', async () => {
    const store = new FilePromptStore({ dir, useBuiltins: false });
    const written = await store.seedBuiltins();
    expect(written.length).toBe(BUILTIN_PROMPTS.length);
    // Rendering a seeded built-in with all declared vars should not throw.
    const research = await store.get('clip-research');
    const vars: Record<string, string | number> = {};
    for (const v of research.variables) vars[v] = 'x';
    await expect(store.render('clip-research', vars)).resolves.toContain('x');
  });
});
