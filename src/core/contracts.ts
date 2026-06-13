/**
 * Module contracts. Each feature module implements one of these interfaces so the
 * pipeline can be assembled (and individual modules built / tested) independently.
 */
import type {
  Caption,
  Clip,
  ClipCandidate,
  PublishResult,
  PublishTarget,
  SourceVideo,
  Transcript,
} from './types.js';

/** Downloads a source livestream/VOD to local disk (ingest module → yt-dlp). */
export interface Downloader {
  download(url: string, opts?: DownloadOptions): Promise<SourceVideo>;
}

export interface DownloadOptions {
  /** Preferred max height (e.g. 1080). */
  maxHeight?: number;
  /** Output directory override. */
  outDir?: string;
}

/** Transcribes a source video (transcribe module → Groq Whisper). */
export interface Transcriber {
  transcribe(source: SourceVideo): Promise<Transcript>;
}

/** Scores a transcript and proposes clip-worthy windows (research module → Claude). */
export interface ClipDetector {
  detect(transcript: Transcript, opts?: DetectOptions): Promise<ClipCandidate[]>;
}

export interface DetectOptions {
  /** Max number of candidates to return. */
  limit?: number;
  /** Minimum virality score (0–100) to include. */
  minScore?: number;
}

/** Writes a sensationalist caption for a candidate (render module → Claude). */
export interface CaptionWriter {
  write(candidate: ClipCandidate): Promise<Caption>;
}

/** Cuts and renders a vertical, captioned clip (render module → ffmpeg). */
export interface Renderer {
  render(source: SourceVideo, candidate: ClipCandidate, caption: Caption): Promise<Clip>;
}

/** Publishes a rendered clip to a single platform (publish module). */
export interface Publisher {
  readonly target: PublishTarget;
  publish(clip: Clip): Promise<PublishResult>;
}

/**
 * Stores and versions named agent prompts (prompts module).
 * Backs the "global agent prompt management system".
 */
export interface PromptStore {
  get(name: string, version?: string): Promise<PromptTemplate>;
  list(): Promise<PromptTemplate[]>;
  /** Render a prompt by interpolating variables. */
  render(name: string, vars: Record<string, string | number>, version?: string): Promise<string>;
}

export interface PromptTemplate {
  name: string;
  version: string;
  template: string;
  /** Declared variable names the template expects. */
  variables: string[];
  description?: string;
}
