/**
 * Centralized, validated configuration. Loads `.env` and parses `process.env`
 * through a zod schema so the rest of the app gets a typed, validated config object.
 *
 * Secrets are grouped by concern and marked optional — a given run (e.g. just
 * transcription in dev) should not require publishing credentials to boot. Call
 * {@link requireConfig} sections lazily where you actually need them.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const schema = z.object({
  // LLM / transcription
  GROQ_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLIPPER_RESEARCH_MODEL: z.string().default('claude-haiku-4-5'),
  CLIPPER_CAPTION_MODEL: z.string().default('claude-sonnet-4-6'),

  // Publishing — TikTok
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_ACCESS_TOKEN: z.string().optional(),

  // Publishing — Instagram
  INSTAGRAM_ACCESS_TOKEN: z.string().optional(),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional(),

  // Publishing — YouTube
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REFRESH_TOKEN: z.string().optional(),

  // Binaries (resolved from PATH when unset)
  CLIPPER_FFMPEG_PATH: z.string().optional(),
  CLIPPER_YT_DLP_PATH: z.string().optional(),

  // Runtime
  CLIPPER_DATA_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
});

export type RawConfig = z.infer<typeof schema>;

export interface Config {
  llm: {
    groqApiKey?: string;
    anthropicApiKey?: string;
    researchModel: string;
    captionModel: string;
  };
  publish: {
    tiktok: { clientKey?: string; clientSecret?: string; accessToken?: string };
    instagram: { accessToken?: string; businessAccountId?: string };
    youtube: { clientId?: string; clientSecret?: string; refreshToken?: string };
  };
  bin: {
    ffmpegPath?: string;
    ytDlpPath?: string;
  };
  runtime: {
    dataDir?: string;
    logLevel: RawConfig['LOG_LEVEL'];
    logFormat: RawConfig['LOG_FORMAT'];
  };
}

let cached: Config | undefined;

/** Parse and cache config. Throws if env is structurally invalid. */
export function getConfig(): Config {
  if (cached) return cached;
  const env = schema.parse(process.env);
  cached = {
    llm: {
      groqApiKey: env.GROQ_API_KEY,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      researchModel: env.CLIPPER_RESEARCH_MODEL,
      captionModel: env.CLIPPER_CAPTION_MODEL,
    },
    publish: {
      tiktok: {
        clientKey: env.TIKTOK_CLIENT_KEY,
        clientSecret: env.TIKTOK_CLIENT_SECRET,
        accessToken: env.TIKTOK_ACCESS_TOKEN,
      },
      instagram: {
        accessToken: env.INSTAGRAM_ACCESS_TOKEN,
        businessAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
      },
      youtube: {
        clientId: env.YOUTUBE_CLIENT_ID,
        clientSecret: env.YOUTUBE_CLIENT_SECRET,
        refreshToken: env.YOUTUBE_REFRESH_TOKEN,
      },
    },
    bin: {
      ffmpegPath: env.CLIPPER_FFMPEG_PATH,
      ytDlpPath: env.CLIPPER_YT_DLP_PATH,
    },
    runtime: {
      dataDir: env.CLIPPER_DATA_DIR,
      logLevel: env.LOG_LEVEL,
      logFormat: env.LOG_FORMAT,
    },
  };
  return cached;
}

/** Test helper: clear the cached config so the next getConfig() re-reads env. */
export function resetConfigCache(): void {
  cached = undefined;
}

/** Assert that a required value is present, throwing a clear error if not. */
export function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}
