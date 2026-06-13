import { describe, expect, it } from 'vitest';
import { detectPlatform } from './platform.js';

describe('detectPlatform', () => {
  it('detects twitch', () => {
    expect(detectPlatform('https://www.twitch.tv/somestreamer')).toBe('twitch');
    expect(detectPlatform('https://twitch.tv/videos/123456')).toBe('twitch');
  });

  it('detects youtube (including youtu.be)', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(detectPlatform('https://youtu.be/abc')).toBe('youtube');
  });

  it('detects kick', () => {
    expect(detectPlatform('https://kick.com/somestreamer')).toBe('kick');
  });

  it('falls back to other for unknown hosts', () => {
    expect(detectPlatform('https://example.com/video')).toBe('other');
  });

  it('falls back to other for unparseable urls', () => {
    expect(detectPlatform('not a url')).toBe('other');
  });
});
