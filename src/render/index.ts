/** Public barrel for the render module (caption writing + ffmpeg rendering). */
export { ClaudeCaptionWriter } from './captionWriter.js';
export {
  FfmpegRenderer,
  buildFfmpegArgs,
  escapeDrawText,
  TARGET_WIDTH,
  TARGET_HEIGHT,
} from './renderer.js';
export type { BuildFfmpegArgsOptions } from './renderer.js';
