import type { Sender } from "@questdb/nodejs-client";
import type { NetworkMetric } from "@shared/metrics";
import { Effect, Layer, Option, Result } from "effect";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  QuestDBConnection,
  type QuestDBConnectionService,
  type QuestDBRawConnection,
} from "@/infrastructure/database/questdb/connection";
import {
  DatabaseConnectionError,
  DatabaseQueryError,
  DatabaseWriteError,
  DbUnavailable,
} from "@/infrastructure/database/questdb/errors";
import {
  QuestDB,
  QuestDBServiceLayer,
} from "@/infrastructure/database/questdb/service";
import { makeTestConfigLayer } from "@/test/config";

const asPool = (mock: Partial<Pool>): Pool => mock as Pool;

const createMockSender = (): Sender => {
  const sender: Partial<Sender> = {};
  Object.assign(sender, {
    table: vi.fn(() => sender),
    symbol: vi.fn(() => sender),
    floatColumn: vi.fn(() => sender),
    intColumn: vi.fn(() => sender),
    stringColumn: vi.fn(() => sender),
    at: vi.fn(() => sender),
    flush: vi.fn().mockResolvedValue(undefined),
  });
  return sender as Sender;
};

const makeRawConnection = (
  query: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ rows: [] })
): QuestDBRawConnection => ({
  sender: createMockSender(),
  pgClient: asPool({ query }),
});

const makeConnectionLayer = (
  overrides: Partial<QuestDBConnectionService> = {},
  rawConnection: QuestDBRawConnection = makeRawConnection()
) =>
  Layer.succeed(QuestDBConnection, {
    getConnection: Effect.succeed(rawConnection),
    getState: Effect.succeed({
      connection: Option.some(rawConnection),
      isConnecting: false,
      lastError: Option.none(),
      connectedSince: Option.some(new Date()),
    }),
    markDisconnected: () => Effect.void,
    close: Effect.void,
    ...overrides,
  });

const TestConfigLayer = makeTestConfigLayer();

const run = <A, E>(
  program: Effect.Effect<A, E, QuestDB>,
  connectionLayer: Layer.Layer<QuestDBConnection>
) =>
  Effect.runPromise(
    Effect.provide(
      program,
      QuestDBServiceLayer.pipe(
        Layer.provide(Layer.mergeAll(connectionLayer, TestConfigLayer))
      )
    )
  );

const runResult = <A, E>(
  program: Effect.Effect<A, E, QuestDB>,
  connectionLayer: Layer.Layer<QuestDBConnection>
) => run(Effect.result(program), connectionLayer);

const pingMetric: NetworkMetric = {
  timestamp: new Date("2024-01-01T00:00:00.000Z"),
  source: "ping",
  host: "8.8.8.8",
  latency: 15.5,
};

