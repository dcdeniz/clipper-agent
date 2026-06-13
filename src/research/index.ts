/** Public barrel for the content research (clip detection) module. */
export { ClaudeClipDetector } from './clip-detector.js';
export type { ClaudeClipDetectorOptions } from './clip-detector.js';
export { buildUserPrompt, parseWindows } from './clip-detector.js';
export { clampWindow, normalizeWindows, selectCandidateText } from './normalize.js';
export type { NormalizeOptions, RawWindow } from './normalize.js';
