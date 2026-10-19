import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from "node:http";
import { createServer, type Server } from "node:net";
import { describe, expect, it } from "@effect/vitest";
import { Sender } from "@questdb/nodejs-client";
import type { NetworkMetric } from "@shared/metrics";
import { Duration, Effect, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { DatabaseError, Pool } from "pg";
import { vi } from "vitest";
import {
  QuestDBConnection,
  type QuestDBConnectionService,
  type QuestDBRawConnection,
} from "@/infrastructure/database/questdb/connection";
import {
  DatabaseConnectionError,
  DatabaseQueryError,
  DatabaseUnavailable,
  DatabaseWriteError,
} from "@/infrastructure/database/questdb/errors";
import {
  QuestDB,
  QuestDBOverConnection,
  type QuestDBService,
} from "@/infrastructure/database/questdb/service";
import { makeTestConfigLayer } from "@/test/config";

const window = {
  startTime: new Date("2024-01-01T00:00:00Z"),
  endTime: new Date("2024-01-02T00:00:00Z"),
};

const stateWindow = {
  ...window,
  nowMs: Date.parse("2024-01-03T00:00:00Z"),
  intervalMs: 30_000,
  hosts: ["8.8.8.8"],
};
const liveParams = {
  nowMs: stateWindow.nowMs,
  intervalMs: stateWindow.intervalMs,
  hosts: stateWindow.hosts,
};
const windowUptime = {
  ...stateWindow,
  windowStartTimes: [new Date("2023-12-31T00:00:00Z")],
};

const systemError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

const queries: readonly [
  name: string,
  failureLabel: string,
  run: (db: QuestDBService) => Effect.Effect<unknown, unknown>,
][] = [
  ["queryMetrics", "metrics", (db) => db.queryMetrics(window)],
  ["querySpeedtests", "speedtests", (db) => db.querySpeedtests(window)],
  [
    "queryConnectivityStatus",
    "connectivity status",
    (db) => db.queryConnectivityStatus({ ...stateWindow, granularity: "5m" }),
  ],
  [
    "queryLiveConnectivity",
    "live connectivity",
    (db) => db.queryLiveConnectivity(liveParams),
  ],
  [
    "queryEarliestTimestamp",
    "earliest timestamp",
    (db) => db.queryEarliestTimestamp(),
  ],
  [
    "queryLatestPingTimestamp",
    "latest ping timestamp",
    (db) => db.queryLatestPingTimestamp(),
  ],
  ["querySummaryStats", "summary stats", (db) => db.querySummaryStats(window)],
  ["queryHostStats", "host stats", (db) => db.queryHostStats(window)],
  ["queryOutageRuns", "outage runs", (db) => db.queryOutageRuns(stateWindow)],
  [
    "queryWindowUptime",
    "window uptime",
    (db) => db.queryWindowUptime(windowUptime),
  ],
];

const stubbedSenderConfig = "http::addr=localhost:9;protocol_version=2;";

/**
 * Runs `use` against the QuestDB service wired to a connection whose Postgres
 * client answers every query with `respond`, and reports each message the
 * service passed to `markDisconnected`. The sender is built from
 * `senderConfig`, which points at a closed port.
 */
const withStubbedPgClient = <A, E>(
  respond: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>,
  use: (
    db: QuestDBService,
    disconnects: readonly string[],
    conn: QuestDBRawConnection
  ) => Effect.Effect<A, E>,
  senderConfig = stubbedSenderConfig,
  protocol: "http" | "tcp" = "http"
) =>
  Effect.acquireUseRelease(
    Effect.promise(async (): Promise<QuestDBRawConnection> => {
      const sender = await Sender.fromConfig(senderConfig);
      if (senderConfig.startsWith("tcp")) {
        await sender.connect();
      }
      return {
        sender,
        pgClient: Object.assign(new Pool(), { query: vi.fn(respond) }),
      };
    }),
    (conn) => {
      const disconnects: string[] = [];
      const connection = Layer.succeed(QuestDBConnection, {
        getConnection: Effect.succeed(conn),
        getState: Effect.succeed({
          connection: Option.some(conn),
          isConnecting: false,
          lastError: Option.none(),
          connectedSince: Option.none(),
        }),
        markDisconnected: (error) =>
          Effect.sync(() => {
            disconnects.push(error);
          }),
        ping: Effect.void,
        close: Effect.void,
      });
      return Effect.gen(function* () {
        const db = yield* QuestDB;
        return yield* use(db, disconnects, conn);
      }).pipe(
        Effect.provide(
          QuestDBOverConnection.pipe(
            Layer.provide(
              Layer.merge(
                connection,
                makeTestConfigLayer({ database: { protocol } })
              )
            )
          )
        )
      );
    },
    (conn) =>
      Effect.promise(async () => {
        await conn.sender.close();
        await conn.pgClient.end();
      })
  );

describe.each(queries)("%s", (_name, failureLabel, run) => {
  it.effect(
    "fails with DatabaseUnavailable and marks the connection down",
    () =>
      withStubbedPgClient(
        () =>
          Promise.reject(
            systemError("connect ECONNREFUSED 127.0.0.1:8812", "ECONNREFUSED")
          ),
        (db, disconnects) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(run(db));

            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({
              message: "connect ECONNREFUSED 127.0.0.1:8812",
            });
            expect(new Set(disconnects)).toEqual(
              new Set(["connect ECONNREFUSED 127.0.0.1:8812"])
            );
          })
      )
  );

  it.effect(
    "fails with DatabaseUnavailable and a usable message when the error has no message",
    () =>
      withStubbedPgClient(
        () =>
          Promise.reject(
            Object.assign(new AggregateError([]), { code: "ECONNREFUSED" })
          ),
        (db, disconnects) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(run(db));

            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({ message: "ECONNREFUSED" });
            expect(new Set(disconnects)).toEqual(new Set(["ECONNREFUSED"]));
          })
      )
  );

  it.effect.each([
    ["pg query read timeout", new Error("Query read timeout")],
    [
      "server error naming connectivity_status",
      new DatabaseError("column connectivity_status is invalid", 0, "error"),
    ],
    [
      "client error that is not queryable",
      new Error(
        "Client has encountered a connection error and is not queryable"
      ),
    ],
  ] as const)(
    "treats a %s as a query error and leaves the connection up",
    ([, failure]) =>
      withStubbedPgClient(
        () => Promise.reject(failure),
        (db, disconnects) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(run(db));

            expect(error).toBeInstanceOf(DatabaseQueryError);
            expect(error).toMatchObject({
              message: `Failed to query ${failureLabel}: ${failure.message}`,
            });
            expect(disconnects).toEqual([]);
          })
      )
  );

  it.effect(
    "fails with DatabaseQueryError and leaves the connection up on a row that does not match its schema",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [{ unexpected: "column" }] }),
        (db, disconnects) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(run(db));

            expect(error).toBeInstanceOf(DatabaseQueryError);
            expect(error).toMatchObject({
              message: expect.stringContaining(
                `Failed to decode ${failureLabel} rows`
              ),
            });
            expect(disconnects).toEqual([]);
          })
      )
  );

  it.effect(
    "fails with DatabaseQueryError and leaves the connection up on a query error",
    () =>
      withStubbedPgClient(
        () => Promise.reject(new Error("invalid column: nope")),
        (db, disconnects) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(run(db));

            expect(error).toBeInstanceOf(DatabaseQueryError);
            expect(error).toMatchObject({
              message: `Failed to query ${failureLabel}: invalid column: nope`,
            });
            expect(disconnects).toEqual([]);
          })
      )
  );
});

