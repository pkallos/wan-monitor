import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  DatabaseConnectionError,
  DatabaseWriteError,
  QuestDB,
  QuestDBLive,
} from '@/database/questdb';
import { ConfigService, ConfigServiceLive } from '@/services/config';

describe('ConfigService', () => {
  it('should load config with default values', async () => {
    const program = Effect.gen(function* () {
      const config = yield* ConfigService;
      return config;
    });

    const result = await Effect.runPromise(
      Effect.provide(program, ConfigServiceLive)
    );

    expect(result).toHaveProperty('server');
    expect(result).toHaveProperty('database');
    expect(result.server.port).toBe(3001);
    expect(result.server.host).toBe('0.0.0.0');
    expect(result.database.host).toBe('localhost');
    expect(result.database.port).toBe(9000);
    expect(result.database.protocol).toBe('http');
    expect(result.database.autoFlushRows).toBe(100);
    expect(result.database.autoFlushInterval).toBe(1000);
    expect(result.database.requestTimeout).toBe(10000);
    expect(result.database.retryTimeout).toBe(1000);
  });
});

describe('QuestDB Service Types', () => {
  it('should export QuestDB service tag', () => {
    expect(QuestDB).toBeDefined();
  });

  it('should export error types', () => {
    const connError = new DatabaseConnectionError('test');
    expect(connError._tag).toBe('DatabaseConnectionError');
    expect(connError.message).toBe('test');

    const writeError = new DatabaseWriteError('test');
    expect(writeError._tag).toBe('DatabaseWriteError');
    expect(writeError.message).toBe('test');
  });

  it('should create QuestDBLive layer', () => {
    expect(QuestDBLive).toBeDefined();
  });
});

describe('QuestDB Integration', () => {
  // These tests require QuestDB to be running
  // Skip in CI - QuestDB integration tests should run locally or in dedicated integration test suite
  const isQuestDBAvailable = process.env.QUESTDB_AVAILABLE === 'true';

  it.skip('should connect to QuestDB and pass health check', async () => {
    if (!isQuestDBAvailable) return;

    const MainLive = Layer.merge(
      ConfigServiceLive,
      Layer.provide(QuestDBLive, ConfigServiceLive)
    );

    const program = Effect.gen(function* () {
      const db = yield* QuestDB;
      const health = yield* db.health();
      return health;
    });

    const result = await Effect.runPromise(Effect.provide(program, MainLive));

    expect(result.connected).toBe(true);
    expect(result.uptime).toBeTypeOf('number');
  });

  it.skip('should write metric to QuestDB', async () => {
    if (!isQuestDBAvailable) return;

    const MainLive = Layer.merge(
      ConfigServiceLive,
      Layer.provide(QuestDBLive, ConfigServiceLive)
    );

    const program = Effect.gen(function* () {
      const db = yield* QuestDB;
      yield* db.writeMetric({
        timestamp: new Date(),
        source: 'ping',
        host: '8.8.8.8',
        latency: 25.5,
        packetLoss: 0,
        connectivityStatus: 'up',
      });
      return true;
    });

    const result = await Effect.runPromise(Effect.provide(program, MainLive));
    expect(result).toBe(true);
  });

  it.skip('should fail health check when database is unreachable', async () => {
    if (!isQuestDBAvailable) return;

    // Create a config that points to wrong host
    const BadConfigLive = Layer.succeed(ConfigService, {
      server: { port: 3001, host: '0.0.0.0' },
      database: {
        host: 'nonexistent-host',
        port: 9000,
        protocol: 'http',
        autoFlushRows: 100,
        autoFlushInterval: 1000,
        requestTimeout: 10000,
        retryTimeout: 1000,
      },
      ping: {
        timeout: 5,
        trainCount: 10,
        hosts: ['8.8.8.8', '1.1.1.1'],
      },
      auth: {
        username: 'admin',
        password: 'testpassword',
        jwtSecret: 'test-secret',
        jwtExpiresIn: '1h',
      },
    });

    const MainLive = Layer.provide(QuestDBLive, BadConfigLive);

    const program = Effect.gen(function* () {
      const db = yield* QuestDB;
      yield* db.health();
    });

    await expect(
      Effect.runPromise(Effect.provide(program, MainLive))
    ).rejects.toThrow();
  });
});
