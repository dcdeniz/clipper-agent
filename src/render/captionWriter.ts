/**
 * Caption writing for clip candidates. Uses Claude to write punchy,
 * sensationalist short-form captions suitable to burn onto a vertical video.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getConfig, requireValue } from '../config/index.js';
import { createLogger } from '../core/logger.js';
import type { CaptionWriter } from '../core/contracts.js';
import type { Caption, CaptionStyle, ClipCandidate } from '../core/types.js';

/** Default on-screen style for burned-in captions. */
const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: 'Sans',
  fontSizePx: 64,
  color: '#FFFFFF',
  position: 'bottom',
};

const SYSTEM_PROMPT = [
  'You are a viral short-form video caption writer.',
  'Given a transcript snippet from a livestream clip, write ONE punchy,',
  'sensationalist caption that hooks viewers and is relevant to the content.',
  'Rules:',
  '- Keep it SHORT (max ~8 words) so it can be burned onto a vertical video.',
  '- Be sensationalist and attention-grabbing, but stay relevant to the clip.',
  '- Output ONLY the caption text. No quotes, no hashtags, no preamble.',
].join(' ');

/** Caption writer backed by the Anthropic Messages API. */
export class ClaudeCaptionWriter implements CaptionWriter {
  private readonly log = createLogger('render:caption');
  private client: Anthropic | undefined;

  /** Lazily construct the Anthropic client so config/env is read on first use. */
  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = requireValue(getConfig().llm.anthropicApiKey, 'ANTHROPIC_API_KEY');
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async write(candidate: ClipCandidate): Promise<Caption> {
    const model = getConfig().llm.captionModel;
    const client = this.getClient();

    this.log.debug({ candidateId: candidate.id, model }, 'writing caption');

    const userPrompt = [
      `Clip reason: ${candidate.reason}`,
      '',
      'Transcript:',
      candidate.transcriptText,
    ].join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (text === '') {
      throw new Error(`Caption model returned no text for candidate ${candidate.id}`);
    }

    return { text, style: DEFAULT_CAPTION_STYLE };
  }
}