describe("queryOutageRuns", () => {
  const hostRow = (overrides: Record<string, unknown>) => ({
    run_id: 1,
    start_time: "2024-01-01T00:00:00.000000Z",
    end_time: "2024-01-01T00:01:00.000000Z",
    had_down: 0,
    host: "8.8.8.8",
    affected: 1,
    max_packet_loss: 20,
    peak_latency: 40,
    ...overrides,
  });

  it.effect("folds each run's host rows into one run", () =>
    withStubbedPgClient(
      () =>
        Promise.resolve({
          rows: [
            hostRow({ run_id: 1, host: "1.1.1.1", affected: 0 }),
            hostRow({ run_id: 1, host: "8.8.8.8", peak_latency: 90 }),
            hostRow({
              run_id: 2,
              start_time: "2024-01-01T01:00:00.000000Z",
              end_time: "2024-01-01T01:00:30.000000Z",
              had_down: 1,
              host: "8.8.8.8",
              max_packet_loss: 100,
              peak_latency: null,
            }),
            hostRow({
              run_id: 2,
              start_time: "2024-01-01T01:00:00.000000Z",
              end_time: "2024-01-01T01:00:30.000000Z",
              had_down: 1,
              host: "1.1.1.1",
              max_packet_loss: 100,
              peak_latency: null,
            }),
          ],
        }),
      (db) =>
        Effect.gen(function* () {
          const runs = yield* db.queryOutageRuns(stateWindow);

          expect(runs.map((run) => run.affected_hosts)).toEqual([
            ["8.8.8.8"],
            ["8.8.8.8", "1.1.1.1"],
          ]);
          expect(runs.map((run) => run.had_down)).toEqual([false, true]);
          expect(runs.map((run) => run.peak_latency)).toEqual([90, null]);
          expect(runs[0]?.end_time).toBe("2024-01-01T00:01:00.000000Z");
        })
    )
  );

  it.effect("sends the bound hosts after the window to the database", () => {
    const seen: unknown[][] = [];
    return withStubbedPgClient(
      () => Promise.resolve({ rows: [] }),
      (db, _disconnects, conn) =>
        Effect.gen(function* () {
          yield* db.queryOutageRuns(stateWindow);
          const call = vi.mocked(conn.pgClient.query).mock.calls[0];
          seen.push(call?.[1] as unknown[]);

          expect(seen[0]?.at(-1)).toBe("8.8.8.8");
          expect(seen[0]?.slice(0, 6)).toEqual([
            window.startTime.getTime() * 1000,
            window.endTime.getTime() * 1000,
            (window.startTime.getTime() - 3_600_000) * 1000,
            (window.endTime.getTime() + 3_600_000) * 1000,
            stateWindow.nowMs * 1000,
            30_000_000,
          ]);
        })
    );
  });
});

