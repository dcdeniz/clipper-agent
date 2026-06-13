#!/usr/bin/env node
/**
 * clipper-agent CLI entrypoint.
 *
 * Commands:
 *   doctor              Check environment (binaries, config, paths)
 *   clip <url>          Run the full pipeline once for a source URL
 *   enqueue <url>       Add a source URL to the job queue
 *   worker [--once]     Run the queue worker (24/7 daemon; --once drains and exits)
 *   review [port]       Start the local review-gate web UI (default port 4310)
 *   publish             Publish approved clips to the configured platforms
 *   help                Show this help
 */
import { execa } from 'execa';
import { getConfig } from '../config/index.js';
import { createLogger } from '../core/logger.js';
import { dataPaths } from '../core/paths.js';
import { ffmpegBinary, platformInfo, preferredH264Encoder, ytDlpBinary } from '../core/platform.js';
import { ReviewStore, createReviewServer } from '../harness/index.js';
import { enqueueSource, publishApproved, runClipPipeline, runWorker } from '../worker/index.js';

const log = createLogger('cli');
const DEFAULT_REVIEW_PORT = 4310;

async function checkBinary(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, args);
    return stdout.split('\n')[0] ?? '';
  } catch {
    return null;
  }
}

async function doctor(): Promise<number> {
  const cfg = getConfig();
  const plat = platformInfo();
  const paths = dataPaths();

  log.info({ os: plat.os, appleSilicon: plat.isAppleSilicon }, 'platform');
  log.info({ encoder: preferredH264Encoder() }, 'preferred h264 encoder');
  log.info({ dataDir: paths.root }, 'data directory');

  const ffmpegVersion = await checkBinary(ffmpegBinary(), ['-version']);
  const ytDlpVersion = await checkBinary(ytDlpBinary(), ['--version']);

  let ok = true;
  if (ffmpegVersion) log.info({ ffmpeg: ffmpegVersion }, 'ffmpeg OK');
  else {
    log.error('ffmpeg not found (install it or set CLIPPER_FFMPEG_PATH)');
    ok = false;
  }
  if (ytDlpVersion) log.info({ ytDlp: ytDlpVersion }, 'yt-dlp OK');
  else {
    log.error('yt-dlp not found (install it or set CLIPPER_YT_DLP_PATH)');
    ok = false;
  }

  log.info(
    { groq: Boolean(cfg.llm.groqApiKey), anthropic: Boolean(cfg.llm.anthropicApiKey) },
    'llm credentials present',
  );
  log.info(ok ? 'doctor: environment looks healthy' : 'doctor: problems found (see above)');
  return ok ? 0 : 1;
}

async function clip(url: string | undefined): Promise<number> {
  if (!url) {
    log.error('usage: clipper clip <url>');
    return 1;
  }
  const result = await runClipPipeline(url);
  log.info(
    {
      source: result.source.title,
      candidates: result.candidates.length,
      rendered: result.clips.length,
      failed: result.failures.length,
    },
    'clip: pipeline finished — clips are awaiting review (run `clipper review`)',
  );
  return result.clips.length > 0 ? 0 : 1;
}

async function enqueue(url: string | undefined): Promise<number> {
  if (!url) {
    log.error('usage: clipper enqueue <url>');
    return 1;
  }
  const job = await enqueueSource(url);
  log.info({ jobId: job.id, url }, 'enqueue: source queued');
  return 0;
}

async function review(portArg: string | undefined): Promise<number> {
  const port = portArg ? Number(portArg) : DEFAULT_REVIEW_PORT;
  if (Number.isNaN(port)) {
    log.error('usage: clipper review [port]');
    return 1;
  }
  const store = new ReviewStore();
  const server = createReviewServer(store);
  server.listen(port, () => {
    log.info(
      { url: `http://localhost:${port}` },
      'review: UI listening — open it to approve/reject clips',
    );
  });
  // Keep the process alive until interrupted.
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  server.close();
  return 0;
}

async function publish(): Promise<number> {
  const results = await publishApproved();
  const published = results.filter((r) => r.results.some((x) => x.status === 'published')).length;
  log.info({ clips: results.length, published }, 'publish: finished');
  return 0;
}

function printHelp(): void {
  console.log(
    [
      'clipper-agent',
      '',
      'Usage: clipper <command>',
      '',
      'Commands:',
      '  doctor             Check environment (binaries, config, paths)',
      '  clip <url>         Run the full pipeline once for a source URL',
      '  enqueue <url>      Add a source URL to the job queue',
      '  worker [--once]    Run the queue worker (24/7 daemon; --once drains and exits)',
      '  review [port]      Start the local review-gate web UI (default 4310)',
      '  publish            Publish approved clips to configured platforms',
      '  help               Show this help',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'doctor':
      process.exitCode = await doctor();
      break;
    case 'clip':
      process.exitCode = await clip(rest[0]);
      break;
    case 'enqueue':
      process.exitCode = await enqueue(rest[0]);
      break;
    case 'worker':
      await runWorker({ once: rest.includes('--once') });
      break;
    case 'review':
      process.exitCode = await review(rest[0]);
      break;
    case 'publish':
      process.exitCode = await publish();
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      log.error({ command }, 'unknown command');
      printHelp();
      process.exitCode = 1;
  }
}

void main();
