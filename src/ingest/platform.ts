/**
 * Source-platform detection from a URL. Pure, side-effect-free helper so it can
 * be unit-tested and reused by the downloader.
 */
import type { SourcePlatform } from '../core/types.js';

/**
 * Infer the {@link SourcePlatform} from a source URL by inspecting its host.
 * Falls back to 'other' for unknown hosts or unparseable URLs.
 */
export function detectPlatform(url: string): SourcePlatform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  // Strip a leading "www." for simpler matching.
  const h = host.startsWith('www.') ? host.slice(4) : host;

  if (h === 'twitch.tv' || h.endsWith('.twitch.tv')) return 'twitch';
  if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be') return 'youtube';
  if (h === 'kick.com' || h.endsWith('.kick.com')) return 'kick';
  return 'other';
}