describe("queryLiveConnectivity", () => {
  it.effect.each([
    [1, "up"],
    [2, "degraded"],
    [3, "down"],
  ] as const)("names state code %i %s", ([state, status]) =>
    withStubbedPgClient(
      () => Promise.resolve({ rows: [{ state: String(state) }] }),
      (db) =>
        Effect.gen(function* () {
          expect(yield* db.queryLiveConnectivity(liveParams)).toBe(status);
        })
    )
  );

  it.effect("reads state code 0 as no status", () =>
    withStubbedPgClient(
      () => Promise.resolve({ rows: [{ state: 0 }] }),
      (db) =>
        Effect.gen(function* () {
          expect(yield* db.queryLiveConnectivity(liveParams)).toBeNull();
        })
    )
  );
});

describe("queryWindowUptime", () => {
  it.effect(
    "returns up and observed time per window, a null sum as no time",
    () =>
      withStubbedPgClient(
        () =>
          Promise.resolve({
            rows: [
              {
                up_0: "86400000000",
                observed_0: "86400000000",
                up_1: null,
                observed_1: null,
              },
            ],
          }),
        (db) =>
          Effect.gen(function* () {
            const windows = yield* db.queryWindowUptime({
              ...windowUptime,
              windowStartTimes: [
                new Date("2023-12-31T00:00:00Z"),
                new Date("2023-12-25T00:00:00Z"),
              ],
            });

            expect(windows).toEqual([
              { up_micros: 86_400_000_000, observed_micros: 86_400_000_000 },
              { up_micros: 0, observed_micros: 0 },
            ]);
          })
      )
  );
});

