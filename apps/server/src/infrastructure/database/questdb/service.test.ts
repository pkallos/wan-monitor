import { describe, expect, it } from "@effect/vitest";
import { Sender } from "@questdb/nodejs-client";
import type { NetworkMetric } from "@shared/metrics";
import { Duration, Effect, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { Pool } from "pg";
import { vi } from "vitest";
import {
  QuestDBConnection,
  type QuestDBRawConnection,
} from "@/infrastructure/database/questdb/connection";
import {
  DatabaseQueryError,
  DatabaseWriteError,
  DbUnavailable,
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

const queries: readonly [
  name: string,
  failureLabel: string,
  run: (db: QuestDBService) => Effect.Effect<unknown, unknown>,
][] = [
  ["querySummaryStats", "summary stats", (db) => db.querySummaryStats(window)],
  ["queryHostStats", "host stats", (db) => db.queryHostStats(window)],
  [
    "queryOutageRuns",
    "outage runs",
    (db) => db.queryOutageRuns({ ...window, mergeGapMs: 75_000 }),
  ],
  ["queryCyclePeriod", "cycle period", (db) => db.queryCyclePeriod(window)],
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
  senderConfig = stubbedSenderConfig
) =>
  Effect.acquireUseRelease(
    Effect.promise(
      async (): Promise<QuestDBRawConnection> => ({
        sender: await Sender.fromConfig(senderConfig),
        pgClient: Object.assign(new Pool(), { query: vi.fn(respond) }),
      })
    ),
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
        close: Effect.void,
      });
      return Effect.gen(function* () {
        const db = yield* QuestDB;
        return yield* use(db, disconnects, conn);
      }).pipe(
        Effect.provide(
          QuestDBOverConnection.pipe(
            Layer.provide(Layer.merge(connection, makeTestConfigLayer()))
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
  it.effect("fails with DbUnavailable and marks the connection down", () =>
    withStubbedPgClient(
      () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8812")),
      (db, disconnects) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(run(db));

          expect(error).toBeInstanceOf(DbUnavailable);
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
  const mergeGapMs = 75_000;

  it.effect("fails when only the affected hosts query fails", () =>
    withStubbedPgClient(
      (sql) =>
        sql.includes("DISTINCT")
          ? Promise.reject(new Error("invalid column: nope"))
          : Promise.resolve({ rows: [] }),
      (db) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            db.queryOutageRuns({ ...window, mergeGapMs })
          );

          expect(error).toBeInstanceOf(DatabaseQueryError);
          expect(error).toMatchObject({
            message: "Failed to query outage hosts: invalid column: nope",
          });
        })
    )
  );

  it.effect("attaches each run's hosts from the two queries", () =>
    withStubbedPgClient(
      (sql) =>
        Promise.resolve({
          rows: sql.includes("DISTINCT")
            ? [
                { run_id: 2, host: "8.8.8.8" },
                { run_id: 2, host: "1.1.1.1" },
              ]
            : [
                {
                  run_id: 1,
                  start_time: "2024-01-01T00:00:00.000Z",
                  last_time: "2024-01-01T00:01:00.000Z",
                  had_down: 0,
                  max_packet_loss: 20,
                  peak_latency: 40,
                },
                {
                  run_id: 2,
                  start_time: "2024-01-01T01:00:00.000Z",
                  last_time: "2024-01-01T01:00:30.000Z",
                  had_down: 1,
                  max_packet_loss: 100,
                  peak_latency: null,
                },
              ],
        }),
      (db) =>
        Effect.gen(function* () {
          const runs = yield* db.queryOutageRuns({ ...window, mergeGapMs });

          expect(runs.map((run) => run.affected_hosts)).toEqual([
            [],
            ["8.8.8.8", "1.1.1.1"],
          ]);
          expect(runs.map((run) => run.had_down)).toEqual([false, true]);
        })
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

  it.effect("fails with DbUnavailable and marks the connection down", () =>
    withStubbedPgClient(
      () => Promise.resolve({ rows: [] }),
      (db, disconnects, conn) =>
        Effect.gen(function* () {
          vi.spyOn(conn.sender, "at").mockRejectedValue(
            new Error("read ECONNRESET")
          );

          const error = yield* Effect.flip(db.writeMetric(metric));

          expect(error).toBeInstanceOf(DbUnavailable);
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
    "fails with DbUnavailable once requestTimeout + retryTimeout elapse on a write that never settles",
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
            expect(error).toBeInstanceOf(DbUnavailable);
            expect(error).toMatchObject({ message: timeoutMessage });
            expect(disconnects).toEqual([timeoutMessage]);
          })
      )
  );

  it.effect(
    "fails with DbUnavailable when the real sender cannot reach QuestDB and the flush never settles",
    () =>
      withStubbedPgClient(
        () => Promise.resolve({ rows: [] }),
        (db, disconnects) =>
          Effect.gen(function* () {
            const { error } = yield* runUntilTimeout(db.writeMetric(metric));

            expect(error).toBeInstanceOf(DbUnavailable);
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
    "fails with DbUnavailable once requestTimeout + retryTimeout elapse on a flush that never settles",
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
            expect(error).toBeInstanceOf(DbUnavailable);
            expect(error).toMatchObject({ message });
            expect(disconnects).toEqual([message]);
          })
      )
  );
});
