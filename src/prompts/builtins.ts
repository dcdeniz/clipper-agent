/**
 * Built-in default prompt templates bundled with the repo.
 *
 * These are defined as TypeScript constants (rather than imported JSON) so the
 * build has no dependency on JSON resolution or on copying asset files into
 * `dist/`. {@link FilePromptStore} can seed these to disk and falls back to them
 * when an on-disk template is missing.
 *
 * Each entry conforms to {@link PromptTemplate}. Variables referenced as
 * `{{name}}` in `template` must be listed in `variables`.
 */
import type { PromptTemplate } from '../core/contracts.js';

/**
 * Scores transcript segments for short-form virality. Intended for the research
 * module's {@link ClipDetector}. Expects the model to return strict JSON so the
 * output can be parsed programmatically.
 */
const clipResearch: PromptTemplate = {
  name: 'clip-research',
  version: '1.0.0',
  description:
    'Scores transcript segments of a livestream/VOD for short-form (TikTok/Reels/Shorts) virality and proposes clip windows.',
  variables: ['transcript', 'limit', 'min_score'],
  template: `You are an expert short-form video producer who turns long livestreams into viral clips.

You will be given a timestamped transcript. Identify the most clip-worthy windows: self-contained moments that hook a viewer in the first 2 seconds and pay off within 60 seconds. Favor strong emotion, surprise, conflict, hot takes, comedic beats, and quotable lines. Avoid slow setups, dead air, and context that requires the rest of the stream to understand.

Scoring rubric (virality, 0-100):
- 90-100: instantly gripping, highly shareable, stands completely on its own.
- 70-89: strong hook and payoff, minor context needed.
- 50-69: interesting but slower or more niche.
- below 50: not worth clipping.

Constraints:
- Return at most {{limit}} candidates.
- Only include candidates with a score >= {{min_score}}.
- Each clip should be between 8 and 60 seconds long.
- Use timestamps that exist in the transcript; do not invent times.

Respond with ONLY a JSON array (no prose, no markdown fences). Each element:
{
  "startSec": number,        // clip start in seconds
  "endSec": number,          // clip end in seconds
  "score": number,           // virality score 0-100
  "title": string,           // short internal label for the moment
  "reason": string,          // one sentence on why it will perform
  "hook": string             // the spoken line/beat that hooks viewers
}

Order the array from highest score to lowest.

Transcript:
{{transcript}}`,
};

/**
 * Writes a single sensationalist short-form caption for a chosen clip.
 * Intended for the render module's {@link CaptionWriter}.
 */
const captionWriter: PromptTemplate = {
  name: 'caption-writer',
  version: '1.0.0',
  description:
    'Writes one punchy, sensationalist caption (plus hashtags) for a short-form clip given its transcript and context.',
  variables: ['clip_transcript', 'topic', 'max_length'],
  template: `You write captions for short-form videos (TikTok, Reels, YouTube Shorts) that maximize click-through and watch time.

Write ONE caption for the clip described below.

Style:
- Open with a curiosity gap or bold claim that makes scrolling impossible.
- Punchy and conversational; sensationalist but never fabricating facts not present in the clip.
- No spoilers that kill the reason to watch.
- At most {{max_length}} characters for the caption text (excluding hashtags).
- End with 3-5 relevant, high-traffic hashtags.

Topic / context: {{topic}}

Clip transcript:
{{clip_transcript}}

Respond with ONLY a JSON object (no prose, no markdown fences):
{
  "caption": string,         // the caption text, within the length limit
  "hashtags": string[]       // 3-5 hashtags, each starting with #
}`,
};

/** All built-in templates, in a stable order. */
export const BUILTIN_PROMPTS: readonly PromptTemplate[] = [clipResearch, captionWriter];
