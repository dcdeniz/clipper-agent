/**
 * Process-wide structured logger (pino). Pretty output in dev, JSON in prod.
 * Use {@link createLogger} to get a child logger scoped to a module.
 */
import pino from 'pino';
import { getConfig } from '../config/index.js';

function buildRootLogger(): pino.Logger {
  const { logLevel, logFormat } = getConfig().runtime;
  if (logFormat === 'pretty') {
    return pino({
      level: logLevel,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }
  return pino({ level: logLevel });
}

let root: pino.Logger | undefined;

export function rootLogger(): pino.Logger {
  if (!root) root = buildRootLogger();
  return root;
}

/** Create a logger bound to a module name, e.g. createLogger('ingest'). */
export function createLogger(module: string): pino.Logger {
  return rootLogger().child({ module });
}

export type Logger = pino.Logger;