describe("query results", () => {
  const speedtestRow = {
    timestamp: "2024-01-01T12:00:00.000Z",
    source: "speedtest",
    download_bandwidth: "250000000",
    upload_bandwidth: "50000000",
  };

  it.effect("reads string bandwidth columns from pg as numbers", () =>
    withStubbedPgClient(
      () => Promise.resolve({ rows: [speedtestRow] }),
      (db) =>
        Effect.gen(function* () {
          const [row] = yield* db.querySpeedtests(window);

          expect(row?.download_speed).toBe(250);
          expect(row?.upload_speed).toBe(50);
        })
    )
  );

  it.effect("reads string durations from pg as numbers", () =>
    withStubbedPgClient(
      () =>
        Promise.resolve({
          rows: [
            {
              bucket: "2024-01-01T12:00:00.000Z",
              up_micros: "12000000",
              degraded_micros: "0",
              down_micros: "0",
            },
          ],
        }),
      (db) =>
        Effect.gen(function* () {
          const rows = yield* db.queryConnectivityStatus({
            ...stateWindow,
            granularity: "5m",
          });

          expect(rows).toEqual([
            {
              bucket: "2024-01-01T12:00:00.000Z",
              up_micros: 12_000_000,
              degraded_micros: 0,
              down_micros: 0,
            },
          ]);
        })
    )
  );

  it.effect("fails the whole query when one of several rows is invalid", () =>
    withStubbedPgClient(
      () =>
        Promise.resolve({
          rows: [
            { timestamp: "2024-01-01T12:00:00.000Z", source: "ping" },
            {
              timestamp: "2024-01-01T12:01:00.000Z",
              source: "ping",
              connectivity_status: "sideways",
            },
          ],
        }),
      (db) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(db.queryMetrics(window));

          expect(error).toBeInstanceOf(DatabaseQueryError);
          expect(error).toMatchObject({
            message: expect.stringContaining("Failed to decode metrics rows"),
          });
        })
    )
  );
});

describe("queries over no rows", () => {
  const noSummary = {
    latency_p50: null,
    latency_p95: null,
    avg_packet_loss: null,
    avg_jitter: null,
  };

  it.effect.each([
    ["queryMetrics", (db: QuestDBService) => db.queryMetrics(window), []],
    ["querySpeedtests", (db: QuestDBService) => db.querySpeedtests(window), []],
    [
      "queryConnectivityStatus",
      (db: QuestDBService) =>
        db.queryConnectivityStatus({ ...stateWindow, granularity: "5m" }),
      [],
    ],
    ["queryHostStats", (db: QuestDBService) => db.queryHostStats(window), []],
    [
      "queryOutageRuns",
      (db: QuestDBService) => db.queryOutageRuns(stateWindow),
      [],
    ],
    [
      "queryLiveConnectivity",
      (db: QuestDBService) => db.queryLiveConnectivity(liveParams),
      null,
    ],
    [
      "queryEarliestTimestamp",
      (db: QuestDBService) => db.queryEarliestTimestamp(),
      null,
    ],
    [
      "queryLatestPingTimestamp",
      (db: QuestDBService) => db.queryLatestPingTimestamp(),
      null,
    ],
    [
      "querySummaryStats",
      (db: QuestDBService) => db.querySummaryStats(window),
      noSummary,
    ],
    [
      "queryWindowUptime",
      (db: QuestDBService) => db.queryWindowUptime(windowUptime),
      [{ up_micros: 0, observed_micros: 0 }],
    ],
  ] as const)(
    "%s returns its empty result without an error",
    ([, run, empty]) =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db) =>
          Effect.gen(function* () {
            expect(yield* run(db)).toEqual(empty);
          })
      )
  );
});

