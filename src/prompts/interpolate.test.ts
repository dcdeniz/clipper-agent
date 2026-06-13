import { describe, expect, it } from 'vitest';
import { extractVariables, interpolate } from './interpolate.js';

describe('extractVariables', () => {
  it('returns distinct names in first-seen order', () => {
    expect(extractVariables('Hi {{name}}, {{name}} meet {{other}}')).toEqual(['name', 'other']);
  });

  it('ignores whitespace inside braces', () => {
    expect(extractVariables('{{  a }} and {{b}}')).toEqual(['a', 'b']);
  });

  it('returns empty array when no placeholders', () => {
    expect(extractVariables('nothing here')).toEqual([]);
  });
});

describe('interpolate', () => {
  it('replaces string and number variables', () => {
    expect(interpolate('{{a}}-{{b}}', { a: 'x', b: 2 })).toBe('x-2');
  });

  it('replaces repeated placeholders', () => {
    expect(interpolate('{{a}}{{a}}', { a: 'z' })).toBe('zz');
  });

  it('ignores extra unknown vars', () => {
    expect(interpolate('{{a}}', { a: 'ok', extra: 'unused' })).toBe('ok');
  });

  it('throws listing all missing vars', () => {
    expect(() => interpolate('{{a}} {{b}}', { a: '1' })).toThrowError(/b/);
  });
});
