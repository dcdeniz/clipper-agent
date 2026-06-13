/**
 * Pure helpers for `{{variable}}` template interpolation. Kept dependency-free
 * and side-effect-free so they can be unit-tested in isolation and reused by any
 * {@link PromptStore} implementation.
 */

/** Matches `{{ name }}` placeholders; captures the (trimmed-at-use) inner name. */
const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Returns the distinct variable names referenced by `{{name}}` placeholders in
 * `template`, in first-seen order. Whitespace inside the braces is ignored.
 */
export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined) seen.add(name);
  }
  return [...seen];
}

/**
 * Replaces every `{{name}}` placeholder in `template` with the corresponding
 * value from `vars`. Numbers are stringified. Throws if any referenced variable
 * is absent from `vars`. Extra keys in `vars` are ignored.
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  const missing = new Set<string>();
  const out = template.replace(PLACEHOLDER, (_full, rawName: string) => {
    const name = rawName.trim();
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      missing.add(name);
      return '';
    }
    const value = vars[name];
    return typeof value === 'number' ? String(value) : (value ?? '');
  });
  if (missing.size > 0) {
    throw new Error(`Missing template variable(s): ${[...missing].sort().join(', ')}`);
  }
  return out;
}
