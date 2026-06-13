/**
 * Vertical clip rendering with caption burn-in via ffmpeg.
 *
 * `buildFfmpegArgs` is a pure function (no I/O) so it can be unit-tested without
 * invoking ffmpeg. `FfmpegRenderer.render()` wires it up to `execa`.
 */
import { execa } from 'execa';
import { join } from 'node:path';
import { ensureDataDirs } from '../core/paths.js';
import { createLogger } from '../core/logger.js';
import { ffmpegBinary, preferredH264Encoder } from '../core/platform.js';
import type { Renderer } from '../core/contracts.js';
import type { Caption, CaptionStyle, Clip, ClipCandidate, SourceVideo } from '../core/types.js';

/** Target vertical (portrait) dimensions for short-form clips. */
export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;

/** Default caption style used when the caption carries no style hint. */
const DEFAULT_STYLE: Required<Pick<CaptionStyle, 'fontSizePx' | 'color' | 'position'>> = {
  fontSizePx: 64,
  color: '#FFFFFF',
  position: 'bottom',
};

/**
 * Escape text for use inside an ffmpeg `drawtext` filter `text=` value.
 *
 * ffmpeg's filtergraph parser treats `\`, `:`, `'`, and `%` specially, and
 * literal newlines must be encoded. Order matters: backslashes first.
 */
export function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n');
}

/** Map a caption position to a `drawtext` y-expression. */
function positionToY(position: CaptionStyle['position'], fontSizePx: number): string {
  switch (position) {
    case 'top':
      return `${fontSizePx}`;
    case 'center':
      return '(h-text_h)/2';
    case 'bottom':
    default:
      return `h-text_h-${fontSizePx * 2}`;
  }
}

/** Convert a `#RRGGBB` hex color to ffmpeg's `0xRRGGBB` form. */
function toFfmpegColor(color: string): string {
  if (color.startsWith('#')) return `0x${color.slice(1)}`;
  return color;
}

export interface BuildFfmpegArgsOptions {
  /** Absolute path to the source media file. */
  inputPath: string;
  /** Clip start time in seconds. */
  startSec: number;
  /** Clip end time in seconds. */
  endSec: number;
  /** Absolute path to write the rendered clip to. */
  outputPath: string;
  /** Caption text to burn in (raw, will be escaped). */
  captionText: string;
  /** H.264 encoder to use (e.g. from `preferredH264Encoder()`). */
  encoder: string;
  /** Target output width in pixels. */
  width: number;
  /** Target output height in pixels. */
  height: number;
  /** Optional caption style hints. */
  style?: CaptionStyle;
}

/**
 * Build the ffmpeg argument vector to cut a window, reframe to vertical, and
 * burn in a caption. Pure: no side effects, deterministic output.
 */
export function buildFfmpegArgs(opts: BuildFfmpegArgsOptions): string[] {
  const { inputPath, startSec, endSec, outputPath, captionText, encoder, width, height, style } =
    opts;

  const fontSizePx = style?.fontSizePx ?? DEFAULT_STYLE.fontSizePx;
  const color = toFfmpegColor(style?.color ?? DEFAULT_STYLE.color);
  const position = style?.position ?? DEFAULT_STYLE.position;

  // Scale to cover the target, then center-crop to the exact vertical frame.
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase`;
  const crop = `crop=${width}:${height}`;

  const drawtext = [
    `drawtext=text='${escapeDrawText(captionText)}'`,
    `fontsize=${fontSizePx}`,
    `fontcolor=${color}`,
    'box=1',
    'boxcolor=black@0.5',
    'boxborderw=20',
    'x=(w-text_w)/2',
    `y=${positionToY(position, fontSizePx)}`,
  ].join(':');

  const filter = `${scale},${crop},${drawtext}`;

  return [
    '-y',
    '-ss',
    `${startSec}`,
    '-to',
    `${endSec}`,
    '-i',
    inputPath,
    '-vf',
    filter,
    '-c:v',
    encoder,
    '-c:a',
    'aac',
    outputPath,
  ];
}

/** Renderer that cuts and reframes clips via ffmpeg with a burned-in caption. */
export class FfmpegRenderer implements Renderer {
  private readonly log = createLogger('render:ffmpeg');

  async render(source: SourceVideo, candidate: ClipCandidate, caption: Caption): Promise<Clip> {
    const paths = await ensureDataDirs();
    const renderedPath = join(paths.clips, `${candidate.id}.mp4`);

    const args = buildFfmpegArgs({
      inputPath: source.localPath,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      outputPath: renderedPath,
      captionText: caption.text,
      encoder: preferredH264Encoder(),
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      style: caption.style,
    });

    const bin = ffmpegBinary();
    this.log.info({ candidateId: candidate.id, renderedPath }, 'rendering clip');
    await execa(bin, args);

    return {
      id: candidate.id,
      candidateId: candidate.id,
      sourceId: source.id,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      caption,
      renderedPath,
      status: 'rendered',
    };
  }
}