describe("health", () => {
  const healthLayer = (
    connection: Pick<
      QuestDBConnectionService,
      "getConnection" | "getState" | "ping"
    >
  ) =>
    QuestDBOverConnection.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(QuestDBConnection, {
            ...connection,
            markDisconnected: () => Effect.void,
            close: Effect.void,
          }),
          makeTestConfigLayer()
        )
      )
    );

  const notConnected = {
    connection: Option.none(),
    isConnecting: false,
    lastError: Option.none(),
    connectedSince: Option.none(),
  };

  const failsWith = (error: DatabaseUnavailable | DatabaseConnectionError) =>
    Effect.gen(function* () {
      const db = yield* QuestDB;

      expect(yield* Effect.flip(db.health())).toBe(error);
    }).pipe(
      Effect.provide(
        healthLayer({
          getConnection: Effect.fail(new DatabaseUnavailable({ message: "" })),
          getState: Effect.succeed(notConnected),
          ping: Effect.fail(error),
        })
      )
    );

  it.effect("fails with the connection's own unavailable error", () =>
    failsWith(new DatabaseUnavailable({ message: "connect ECONNREFUSED" }))
  );

  it.effect("fails with the connection's own health check error", () =>
    failsWith(new DatabaseConnectionError({ message: "Health check failed" }))
  );

  it.effect("reports connected, with the uptime, once the ping succeeds", () =>
    Effect.gen(function* () {
      const db = yield* QuestDB;

      const health = yield* db.health();

      expect(health.connected).toBe(true);
      expect(health.uptime).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(
        healthLayer({
          getConnection: Effect.fail(new DatabaseUnavailable({ message: "" })),
          getState: Effect.succeed({
            ...notConnected,
            connectedSince: Option.some(new Date(Date.now() - 5000)),
          }),
          ping: Effect.void,
        })
      )
    )
  );
});

