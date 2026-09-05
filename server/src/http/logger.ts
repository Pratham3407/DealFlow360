import pino from 'pino';
import { env } from '../config/env';

/**
 * Application logger.
 *
 * Pretty-printed in development, single-line JSON everywhere else. Fields that
 * routinely carry credentials or session material are redacted so an accidental
 * `logger.info({ req })` cannot leak them.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.tokenHash',
    ],
    censor: '[redacted]',
  },
  ...(env.isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
