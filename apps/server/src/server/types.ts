import type { FastifyInstance } from 'fastify';
import type { QuestDBService } from '@/database/questdb';
import type { AppConfig } from '@/services/config';
import type { NetworkMonitorInterface } from '@/services/network-monitor';
import type { PingExecutorInterface } from '@/services/ping-executor';
import type { SpeedTestServiceInterface } from '@/services/speedtest';

/**
 * Application context containing Effect services
 * This is passed to route plugins to access services
 */
export interface AppContext {
  readonly db: QuestDBService;
  readonly pingExecutor: PingExecutorInterface;
  readonly speedTestService: SpeedTestServiceInterface;
  readonly networkMonitor: NetworkMonitorInterface;
  readonly config: AppConfig;
}

/**
 * Fastify instance with app context
 */
export type AppInstance = FastifyInstance;

/**
 * Route plugin function signature
 */
export type RoutePlugin = (
  app: AppInstance,
  context: AppContext
) => Promise<void>;