describe("writeMetric", () => {
  const metric: NetworkMetric = {
    timestamp: new Date("2024-01-01T00:00:00Z"),
    source: "ping",
    host: "8.8.8.8",
    latency: 12,
  };
  const writeTimeoutMs = 11_000;
  const timeoutMessage = `QuestDB write timed out after ${writeTimeoutMs}ms`;

  const neverSettles = () => new Promise<void>(() => undefined);

  const runUntilTimeout = <E>(call: Effect.Effect<unknown, E>) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(call));
      yield* TestClock.adjust(Duration.millis(writeTimeoutMs - 1));
      const beforeTimeout = fiber.pollUnsafe();
      yield* TestClock.adjust(Duration.millis(1));
      const error = yield* Fiber.join(fiber);
      return { beforeTimeout, error };
    });

  it.effect(
    "fails with DatabaseUnavailable and marks the connection down",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "at").mockRejectedValue(
              systemError("read ECONNRESET", "ECONNRESET")
            );

            const error = yield* Effect.flip(db.writeMetric(metric));

            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({ message: "read ECONNRESET" });
            expect(disconnects).toEqual(["read ECONNRESET"]);
          })
      )
  );

  it.effect(
    "fails with DatabaseWriteError and leaves the connection up on a write error",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "at").mockRejectedValue(
              new Error("invalid column: nope")
            );

            const error = yield* Effect.flip(db.writeMetric(metric));

            expect(error).toBeInstanceOf(DatabaseWriteError);
            expect(error).toMatchObject({
              message: "Failed to write metric: invalid column: nope",
            });
            expect(disconnects).toEqual([]);
          })
      )
  );

  it.effect(
    "fails with DatabaseWriteError and leaves the connection up when the sender reports a timeout",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "at").mockRejectedValue(
              new Error("HTTP request timeout, no response from server in time")
            );

            const error = yield* Effect.flip(db.writeMetric(metric));

            expect(error).toBeInstanceOf(DatabaseWriteError);
            expect(error).toMatchObject({
              message:
                "Failed to write metric: HTTP request timeout, no response from server in time",
            });
            expect(disconnects).toEqual([]);
          })
      )
  );

  it.effect(
    "fails with DatabaseUnavailable and marks the connection down on any rejected write over TCP",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "at").mockRejectedValue(
              new Error("TCP transport is not connected")
            );

            const error = yield* Effect.flip(db.writeMetric(metric));

            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({
              message: "TCP transport is not connected",
            });
            expect(disconnects).toEqual(["TCP transport is not connected"]);
          }),
        stubbedSenderConfig,
        "tcp"
      )
  );

  it.effect(
    "fails with DatabaseUnavailable when QuestDB has closed the ILP socket under a real TCP sender",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(
          () =>
            new Promise<Server>((resolve) => {
              const server = createServer((socket) => {
                socket.on("data", () => undefined);
                setTimeout(() => socket.end(), 50);
              });
              server.listen(0, "127.0.0.1", () => resolve(server));
            })
        ),
        (server) => {
          const address = server.address();
          const port =
            typeof address === "object" && address ? address.port : 0;
          return withStubbedPgClient(
            () => Promise.resolve({ rows: [] }),
            (db, disconnects) =>
              Effect.gen(function* () {
                yield* Effect.promise(
                  () => new Promise((resolve) => setTimeout(resolve, 300))
                );

                const error = yield* Effect.flip(db.writeMetric(metric));

                expect(error).toBeInstanceOf(DatabaseUnavailable);
                expect(disconnects).toHaveLength(1);
              }),
            `tcp::addr=127.0.0.1:${port};auto_flush_rows=1;auto_flush_interval=0;`,
            "tcp"
          );
        },
        (server) =>
          Effect.promise(
            () => new Promise<void>((resolve) => server.close(() => resolve()))
          )
      )
  );

  it.effect(
    "reports each row's own outcome when the sender would otherwise batch rows across calls",
    () => {
      const accepted: string[] = [];
      const hostsIn = (body: string) =>
        [...body.matchAll(/host=([^, ]+)/g)].map((match) => match[1] ?? "");

      return Effect.acquireUseRelease(
        Effect.promise(
          () =>
            new Promise<HttpServer>((resolve) => {
              const server = createHttpServer((request, response) => {
                const chunks: Buffer[] = [];
                request.on("data", (chunk: Buffer) => chunks.push(chunk));
                request.on("end", () => {
                  const hosts = hostsIn(Buffer.concat(chunks).toString());
                  if (hosts.includes("c")) {
                    response.writeHead(400).end("rejected");
                    return;
                  }
                  accepted.push(...hosts);
                  response.writeHead(204).end();
                });
              });
              server.listen(0, "127.0.0.1", () => resolve(server));
            })
        ),
        (server) => {
          const address = server.address();
          const port =
            typeof address === "object" && address ? address.port : 0;
          const pause = Effect.promise(
            () => new Promise((resolve) => setTimeout(resolve, 100))
          );
          return withStubbedPgClient(
            () => Promise.resolve({ rows: [] }),
            (db) =>
              Effect.gen(function* () {
                const writeAll = (hosts: readonly string[]) =>
                  Effect.all(
                    hosts.map((host) =>
                      db.writeMetric({ ...metric, host }).pipe(
                        Effect.as(`${host}:ok`),
                        Effect.catch(() => Effect.succeed(`${host}:failed`))
                      )
                    ),
                    { concurrency: "unbounded" }
                  );

                yield* pause;
                const first = yield* writeAll(["a", "b"]);
                yield* pause;
                const second = yield* writeAll(["c", "d"]);

                expect([...first, ...second]).toEqual([
                  "a:ok",
                  "b:ok",
                  "c:failed",
                  "d:ok",
                ]);
                expect([...accepted].sort()).toEqual(["a", "b", "d"]);
              }),
            `http::addr=127.0.0.1:${port};protocol_version=2;auto_flush_rows=100;auto_flush_interval=50;request_timeout=2000;retry_timeout=2000;`
          );
        },
        (server) =>
          Effect.promise(
            () => new Promise<void>((resolve) => server.close(() => resolve()))
          )
      );
    }
  );

  it.effect(
    "fails with DatabaseUnavailable once requestTimeout + retryTimeout elapse on a write that never settles",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "at").mockImplementation(neverSettles);

            const { beforeTimeout, error } = yield* runUntilTimeout(
              db.writeMetric(metric)
            );

            expect(beforeTimeout).toBeUndefined();
            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({ message: timeoutMessage });
            expect(disconnects).toEqual([timeoutMessage]);
          })
      )
  );

  it.effect(
    "fails with DatabaseUnavailable when the real sender cannot reach QuestDB and the flush never settles",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects) =>
          Effect.gen(function* () {
            const { error } = yield* runUntilTimeout(db.writeMetric(metric));

            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({ message: timeoutMessage });
            expect(disconnects).toEqual([timeoutMessage]);
          }),
        "http::addr=127.0.0.1:9;protocol_version=1;auto_flush_rows=1;request_timeout=10000;retry_timeout=1000;"
      )
  );

  it.effect(
    "leaves no unhandled rejection when a timed-out write rejects later",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, _disconnects, conn) => {
          const unhandled: unknown[] = [];
          const onUnhandled = (reason: unknown) => {
            unhandled.push(reason);
          };
          let rejectWrite: (reason: Error) => void = () => undefined;
          // A vi.fn spy would attach its own rejection handler to the promise
          // and hide an unhandled rejection, so replace the method directly.
          conn.sender.at = () =>
            new Promise<void>((_resolve, reject) => {
              rejectWrite = reject;
            });

          return Effect.gen(function* () {
            process.on("unhandledRejection", onUnhandled);
            yield* runUntilTimeout(db.writeMetric(metric));

            rejectWrite(new Error("connect ECONNREFUSED 127.0.0.1:9000"));
            yield* Effect.promise(
              () => new Promise((resolve) => setImmediate(resolve))
            );

            expect(unhandled).toEqual([]);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => process.off("unhandledRejection", onUnhandled))
            )
          );
        }
      )
  );
});

