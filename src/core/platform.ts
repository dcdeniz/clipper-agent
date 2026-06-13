/**
 * Platform detection and binary resolution. The same code runs on Windows 11
 * (dev) and the Apple Silicon Mac mini (24/7 prod); this module picks the right
 * ffmpeg encoder and resolves binary paths per-OS.
 */
import { getConfig } from '../config/index.js';

export interface PlatformInfo {
  os: NodeJS.Platform;
  isMac: boolean;
  isWindows: boolean;
  isAppleSilicon: boolean;
}

export function platformInfo(): PlatformInfo {
  const os = process.platform;
  return {
    os,
    isMac: os === 'darwin',
    isWindows: os === 'win32',
    isAppleSilicon: os === 'darwin' && process.arch === 'arm64',
  };
}

/**
 * Preferred H.264 video encoder for ffmpeg.
 * Apple Silicon gets hardware-accelerated VideoToolbox (faster + cooler for
 * continuous operation); everything else falls back to software libx264.
 */
export function preferredH264Encoder(): 'h264_videotoolbox' | 'libx264' {
  return platformInfo().isAppleSilicon ? 'h264_videotoolbox' : 'libx264';
}

/** Resolve the ffmpeg binary: explicit config path, else assume on PATH. */
export function ffmpegBinary(): string {
  return getConfig().bin.ffmpegPath ?? 'ffmpeg';
}

/** Resolve the yt-dlp binary: explicit config path, else assume on PATH. */
export function ytDlpBinary(): string {
  return getConfig().bin.ytDlpPath ?? 'yt-dlp';
}
