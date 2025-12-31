import type { FastifyBaseLogger } from 'fastify';
import type { LoggerOptions } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || 'info';
const usePrettyLogs = process.env.LOG_PRETTY !== 'false';

export const loggerConfig: LoggerOptions = {
  name: 'wan-monitor',
  level: logLevel,
  transport: usePrettyLogs
    ? {
        target: 'pino-pretty',
        options: {
          colorize: !isProduction,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
};

export type Logger = FastifyBaseLogger;
