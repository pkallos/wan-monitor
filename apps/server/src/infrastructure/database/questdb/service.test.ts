import { describe, expect, it } from "@effect/vitest";
import { Sender } from "@questdb/nodejs-client";
import { Effect, Layer, Option } from "effect";
import { Pool } from "pg";
import { vi } from "vitest";
import {
  QuestDBConnection,
  type QuestDBRawConnection,
} from "@/infrastructure/database/questdb/connection";
import {
  DatabaseQueryError,
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

/**
 * Runs `use` against the QuestDB service wired to a connection whose Postgres
 * client answers every query with `respond`, and reports each message the
 * service passed to `markDisconnected`.
 */
const withStubbedPgClient = <A, E>(
  respond: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>,
  use: (
    db: QuestDBService,
    disconnects: readonly string[]
  ) => Effect.Effect<A, E>
) =>
  Effect.acquireUseRelease(
    Effect.promise(
      async (): Promise<QuestDBRawConnection> => ({
        sender: await Sender.fromConfig(
          "http::addr=localhost:9;protocol_version=2;"
        ),
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
        return yield* use(db, disconnects);
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