describe("flush", () => {
  it.effect(
    "fails with DatabaseUnavailable and marks the connection down",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "flush").mockRejectedValue(
              systemError("read ECONNRESET", "ECONNRESET")
            );

            const error = yield* Effect.flip(db.flush());

            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({ message: "read ECONNRESET" });
            expect(disconnects).toEqual(["read ECONNRESET"]);
          })
      )
  );

  it.effect(
    "fails with DatabaseUnavailable and marks the connection down on any rejected flush over TCP",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "flush").mockRejectedValue(
              new Error("TCP transport is not connected")
            );

            const error = yield* Effect.flip(db.flush());

            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(disconnects).toEqual(["TCP transport is not connected"]);
          }),
        stubbedSenderConfig,
        "tcp"
      )
  );

  it.effect(
    "fails with DatabaseWriteError and leaves the connection up on a flush error",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "flush").mockRejectedValue(
              new Error("invalid column: nope")
            );

            const error = yield* Effect.flip(db.flush());

            expect(error).toBeInstanceOf(DatabaseWriteError);
            expect(error).toMatchObject({
              message: "Failed to flush metrics: invalid column: nope",
            });
            expect(disconnects).toEqual([]);
          })
      )
  );

  it.effect(
    "fails with DatabaseUnavailable once requestTimeout + retryTimeout elapse on a flush that never settles",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects, conn) =>
          Effect.gen(function* () {
            vi.spyOn(conn.sender, "flush").mockImplementation(
              () => new Promise<boolean>(() => undefined)
            );

            const fiber = yield* Effect.forkChild(Effect.flip(db.flush()));
            yield* TestClock.adjust(Duration.millis(11_000));
            const error = yield* Fiber.join(fiber);

            const message = "QuestDB flush timed out after 11000ms";
            expect(error).toBeInstanceOf(DatabaseUnavailable);
            expect(error).toMatchObject({ message });
            expect(disconnects).toEqual([message]);
          })
      )
  );
});