describe("QuestDB service", () => {
  describe("writeMetric", () => {
    it("writes a metric to the sender", async () => {
      const rawConnection = makeRawConnection();
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.writeMetric(pingMetric);
        }),
        makeConnectionLayer({}, rawConnection)
      );

      expect(result).toBeUndefined();
      expect(rawConnection.sender.table).toHaveBeenCalledWith(
        "network_metrics"
      );
    });

    it("fails with DbUnavailable when there is no connection", async () => {
      const connectionLayer = makeConnectionLayer({
        getConnection: Effect.fail(new DbUnavailable({ message: "offline" })),
      });

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.writeMetric(pingMetric);
        }),
        connectionLayer
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
      }
    });

    it("fails with DatabaseWriteError when the sender throws a non-connection error", async () => {
      const rawConnection = makeRawConnection();
      (
        rawConnection.sender.table as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        throw new Error("malformed row");
      });

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.writeMetric(pingMetric);
        }),
        makeConnectionLayer({}, rawConnection)
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseWriteError);
      }
    });

    it("fails with DbUnavailable and marks disconnected on a connection-shaped write error", async () => {
      const rawConnection = makeRawConnection();
      (
        rawConnection.sender.table as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        throw new Error("ECONNRESET");
      });
      const markDisconnected = vi.fn(() => Effect.void);

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.writeMetric(pingMetric);
        }),
        makeConnectionLayer({ markDisconnected }, rawConnection)
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
      }
      expect(markDisconnected).toHaveBeenCalledWith("ECONNRESET");
    });
  });

  describe("queryMetrics", () => {
    it("maps returned rows", async () => {
      const rows = [
        {
          timestamp: "2024-01-01T00:00:00.000000Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 15.5,
          jitter: null,
          packet_loss: null,
          connectivity_status: "up",
          download_bandwidth: null,
          upload_bandwidth: null,
          server_location: null,
          isp: null,
          external_ip: null,
          internal_ip: null,
        },
      ];
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryMetrics({});
        }),
        makeConnectionLayer(
          {},
          makeRawConnection(vi.fn().mockResolvedValue({ rows }))
        )
      );

      expect(result).toEqual([
        expect.objectContaining({ host: "8.8.8.8", latency: 15.5 }),
      ]);
    });

    it("returns an empty array when there are no rows", async () => {
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryMetrics({});
        }),
        makeConnectionLayer()
      );

      expect(result).toEqual([]);
    });

    it("fails with DatabaseQueryError for an invalid granularity", async () => {
      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryMetrics({ granularity: "not-a-real-one" });
        }),
        makeConnectionLayer()
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseQueryError);
      }
    });

    it("fails with DbUnavailable and marks disconnected on a connection-shaped query error", async () => {
      const markDisconnected = vi.fn(() => Effect.void);
      const query = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryMetrics({});
        }),
        makeConnectionLayer({ markDisconnected }, makeRawConnection(query))
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
      }
      expect(markDisconnected).toHaveBeenCalled();
    });

    it("fails with DatabaseQueryError for a non-connection query failure", async () => {
      const query = vi.fn().mockRejectedValue(new Error("syntax error"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryMetrics({});
        }),
        makeConnectionLayer({}, makeRawConnection(query))
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseQueryError);
      }
    });
  });

  describe("querySpeedtests", () => {
    it("maps returned rows", async () => {
      const rows = [
        {
          timestamp: "2024-01-01T00:00:00.000000Z",
          source: "speedtest",
          download_bandwidth: 100_000_000,
          upload_bandwidth: 50_000_000,
        },
      ];
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.querySpeedtests({});
        }),
        makeConnectionLayer(
          {},
          makeRawConnection(vi.fn().mockResolvedValue({ rows }))
        )
      );

      expect(result).toEqual([
        expect.objectContaining({ download_speed: 100, upload_speed: 50 }),
      ]);
    });

    it("returns an empty array when there are no rows", async () => {
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.querySpeedtests({});
        }),
        makeConnectionLayer()
      );

      expect(result).toEqual([]);
    });

    it("fails with DatabaseQueryError for a non-connection query failure", async () => {
      const query = vi.fn().mockRejectedValue(new Error("syntax error"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.querySpeedtests({});
        }),
        makeConnectionLayer({}, makeRawConnection(query))
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseQueryError);
      }
    });

    it("fails with DbUnavailable and marks disconnected on a connection-shaped query error", async () => {
      const markDisconnected = vi.fn(() => Effect.void);
      const query = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.querySpeedtests({});
        }),
        makeConnectionLayer({ markDisconnected }, makeRawConnection(query))
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
      }
      expect(markDisconnected).toHaveBeenCalled();
    });
  });

  describe("queryConnectivityStatus", () => {
    it("maps returned rows", async () => {
      const rows = [
        {
          timestamp: "2024-01-01T00:00:00.000000Z",
          up_count: 10,
          down_count: 1,
          degraded_count: 2,
          total_count: 13,
        },
      ];
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryConnectivityStatus({});
        }),
        makeConnectionLayer(
          {},
          makeRawConnection(vi.fn().mockResolvedValue({ rows }))
        )
      );

      expect(result).toEqual([
        {
          timestamp: rows[0].timestamp,
          up_count: 10,
          down_count: 1,
          degraded_count: 2,
          total_count: 13,
        },
      ]);
    });

    it("returns an empty array when there are no rows", async () => {
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryConnectivityStatus({});
        }),
        makeConnectionLayer()
      );

      expect(result).toEqual([]);
    });

    it("fails with DatabaseQueryError for an invalid granularity", async () => {
      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryConnectivityStatus({
            granularity: "not-a-real-one",
          });
        }),
        makeConnectionLayer()
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseQueryError);
      }
    });

    it("fails with DatabaseQueryError for a non-connection query failure", async () => {
      const query = vi.fn().mockRejectedValue(new Error("syntax error"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryConnectivityStatus({});
        }),
        makeConnectionLayer({}, makeRawConnection(query))
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseQueryError);
      }
    });

    it("fails with DbUnavailable and marks disconnected on a connection-shaped query error", async () => {
      const markDisconnected = vi.fn(() => Effect.void);
      const query = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.queryConnectivityStatus({});
        }),
        makeConnectionLayer({ markDisconnected }, makeRawConnection(query))
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
      }
      expect(markDisconnected).toHaveBeenCalled();
    });
  });

  describe("health", () => {
    it("fails with DbUnavailable when there is no connection", async () => {
      const connectionLayer = makeConnectionLayer({
        getState: Effect.succeed({
          connection: Option.none(),
          isConnecting: false,
          lastError: Option.some({
            message: "not yet connected",
            timestamp: new Date(),
          }),
          connectedSince: Option.none(),
        }),
      });

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.health();
        }),
        connectionLayer
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
        expect(result.failure.message).toBe("not yet connected");
      }
    });

    it("fails with DbUnavailable using a default message when there is no connection and no prior error", async () => {
      const connectionLayer = makeConnectionLayer({
        getState: Effect.succeed({
          connection: Option.none(),
          isConnecting: false,
          lastError: Option.none(),
          connectedSince: Option.none(),
        }),
      });

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.health();
        }),
        connectionLayer
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
        expect(result.failure.message).toBe("Database not connected");
      }
    });

    it("reports connected and uptime when the health query succeeds", async () => {
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.health();
        }),
        makeConnectionLayer()
      );

      expect(result.connected).toBe(true);
      expect(typeof result.uptime).toBe("number");
    });

    it("reports uptime 0 when connectedSince is unset", async () => {
      const rawConnection = makeRawConnection();
      const connectionLayer = makeConnectionLayer(
        {
          getState: Effect.succeed({
            connection: Option.some(rawConnection),
            isConnecting: false,
            lastError: Option.none(),
            connectedSince: Option.none(),
          }),
        },
        rawConnection
      );

      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.health();
        }),
        connectionLayer
      );

      expect(result).toEqual({ connected: true, uptime: 0 });
    });

    it("fails with DatabaseConnectionError when the health query fails", async () => {
      const query = vi.fn().mockRejectedValue(new Error("query failed"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          return yield* db.health();
        }),
        makeConnectionLayer({}, makeRawConnection(query))
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseConnectionError);
      }
    });
  });

  describe("flush", () => {
    it("flushes the sender", async () => {
      const rawConnection = makeRawConnection();
      const result = await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.flush();
        }),
        makeConnectionLayer({}, rawConnection)
      );

      expect(result).toBeUndefined();
      expect(rawConnection.sender.flush).toHaveBeenCalled();
    });

    it("fails with DbUnavailable and marks disconnected on a connection-shaped flush error", async () => {
      const rawConnection = makeRawConnection();
      (
        rawConnection.sender.flush as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("ECONNRESET"));
      const markDisconnected = vi.fn(() => Effect.void);

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.flush();
        }),
        makeConnectionLayer({ markDisconnected }, rawConnection)
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DbUnavailable);
      }
      expect(markDisconnected).toHaveBeenCalledWith("ECONNRESET");
    });

    it("fails with DatabaseWriteError for a non-connection flush error", async () => {
      const rawConnection = makeRawConnection();
      (
        rawConnection.sender.flush as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("disk full"));

      const result = await runResult(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.flush();
        }),
        makeConnectionLayer({}, rawConnection)
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DatabaseWriteError);
      }
    });
  });

  describe("close", () => {
    it("delegates to the connection's close", async () => {
      const closeSpy = vi.fn();

      await run(
        Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db.close();
        }),
        Layer.succeed(QuestDBConnection, {
          getConnection: Effect.succeed(makeRawConnection()),
          getState: Effect.succeed({
            connection: Option.none(),
            isConnecting: false,
            lastError: Option.none(),
            connectedSince: Option.none(),
          }),
          markDisconnected: () => Effect.void,
          close: Effect.sync(closeSpy),
        })
      );

      expect(closeSpy).toHaveBeenCalled();
    });
  });
});
