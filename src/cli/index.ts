#!/usr/bin/env node
/**
 * clipper-agent CLI entrypoint.
 *
 * Foundations ship a `doctor` command that verifies the environment (binaries +
 * config) so you can confirm a machine is ready before wiring the pipeline.
 * Feature modules register their own subcommands as they land.
 */
import { execa } from 'execa';
import { getConfig } from '../config/index.js';
import { createLogger } from '../core/logger.js';
import { dataPaths } from '../core/paths.js';
import { ffmpegBinary, platformInfo, preferredH264Encoder, ytDlpBinary } from '../core/platform.js';

const log = createLogger('cli');

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
    {
      groq: Boolean(cfg.llm.groqApiKey),
      anthropic: Boolean(cfg.llm.anthropicApiKey),
    },
    'llm credentials present',
  );

  log.info(ok ? 'doctor: environment looks healthy' : 'doctor: problems found (see above)');
  return ok ? 0 : 1;
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  switch (command) {
    case 'doctor': {
      process.exitCode = await doctor();
      break;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(
        [
          'clipper-agent',
          '',
          'Usage: clipper <command>',
          '',
          'Commands:',
          '  doctor   Check environment (binaries, config, paths)',
          '  help     Show this help',
        ].join('\n'),
      );
      break;
    default:
      log.error({ command }, 'unknown command');
      process.exitCode = 1;
  }
}

void main();
