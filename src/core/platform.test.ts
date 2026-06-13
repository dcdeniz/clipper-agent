import { describe, expect, it } from 'vitest';
import { preferredH264Encoder, platformInfo } from './platform.js';

describe('platform', () => {
  it('reports the current platform', () => {
    const info = platformInfo();
    expect(info.os).toBe(process.platform);
    expect(info.isMac).toBe(process.platform === 'darwin');
  });

  it('selects a valid h264 encoder', () => {
    expect(['h264_videotoolbox', 'libx264']).toContain(preferredH264Encoder());
  });
});
