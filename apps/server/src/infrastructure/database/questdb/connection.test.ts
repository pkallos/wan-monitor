import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Sender } from "@questdb/nodejs-client";
import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Result,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import { Pool } from "pg";
import { vi } from "vitest";
import {
  healthPoolConfig,
  QuestDBConnection,
  QuestDBConnectionOverMigrator,
  type QuestDBConnectionService,
  queryPoolConfig,
} from "@/infrastructure/database/questdb/connection";
import {
  DatabaseConnectionError,
  DatabaseUnavailable,
} from "@/infrastructure/database/questdb/errors";
import { MigrationError } from "@/infrastructure/database/questdb/migrations/migration";
import {
  SchemaMigrator,
  type SchemaMigratorService,
} from "@/infrastructure/database/questdb/migrations/service";
import { makeTestAppConfig, makeTestConfigLayer } from "@/test/config";

vi.mock("@questdb/nodejs-client");
vi.mock("pg");

const asSender = (mock: Partial<Sender>): Sender => mock as Sender;
const asPool = (mock: Partial<Pool>): Pool => mock as Pool;
const mockPool = (mock: Partial<Pool>) => {
  vi.mocked(Pool).mockImplementation(function (this: unknown) {
    return asPool(mock);
  });
};

/** Hands out `queryPool` for the query pool and `healthPool` for the health pool, told apart by `max`. */
const mockPools = (queryPool: Partial<Pool>, healthPool: Partial<Pool>) => {
  vi.mocked(Pool).mockImplementation(function (
    this: unknown,
    config?: { max?: number }
  ) {
    return asPool(config?.max === 1 ? healthPool : queryPool);
  });
};

const TestConfigLayer = makeTestConfigLayer({
  database: { requestTimeout: 5000, retryTimeout: 10000 },
});

const failing = (kind: "transient" | "terminal", step = "copy") =>
  new MigrationError({ step, kind, message: "disk full" });

const healthyConnection = () => {
  vi.mocked(Sender.fromConfig).mockResolvedValue(
    asSender({
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })
  );
  mockPool({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  });
};

const migratorLayer = (migrate: SchemaMigratorService["migrate"]) =>
  Layer.succeed(SchemaMigrator, { migrate });

const connectionLayer = (
  config: typeof TestConfigLayer = TestConfigLayer,
  migrator: ReturnType<typeof migratorLayer> = migratorLayer(() => Effect.void)
) =>
  Layer.provide(
    QuestDBConnectionOverMigrator,
    Layer.mergeAll(config, migrator)
  );

/** Lets the real promises behind a successful connection settle. */
const untilConnected = (connection: QuestDBConnectionService) =>
  Effect.gen(function* () {
    for (let polls = 0; polls < 200; polls += 1) {
      if (Option.isSome((yield* connection.getState).connection)) return;
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve, 5))
      );
    }
  });

/** Builds the connection layer into a scope the test may close early. */
const connectInScope = (migrate: SchemaMigratorService["migrate"]) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const building = yield* Effect.forkChild(
      Layer.buildWithScope(
        connectionLayer(TestConfigLayer, migratorLayer(migrate)),
        scope
      )
    );
    yield* TestClock.adjust(Duration.millis(100));
    const context = yield* Fiber.join(building);
    return {
      scope,
      connection: Context.get(context, QuestDBConnection),
    };
  });

describe("QuestDBConnection integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("connection creation", () => {
    it.live("should create connection successfully with http protocol", () => {
      const mockSender = {
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const conn = yield* connection.getConnection;
        expect(conn.sender).toBe(mockSender);
        expect(conn.pgClient).toBe(mockPgClient);

        expect(Sender.fromConfig).toHaveBeenCalledWith(
          expect.stringContaining("http::addr=localhost:9000")
        );
        expect(mockPgClient.query).toHaveBeenCalledWith("SELECT 1");
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live(
      "should create connection with tcp protocol and call connect",
      () => {
        const TestConfigTcpLayer = makeTestConfigLayer({
          database: {
            requestTimeout: 5000,
            retryTimeout: 10000,
            protocol: "tcp",
          },
        });

        const mockSender = {
          connect: vi.fn().mockResolvedValue(undefined),
          flush: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        };
        const mockPgClient = {
          connect: vi.fn().mockResolvedValue(undefined),
          query: vi.fn().mockResolvedValue({ rows: [] }),
          end: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
        };

        vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
        mockPool(mockPgClient);

        return Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(200));
          yield* connection.getConnection;

          expect(mockSender.connect).toHaveBeenCalled();
          expect(Sender.fromConfig).toHaveBeenCalledWith(
            expect.stringContaining("tcp::addr=localhost:9009")
          );
        }).pipe(Effect.provide(connectionLayer(TestConfigTcpLayer)));
      }
    );

    it.live("should handle sender connection failure", () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Sender connection failed")
      );

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.result(connection.getConnection);
        expect(Result.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live(
      "should handle pgClient connection failure and cleanup sender",
      () => {
        const mockSender = {
          close: vi.fn().mockResolvedValue(undefined),
        };
        const mockPgClient = {
          query: vi.fn().mockRejectedValue(new Error("PgWire failed")),
          end: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
        };

        vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
        mockPool(mockPgClient);

        return Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(200));
          const result = yield* Effect.result(connection.getConnection);
          expect(Result.isFailure(result)).toBe(true);

          expect(mockSender.close).toHaveBeenCalled();
          expect(mockPgClient.end).toHaveBeenCalled();
        }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
      }
    );

    it.live("should handle connection verification failure and cleanup", () => {
      const mockSender = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockRejectedValue(new Error("Verification failed")),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.result(connection.getConnection);
        expect(Result.isFailure(result)).toBe(true);

        expect(mockSender.close).toHaveBeenCalled();
        expect(mockPgClient.end).toHaveBeenCalled();
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });
  });

  describe("connection lifecycle", () => {
    it.live("should return DatabaseUnavailable when not connected", () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Connection failed")
      );

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.result(connection.getConnection);

        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(DatabaseUnavailable);
        }
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live("should track connection state correctly", () => {
      const mockSender = {
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;

        yield* Effect.sleep(Duration.millis(200));

        const connectedState = yield* connection.getState;
        expect(Option.isSome(connectedState.connection)).toBe(true);
        expect(connectedState.isConnecting).toBe(false);
        expect(Option.isNone(connectedState.lastError)).toBe(true);
        if (Option.isSome(connectedState.connectedSince)) {
          expect(connectedState.connectedSince.value).toBeInstanceOf(Date);
        } else {
          expect.fail("connectedSince should be Some(Date)");
        }
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live("should close connection properly", () => {
      const mockSender = {
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        yield* connection.close;

        const state = yield* connection.getState;
        expect(Option.isNone(state.connection)).toBe(true);

        expect(mockSender.flush).toHaveBeenCalled();
        expect(mockSender.close).toHaveBeenCalled();
        expect(mockPgClient.end).toHaveBeenCalled();
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });
  });

  describe("connection retry logic", () => {
    it.live("should retry connection on failure", () => {
      let attemptCount = 0;
      vi.mocked(Sender.fromConfig).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("First attempt failed");
        }
        return asSender({
          flush: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        });
      });

      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(3000));
        const conn = yield* connection.getConnection;
        expect(conn).toBeDefined();
        expect(attemptCount).toBeGreaterThan(1);
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live("should update lastError on connection failure", () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Connection failed")
      );

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(500));

        const state = yield* connection.getState;
        expect(Option.isSome(state.lastError)).toBe(true);
        if (Option.isSome(state.lastError)) {
          expect(state.lastError.value.message).toContain("timed out");
        }
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });
  });

  describe("error handling and recovery", () => {
    it.live("should mark connection as disconnected on error", () => {
      const mockSender = {
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));

        const stateBefore = yield* connection.getState;
        expect(Option.isSome(stateBefore.connection)).toBe(true);

        yield* connection.markDisconnected(
          yield* connection.getConnection,
          "Test error"
        );

        const stateAfter = yield* connection.getState;
        expect(Option.isNone(stateAfter.connection)).toBe(true);
        expect(Option.isSome(stateAfter.lastError)).toBe(true);
        if (Option.isSome(stateAfter.lastError)) {
          expect(stateAfter.lastError.value.message).toBe("Test error");
        }
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live("should handle health check failures and reconnect", () => {
      let healthCheckCount = 0;
      const mockSender = {
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockImplementation(async () => {
          healthCheckCount++;
          if (healthCheckCount === 2) {
            throw new Error("Health check failed");
          }
          return { rows: [] };
        }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig)
        .mockResolvedValueOnce(asSender(mockSender))
        .mockImplementation(() => new Promise(() => undefined));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(6000));

        const state = yield* connection.getState;
        expect(healthCheckCount).toBeGreaterThan(1);
        expect(Option.isNone(state.connection)).toBe(true);
        expect(Option.map(state.lastError, (error) => error.message)).toEqual(
          Option.some("Health check failed")
        );
        expect(Sender.fromConfig).toHaveBeenCalledTimes(2);
        expect(mockSender.close).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live("should handle pg error events", () => {
      let errorHandler: ((error: Error) => void) | undefined;
      const mockSender = {
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn().mockImplementation((event: string, handler: unknown) => {
          if (event === "error") {
            errorHandler = handler as (error: Error) => void;
          }
        }),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));

        const stateBefore = yield* connection.getState;
        expect(Option.isSome(stateBefore.connection)).toBe(true);

        if (errorHandler) {
          errorHandler(new Error("PG error event"));
        }

        yield* Effect.sleep(Duration.millis(100));

        const stateAfter = yield* connection.getState;
        expect(Option.isNone(stateAfter.connection)).toBe(true);
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });

    it.live("should handle cleanup errors gracefully", () => {
      const mockSender = {
        flush: vi.fn().mockRejectedValue(new Error("Flush failed")),
        close: vi.fn().mockRejectedValue(new Error("Close failed")),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockRejectedValue(new Error("End failed")),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        yield* connection.close;
      }).pipe(Effect.provide(connectionLayer(TestConfigLayer)));
    });
  });

  describe("schema migration", () => {
    it.live("migrates before it creates the sender", () => {
      const events: string[] = [];
      healthyConnection();
      vi.mocked(Sender.fromConfig).mockImplementation(async () => {
        events.push("sender");
        return asSender({
          flush: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        });
      });

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(300));
        yield* connection.getConnection;

        expect(events).toEqual(["migrate", "sender"]);
      }).pipe(
        Effect.provide(
          connectionLayer(
            TestConfigLayer,
            migratorLayer(() => Effect.sync(() => void events.push("migrate")))
          )
        )
      );
    });

    it.live("explains the wait through lastError while it migrates", () => {
      healthyConnection();
      const release = Deferred.makeUnsafe<void>();

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(300));

        const migrating = yield* connection.getState;
        expect(migrating.isConnecting).toBe(true);
        expect(Option.isNone(migrating.connection)).toBe(true);
        expect(
          Option.map(migrating.lastError, (error) => error.message)
        ).toEqual(
          Option.some("Migrating database schema (v2: conform-network-metrics)")
        );
        const unavailable = yield* Effect.flip(connection.getConnection);
        expect(unavailable.message).toContain("Migrating database schema");

        yield* Deferred.succeed(release, undefined);
        yield* Effect.sleep(Duration.millis(300));
        yield* connection.getConnection;
      }).pipe(
        Effect.provide(
          connectionLayer(
            TestConfigLayer,
            migratorLayer(({ onProgress }) =>
              Effect.gen(function* () {
                yield* onProgress?.("v2: conform-network-metrics") ??
                  Effect.void;
                yield* Deferred.await(release);
              })
            )
          )
        )
      );
    });

    it.live(
      "shows a recovery step through lastError, not a stale connection error",
      () => {
        healthyConnection();
        const release = Deferred.makeUnsafe<void>();

        return Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(300));

          const migrating = yield* connection.getState;
          expect(
            Option.map(migrating.lastError, (error) => error.message)
          ).toEqual(
            Option.some(
              "Migrating database schema (recovering an interrupted rebuild of network_metrics)"
            )
          );

          yield* Deferred.succeed(release, undefined);
        }).pipe(
          Effect.provide(
            connectionLayer(
              TestConfigLayer,
              migratorLayer(({ onProgress }) =>
                Effect.gen(function* () {
                  yield* onProgress?.(
                    "recovering an interrupted rebuild of network_metrics"
                  ) ?? Effect.void;
                  yield* Deferred.await(release);
                })
              )
            )
          )
        );
      }
    );

    it.live(
      "stays unavailable with the migration's own message and creates no sender when it fails",
      () => {
        vi.mocked(Sender.fromConfig).mockResolvedValue(asSender({}));

        return Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(300));

          const unavailable = yield* Effect.flip(connection.getConnection);
          expect(unavailable).toBeInstanceOf(DatabaseUnavailable);
          expect(unavailable.message).toBe(failing("transient").message);
          const state = yield* connection.getState;
          expect(state.isConnecting).toBe(false);
          expect(Sender.fromConfig).not.toHaveBeenCalled();
        }).pipe(
          Effect.provide(
            connectionLayer(
              TestConfigLayer,
              migratorLayer(() => Effect.fail(failing("transient")))
            )
          )
        );
      }
    );
  });

  describe("schema migration retries on the test clock", () => {
    /** Builds the connection layer in a child fiber so the test clock can run its start-up sleep. */
    const connect = (migrate: SchemaMigratorService["migrate"]) =>
      Effect.gen(function* () {
        const building = yield* Effect.forkChild(
          Layer.build(connectionLayer(TestConfigLayer, migratorLayer(migrate)))
        );
        yield* TestClock.adjust(Duration.millis(100));
        const context = yield* Fiber.join(building);
        return Context.get(context, QuestDBConnection);
      });

    it.effect(
      "retries a transient failure at the reconnect interval and not before",
      () => {
        let attempts = 0;

        return Effect.gen(function* () {
          yield* connect(() =>
            Effect.suspend(() => {
              attempts += 1;
              return Effect.fail(failing("transient"));
            })
          );
          expect(attempts).toBe(1);

          yield* TestClock.adjust(Duration.millis(1899));
          expect(attempts).toBe(1);

          yield* TestClock.adjust(Duration.millis(1));
          expect(attempts).toBe(2);
        });
      }
    );

    it.effect(
      "doubles the wait after each repeated transient failure, up to ten minutes",
      () => {
        let attempts = 0;
        const waitsMs = [
          2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000,
          512_000, 600_000, 600_000,
        ];

        return Effect.gen(function* () {
          yield* connect(() =>
            Effect.suspend(() => {
              attempts += 1;
              return Effect.fail(failing("transient"));
            })
          );
          let waited = 100;

          for (const [index, waitMs] of waitsMs.entries()) {
            expect(attempts).toBe(index + 1);
            yield* TestClock.adjust(Duration.millis(waitMs - waited - 1));
            expect(attempts).toBe(index + 1);
            yield* TestClock.adjust(Duration.millis(1));
            expect(attempts).toBe(index + 2);
            waited = 0;
          }
        });
      }
    );

    it.effect("starts again at the reconnect interval after a success", () => {
      healthyConnection();
      let attempts = 0;

      return Effect.gen(function* () {
        const connection = yield* connect(() =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts <= 2
              ? Effect.fail(failing("transient"))
              : attempts === 3
                ? Effect.void
                : Effect.fail(failing("transient"));
          })
        );
        yield* TestClock.adjust(Duration.millis(1900));
        yield* TestClock.adjust(Duration.seconds(4));
        expect(attempts).toBe(3);
        yield* untilConnected(connection);

        yield* connection.markDisconnected(
          yield* connection.getConnection,
          "connection dropped"
        );
        yield* TestClock.adjust(Duration.seconds(5));
        expect(attempts).toBe(4);

        yield* TestClock.adjust(Duration.millis(1999));
        expect(attempts).toBe(4);
        yield* TestClock.adjust(Duration.millis(1));
        expect(attempts).toBe(5);
      });
    });

    it.effect(
      "keeps retrying a failed connect step at the reconnect interval and says so as a connection failure",
      () => {
        let attempts = 0;

        return Effect.gen(function* () {
          const connection = yield* connect(() =>
            Effect.suspend(() => {
              attempts += 1;
              return Effect.fail(
                new MigrationError({
                  step: "connect",
                  kind: "transient",
                  message: "Could not connect to run migrations: ECONNREFUSED",
                })
              );
            })
          );
          expect(attempts).toBe(1);

          let waited = 100;
          for (let expected = 2; expected <= 6; expected += 1) {
            yield* TestClock.adjust(Duration.millis(2000 - waited - 1));
            expect(attempts).toBe(expected - 1);
            yield* TestClock.adjust(Duration.millis(1));
            expect(attempts).toBe(expected);
            waited = 0;
          }
          const state = yield* connection.getState;
          expect(state.isConnecting).toBe(false);
          expect(Option.map(state.lastError, (error) => error.message)).toEqual(
            Option.some("Could not connect to run migrations: ECONNREFUSED")
          );
        });
      }
    );

    it.effect("does not count connect failures towards the backoff", () => {
      let attempts = 0;

      return Effect.gen(function* () {
        yield* connect(() =>
          Effect.suspend(() => {
            attempts += 1;
            return Effect.fail(
              attempts <= 3
                ? failing("transient", "connect")
                : failing("transient")
            );
          })
        );
        yield* TestClock.adjust(Duration.millis(1900));
        yield* TestClock.adjust(Duration.seconds(2));
        yield* TestClock.adjust(Duration.seconds(2));
        expect(attempts).toBe(4);

        yield* TestClock.adjust(Duration.millis(1999));
        expect(attempts).toBe(4);
        yield* TestClock.adjust(Duration.millis(1));
        expect(attempts).toBe(5);
        yield* TestClock.adjust(Duration.millis(3999));
        expect(attempts).toBe(5);
        yield* TestClock.adjust(Duration.millis(1));
        expect(attempts).toBe(6);
      });
    });

    it.effect(
      "retries a terminal failure after ten minutes and not before",
      () => {
        let attempts = 0;

        return Effect.gen(function* () {
          const connection = yield* connect(() =>
            Effect.suspend(() => {
              attempts += 1;
              return Effect.fail(failing("terminal"));
            })
          );
          expect(attempts).toBe(1);

          yield* TestClock.adjust(Duration.millis(10 * 60 * 1000 - 101));
          expect(attempts).toBe(1);
          const state = yield* connection.getState;
          expect(Option.map(state.lastError, (error) => error.message)).toEqual(
            Option.some("disk full")
          );
          expect(Sender.fromConfig).not.toHaveBeenCalled();

          yield* TestClock.adjust(Duration.millis(1));
          expect(attempts).toBe(2);
        });
      }
    );

    it.effect(
      "connects once a transient failure clears and drops the migration error",
      () => {
        healthyConnection();
        let attempts = 0;

        return Effect.gen(function* () {
          const connection = yield* connect(() =>
            Effect.suspend(() => {
              attempts += 1;
              return attempts === 1
                ? Effect.fail(failing("transient"))
                : Effect.void;
            })
          );
          const failed = yield* connection.getState;
          expect(Option.isSome(failed.lastError)).toBe(true);
          expect(Sender.fromConfig).not.toHaveBeenCalled();

          yield* TestClock.adjust(Duration.seconds(2));
          yield* untilConnected(connection);

          const connected = yield* connection.getState;
          expect(Option.isSome(connected.connection)).toBe(true);
          expect(Option.isNone(connected.lastError)).toBe(true);
          expect(attempts).toBe(2);
          expect(Sender.fromConfig).toHaveBeenCalledTimes(1);
        });
      }
    );

    describe("rewriting tables", () => {
      const permissions = () => {
        const seen: boolean[] = [];
        const migrate: SchemaMigratorService["migrate"] = ({
          canRewriteTables,
        }) => Effect.sync(() => void seen.push(canRewriteTables));
        return { seen, migrate };
      };

      it.effect(
        "allows it until this process has opened an ILP connection",
        () => {
          healthyConnection();
          const { seen, migrate } = permissions();

          return Effect.gen(function* () {
            const connection = yield* connect(migrate);
            yield* untilConnected(connection);
            expect(seen).toEqual([true]);

            yield* connection.markDisconnected(
              yield* connection.getConnection,
              "connection dropped"
            );
            yield* TestClock.adjust(Duration.seconds(5));
            yield* untilConnected(connection);

            expect(seen).toEqual([true, false]);
          });
        }
      );

      it.effect("keeps allowing it while no sender has been created", () => {
        vi.mocked(Sender.fromConfig).mockRejectedValue(new Error("no sender"));
        const { seen, migrate } = permissions();

        return Effect.gen(function* () {
          yield* connect(migrate);
          yield* TestClock.adjust(Duration.seconds(20));

          expect(seen.length).toBeGreaterThan(1);
          expect(seen.every((allowed) => allowed)).toBe(true);
        });
      });
    });
  });

  describe("connection loop crashes", () => {
    it.effect("restarts the loop after every crash, not only the first", () => {
      healthyConnection();
      let attempts = 0;

      return Effect.gen(function* () {
        const { scope, connection } = yield* connectInScope(() =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts <= 2 ? Effect.die("boom") : Effect.void;
          })
        );
        expect(attempts).toBe(1);

        yield* TestClock.adjust(Duration.seconds(5));
        expect(attempts).toBe(2);

        yield* TestClock.adjust(Duration.seconds(5));
        expect(attempts).toBe(3);
        yield* untilConnected(connection);
        expect(Option.isSome((yield* connection.getState).connection)).toBe(
          true
        );
        expect(Sender.fromConfig).toHaveBeenCalledTimes(1);

        yield* Scope.close(scope, Exit.void);
      });
    });

    it.effect(
      "stops the loop when the scope closes during a crash pause",
      () => {
        let attempts = 0;

        return Effect.gen(function* () {
          const { scope } = yield* connectInScope(() =>
            Effect.suspend(() => {
              attempts += 1;
              return Effect.die("boom");
            })
          );
          expect(attempts).toBe(1);

          yield* Scope.close(scope, Exit.void);
          yield* TestClock.adjust(Duration.minutes(1));

          expect(attempts).toBe(1);
        });
      }
    );

    it.effect("stops the loop when the scope closes mid-iteration", () => {
      let attempts = 0;

      return Effect.gen(function* () {
        const { scope } = yield* connectInScope(() =>
          Effect.suspend(() => {
            attempts += 1;
            return Effect.fail(failing("transient"));
          })
        );
        expect(attempts).toBe(1);

        yield* Scope.close(scope, Exit.void);
        yield* TestClock.adjust(Duration.minutes(1));

        expect(attempts).toBe(1);
      });
    });
  });
});

describe("closing a connection whose flush never settles", () => {
  const flushBoundMs = 5000;

  /** The first flush hangs, as an HTTP sender does while QuestDB is down. */
  const connectionWithHungFlush = () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const end = vi.fn().mockResolvedValue(undefined);
    const healthEnd = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const flush = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>(() => undefined))
      .mockResolvedValue(true);
    vi.mocked(Sender.fromConfig).mockResolvedValue(asSender({ flush, close }));
    mockPools(
      { query, end, on: vi.fn() },
      { query, end: healthEnd, on: vi.fn() }
    );
    return { close, end, healthEnd, query };
  };

  const settlePromises = Effect.promise(
    () => new Promise((resolve) => setTimeout(resolve, 20))
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.effect(
    "markDisconnected closes the sender and both pools once the flush bound passes",
    () => {
      const { close, end, healthEnd } = connectionWithHungFlush();

      return Effect.gen(function* () {
        const { connection } = yield* connectInScope(() => Effect.void);
        yield* untilConnected(connection);

        const fiber = yield* Effect.forkChild(
          connection.markDisconnected(
            yield* connection.getConnection,
            "write timed out"
          )
        );
        yield* TestClock.adjust(Duration.millis(flushBoundMs - 1));
        yield* settlePromises;
        const beforeBound = fiber.pollUnsafe();
        yield* TestClock.adjust(Duration.millis(1));
        yield* settlePromises;

        expect(beforeBound).toBeUndefined();
        expect(fiber.pollUnsafe()).toBeDefined();
        expect(close).toHaveBeenCalledTimes(1);
        expect(end).toHaveBeenCalledTimes(1);
        expect(healthEnd).toHaveBeenCalledTimes(1);
      });
    }
  );

  it.effect(
    "closing the scope logs the close and ends both pools once the flush bound passes",
    () => {
      const { close, end, healthEnd } = connectionWithHungFlush();
      const logs: string[] = [];
      const logger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message));
      });

      return Effect.gen(function* () {
        const { scope, connection } = yield* connectInScope(() => Effect.void);
        yield* untilConnected(connection);

        const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        yield* TestClock.adjust(Duration.millis(flushBoundMs));
        yield* settlePromises;

        expect(closing.pollUnsafe()).toBeDefined();
        expect(close).toHaveBeenCalledTimes(1);
        expect(end).toHaveBeenCalledTimes(1);
        expect(healthEnd).toHaveBeenCalledTimes(1);
        expect(logs.join("\n")).toContain("QuestDB connection closed");
      }).pipe(Effect.provide(Logger.layer([logger])));
    }
  );

  it.effect("stops the health loop before the shutdown flush starts", () => {
    const { query } = connectionWithHungFlush();

    return Effect.gen(function* () {
      const { scope, connection } = yield* connectInScope(() => Effect.void);
      yield* untilConnected(connection);
      yield* settlePromises;
      const queriesBeforeClose = query.mock.calls.length;

      yield* Effect.forkChild(Scope.close(scope, Exit.void));
      yield* TestClock.adjust(Duration.millis(flushBoundMs));
      yield* settlePromises;

      expect(query).toHaveBeenCalledTimes(queriesBeforeClose);
      expect(Sender.fromConfig).toHaveBeenCalledTimes(1);
    });
  });

  it.effect(
    "neither closes a connection twice nor orphans a newer one when disconnects overlap a reconnect",
    () => {
      interface PoolPair {
        readonly queryPool: Pool;
        readonly queryEnd: ReturnType<typeof vi.fn>;
        readonly healthEnd: ReturnType<typeof vi.fn>;
      }
      const pairs: PoolPair[] = [];
      let senders = 0;
      vi.mocked(Sender.fromConfig).mockImplementation(async () => {
        senders += 1;
        const hangs = senders === 1;
        return asSender({
          flush: vi.fn(() =>
            hangs
              ? new Promise<boolean>(() => undefined)
              : Promise.resolve(true)
          ),
          close: vi.fn().mockResolvedValue(undefined),
        });
      });
      vi.mocked(Pool).mockImplementation(function (
        this: unknown,
        config?: { max?: number }
      ) {
        const end = vi.fn().mockResolvedValue(undefined);
        const pool = asPool({
          query: vi.fn().mockResolvedValue({ rows: [] }),
          end,
          on: vi.fn(),
        });
        if (config?.max === 1) {
          const pair = pairs.at(-1);
          if (pair !== undefined)
            pairs[pairs.length - 1] = { ...pair, healthEnd: end };
        } else {
          pairs.push({ queryPool: pool, queryEnd: end, healthEnd: vi.fn() });
        }
        return pool;
      });

      return Effect.gen(function* () {
        const { connection } = yield* connectInScope(() => Effect.void);
        yield* untilConnected(connection);
        yield* settlePromises;

        yield* TestClock.adjust(Duration.millis(1000));
        yield* Effect.forkChild(
          connection.markDisconnected(yield* connection.getConnection, "first")
        );
        yield* TestClock.adjust(Duration.millis(4500));
        yield* settlePromises;
        yield* Effect.forkChild(
          connection.markDisconnected(yield* connection.getConnection, "second")
        );
        yield* TestClock.adjust(Duration.millis(500));
        yield* settlePromises;
        yield* TestClock.adjust(Duration.millis(4000));
        yield* settlePromises;
        yield* TestClock.adjust(Duration.millis(500));
        yield* settlePromises;

        const current = (yield* connection.getState).connection;
        const currentPool = Option.isSome(current)
          ? current.value.pgClient
          : undefined;
        expect(pairs.length).toBeGreaterThan(1);
        for (const { queryPool, queryEnd, healthEnd } of pairs) {
          const expected = queryPool === currentPool ? 0 : 1;
          expect(queryEnd).toHaveBeenCalledTimes(expected);
          expect(healthEnd).toHaveBeenCalledTimes(expected);
        }
      });
    }
  );
});

describe("pool settings", () => {
  const database = makeTestAppConfig({
    database: { queryTimeout: 20_000 },
  }).database;

  describe("queryPoolConfig", () => {
    it("lets the server cut a query off at the query timeout", () => {
      expect(queryPoolConfig(database).options).toBe(
        "-c statement_timeout=20000"
      );
    });

    it("does not send statement_timeout as a startup parameter, which QuestDB ignores", () => {
      expect(queryPoolConfig(database)).not.toHaveProperty("statement_timeout");
    });

    it("backs the server's cut-off with a later client-side one", () => {
      const { query_timeout } = queryPoolConfig(database);

      expect(query_timeout).toBeGreaterThan(20_000);
    });

    it("waits as long as a query may take for a free connection", () => {
      expect(queryPoolConfig(database).connectionTimeoutMillis).toBe(20_000);
    });

    it("targets the pgwire port with ten connections", () => {
      expect(queryPoolConfig(database)).toMatchObject({
        host: "localhost",
        port: 8812,
        max: 10,
        idleTimeoutMillis: 30_000,
      });
    });
  });

  describe("healthPoolConfig", () => {
    it("holds a single connection that no query can take", () => {
      expect(healthPoolConfig(database).max).toBe(1);
    });

    it("gives a hung health query the query timeout, after which pg releases the connection", () => {
      expect(healthPoolConfig(database).query_timeout).toBe(20_000);
    });

    it("keeps the five second connect limit whatever the query timeout", () => {
      for (const queryTimeout of [1_000, 20_000, 60_000]) {
        const config = healthPoolConfig({ ...database, queryTimeout });

        expect(config.connectionTimeoutMillis).toBe(5000);
      }
    });
  });
});

describe("the health pool beside the query pool", () => {
  const settlePromises = Effect.promise(
    () => new Promise((resolve) => setTimeout(resolve, 20))
  );

  const neverSettles = () => new Promise<never>(() => undefined);

  const okPool = (overrides: Partial<Pool> = {}): Partial<Pool> => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    ...overrides,
  });

  const mockSender = () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Sender.fromConfig).mockResolvedValue(
      asSender({ flush: vi.fn().mockResolvedValue(undefined), close })
    );
    return { close };
  };

  const connected = Effect.gen(function* () {
    const { connection } = yield* connectInScope(() => Effect.void);
    yield* untilConnected(connection);
    yield* settlePromises;
    return connection;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.effect(
    "stays connected while every query connection is busy for longer than the health timeout",
    () => {
      mockSender();
      const queryPoolQuery = vi.fn().mockImplementation(neverSettles);
      const healthQuery = vi.fn().mockResolvedValue({ rows: [] });
      mockPools(
        okPool({ query: queryPoolQuery }),
        okPool({ query: healthQuery })
      );

      return Effect.gen(function* () {
        const connection = yield* connected;

        for (let seconds = 0; seconds < 60; seconds += 5) {
          yield* TestClock.adjust(Duration.seconds(5));
          yield* settlePromises;
        }

        expect(Option.isSome((yield* connection.getState).connection)).toBe(
          true
        );
        expect(healthQuery.mock.calls.length).toBeGreaterThanOrEqual(10);
        expect(queryPoolQuery).not.toHaveBeenCalled();
      });
    }
  );

  it.effect(
    "waits as long as a query may take for the health answer, then reconnects",
    () => {
      mockSender();
      mockPools(
        okPool(),
        okPool({
          query: vi
            .fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockImplementation(neverSettles),
        })
      );

      return Effect.gen(function* () {
        yield* connected;

        yield* TestClock.adjust(Duration.millis(24_000));
        yield* settlePromises;
        const connectionsBefore = vi.mocked(Sender.fromConfig).mock.calls
          .length;
        yield* TestClock.adjust(Duration.millis(2_000));
        yield* settlePromises;

        expect(connectionsBefore).toBe(1);
        expect(Sender.fromConfig).toHaveBeenCalledTimes(2);
      });
    }
  );

  it.effect("closes both pools when the connection goes", () => {
    mockSender();
    const queryEnd = vi.fn().mockResolvedValue(undefined);
    const healthEnd = vi.fn().mockResolvedValue(undefined);
    mockPools(okPool({ end: queryEnd }), okPool({ end: healthEnd }));

    return Effect.gen(function* () {
      const connection = yield* connected;

      const closing = yield* Effect.forkChild(connection.close);
      yield* TestClock.adjust(Duration.millis(5000));
      yield* settlePromises;
      yield* Fiber.join(closing);

      expect(queryEnd).toHaveBeenCalledTimes(1);
      expect(healthEnd).toHaveBeenCalledTimes(1);
    });
  });

  it.effect(
    "stops waiting for a pool that never finishes ending, so the disconnect completes",
    () => {
      mockSender();
      mockPools(
        okPool(),
        okPool({
          end: vi
            .fn()
            .mockImplementationOnce(neverSettles)
            .mockResolvedValue(undefined),
        })
      );

      return Effect.gen(function* () {
        const connection = yield* connected;

        const fiber = yield* Effect.forkChild(
          connection.markDisconnected(
            yield* connection.getConnection,
            "health check hung"
          )
        );
        yield* TestClock.adjust(Duration.millis(4999));
        yield* settlePromises;
        const beforeBound = fiber.pollUnsafe();
        yield* TestClock.adjust(Duration.millis(1));
        yield* settlePromises;

        expect(beforeBound).toBeUndefined();
        expect(fiber.pollUnsafe()).toBeDefined();
      });
    }
  );

  describe.each([
    ["query pool", "queryPool"],
    ["health pool", "healthPool"],
  ] as const)("the %s's error event", (_name, which) => {
    it.effect("disconnects instead of crashing the process", () => {
      mockSender();
      const handlers: Record<
        "queryPool" | "healthPool",
        (error: Error) => void
      > = { queryPool: () => undefined, healthPool: () => undefined };
      const capture =
        (key: keyof typeof handlers) => (event: string, handler: unknown) => {
          if (event === "error" && typeof handler === "function") {
            handlers[key] = (error) => handler(error);
          }
        };
      mockPools(
        okPool({ on: vi.fn().mockImplementation(capture("queryPool")) }),
        okPool({ on: vi.fn().mockImplementation(capture("healthPool")) })
      );

      return Effect.gen(function* () {
        const connection = yield* connected;

        handlers[which](new Error("idle client died"));
        yield* settlePromises;

        const state = yield* connection.getState;
        expect(Option.isNone(state.connection)).toBe(true);
        expect(Option.map(state.lastError, (error) => error.message)).toEqual(
          Option.some("idle client died")
        );
      });
    });
  });

  describe("verifying a new connection", () => {
    it.effect(
      "goes through the health pool and leaves the query pool unused",
      () => {
        mockSender();
        const queryPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
        const healthQuery = vi.fn().mockResolvedValue({ rows: [] });
        mockPools(
          okPool({ query: queryPoolQuery }),
          okPool({ query: healthQuery })
        );

        return Effect.gen(function* () {
          yield* connected;

          expect(healthQuery).toHaveBeenCalledWith("SELECT 1");
          expect(queryPoolQuery).not.toHaveBeenCalled();
        });
      }
    );

    it.effect("closes the sender and both pools when it fails", () => {
      const { close } = mockSender();
      const queryEnd = vi.fn().mockResolvedValue(undefined);
      const healthEnd = vi.fn().mockResolvedValue(undefined);
      mockPools(
        okPool({ end: queryEnd }),
        okPool({
          end: healthEnd,
          query: vi.fn().mockRejectedValue(new Error("refused")),
        })
      );

      return Effect.gen(function* () {
        yield* connectInScope(() => Effect.void);
        yield* settlePromises;

        expect(close).toHaveBeenCalledTimes(1);
        expect(queryEnd).toHaveBeenCalledTimes(1);
        expect(healthEnd).toHaveBeenCalledTimes(1);
      });
    });

    it.effect("gives up after five seconds and still cleans up", () => {
      const { close } = mockSender();
      const queryEnd = vi.fn().mockResolvedValue(undefined);
      const healthEnd = vi.fn().mockResolvedValue(undefined);
      mockPools(
        okPool({ end: queryEnd }),
        okPool({
          end: healthEnd,
          query: vi.fn().mockImplementation(neverSettles),
        })
      );

      return Effect.gen(function* () {
        yield* connectInScope(() => Effect.void);
        yield* TestClock.adjust(Duration.millis(4800));
        yield* settlePromises;
        const closedEarly = close.mock.calls.length;
        yield* TestClock.adjust(Duration.millis(300));
        yield* settlePromises;

        expect(closedEarly).toBe(0);
        expect(close).toHaveBeenCalledTimes(1);
        expect(queryEnd).toHaveBeenCalledTimes(1);
        expect(healthEnd).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("ping", () => {
    it.effect("runs SELECT 1 on the health pool, not the query pool", () => {
      mockSender();
      const queryPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
      const healthQuery = vi.fn().mockResolvedValue({ rows: [] });
      mockPools(
        okPool({ query: queryPoolQuery }),
        okPool({ query: healthQuery })
      );

      return Effect.gen(function* () {
        const connection = yield* connected;
        const before = healthQuery.mock.calls.length;

        yield* connection.ping;

        expect(healthQuery.mock.calls.length).toBe(before + 1);
        expect(queryPoolQuery).not.toHaveBeenCalled();
      });
    });

    it.effect(
      "fails with DatabaseConnectionError when the health query rejects",
      () => {
        mockSender();
        let failNext = false;
        mockPools(
          okPool(),
          okPool({
            query: vi.fn().mockImplementation(async () => {
              if (failNext) {
                failNext = false;
                throw new Error("boom");
              }
              return { rows: [] };
            }),
          })
        );

        return Effect.gen(function* () {
          const connection = yield* connected;

          failNext = true;
          const error = yield* Effect.flip(connection.ping);

          expect(error).toBeInstanceOf(DatabaseConnectionError);
          expect(error.message).toBe("Health check failed: Error: boom");
        });
      }
    );

    it.effect("fails as unavailable while nothing is connected", () =>
      Effect.gen(function* () {
        const { connection } = yield* connectInScope(() =>
          Effect.fail(failing("transient"))
        );

        const error = yield* Effect.flip(connection.ping);

        expect(error).toBeInstanceOf(DatabaseUnavailable);
      })
    );
  });
});

describe("a disconnect report about a connection", () => {
  const settlePromises = Effect.promise(
    () => new Promise((resolve) => setTimeout(resolve, 20))
  );

  /** Records what each opened sender and pool is asked to close, in opening order. */
  const trackOpenedConnections = (
    firstFlush: () => Promise<void> = async () => undefined
  ) => {
    const senderCloses: ReturnType<typeof vi.fn>[] = [];
    const queryEnds: ReturnType<typeof vi.fn>[] = [];
    const healthEnds: ReturnType<typeof vi.fn>[] = [];
    const queryPoolErrorHandlers: ((error: Error) => void)[] = [];

    vi.mocked(Sender.fromConfig).mockImplementation(async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      senderCloses.push(close);
      const flush =
        senderCloses.length === 1 ? firstFlush : async () => undefined;
      return asSender({ flush: vi.fn().mockImplementation(flush), close });
    });
    vi.mocked(Pool).mockImplementation(function (
      this: unknown,
      config?: { max?: number }
    ) {
      const end = vi.fn().mockResolvedValue(undefined);
      const isHealthPool = config?.max === 1;
      (isHealthPool ? healthEnds : queryEnds).push(end);
      return asPool({
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end,
        on: vi.fn().mockImplementation((event: string, handler: unknown) => {
          if (
            !isHealthPool &&
            event === "error" &&
            typeof handler === "function"
          ) {
            queryPoolErrorHandlers.push((error) => handler(error));
          }
        }),
      });
    });

    return { senderCloses, queryEnds, healthEnds, queryPoolErrorHandlers };
  };

  /** Drops the current connection and waits for the loop to open its replacement. */
  const replaceConnection = (connection: QuestDBConnectionService) =>
    Effect.gen(function* () {
      const replaced = yield* connection.getConnection;
      yield* connection.markDisconnected(replaced, "connection dropped");
      yield* TestClock.adjust(Duration.seconds(5));
      yield* untilConnected(connection);
      yield* settlePromises;
      return replaced;
    });

  const connected = Effect.gen(function* () {
    const { connection } = yield* connectInScope(() => Effect.void);
    yield* untilConnected(connection);
    yield* settlePromises;
    return connection;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.effect(
    "closes once and keeps the first report's reason when reported twice at once",
    () => {
      const opened = trackOpenedConnections();

      return Effect.gen(function* () {
        const connection = yield* connected;
        const current = yield* connection.getConnection;
        const reportedAt = yield* Clock.currentTimeMillis;

        yield* Effect.all(
          [
            connection.markDisconnected(current, "first"),
            connection.markDisconnected(current, "second"),
          ],
          { concurrency: "unbounded" }
        );

        const state = yield* connection.getState;
        expect(opened.senderCloses[0]).toHaveBeenCalledTimes(1);
        expect(opened.queryEnds[0]).toHaveBeenCalledTimes(1);
        expect(opened.healthEnds[0]).toHaveBeenCalledTimes(1);
        expect(Option.map(state.lastError, (error) => error.message)).toEqual(
          Option.some("first")
        );
        expect(
          Option.map(state.lastError, (error) => error.timestamp.getTime())
        ).toEqual(Option.some(reportedAt));
      });
    }
  );

  it.effect(
    "leaves the replacement and its pools untouched once the connection is replaced",
    () => {
      const opened = trackOpenedConnections();

      return Effect.gen(function* () {
        const connection = yield* connected;
        const replaced = yield* replaceConnection(connection);
        const replacement = yield* connection.getConnection;
        const before = yield* connection.getState;

        yield* connection.markDisconnected(replaced, "late failure");

        const after = yield* connection.getState;
        expect(replacement).not.toBe(replaced);
        expect(Option.getOrUndefined(after.connection)).toBe(replacement);
        expect(after.lastError).toEqual(before.lastError);
        expect(after.connectedSince).toEqual(before.connectedSince);
        expect(opened.senderCloses[1]).not.toHaveBeenCalled();
        expect(opened.queryEnds[1]).not.toHaveBeenCalled();
        expect(opened.healthEnds[1]).not.toHaveBeenCalled();
      });
    }
  );

  it.effect("changes nothing when nothing is connected", () => {
    const opened = trackOpenedConnections();

    return Effect.gen(function* () {
      const connection = yield* connected;
      const current = yield* connection.getConnection;
      yield* connection.markDisconnected(current, "first");
      const before = yield* connection.getState;

      yield* connection.markDisconnected(current, "second");

      expect(yield* connection.getState).toEqual(before);
      expect(opened.queryEnds[0]).toHaveBeenCalledTimes(1);
    });
  });

  it.effect(
    "keeps the replacement connected when the replaced query pool emits an error",
    () => {
      const opened = trackOpenedConnections();

      return Effect.gen(function* () {
        const connection = yield* connected;
        yield* replaceConnection(connection);
        const replacement = yield* connection.getConnection;

        opened.queryPoolErrorHandlers[0]?.(new Error("late idle client error"));
        yield* settlePromises;

        const state = yield* connection.getState;
        expect(opened.queryPoolErrorHandlers).toHaveLength(2);
        expect(Option.getOrUndefined(state.connection)).toBe(replacement);
        expect(Option.isNone(state.lastError)).toBe(true);
        expect(opened.queryEnds[1]).not.toHaveBeenCalled();
        expect(opened.healthEnds[1]).not.toHaveBeenCalled();
      });
    }
  );

  it.effect("disconnects when the current query pool emits an error", () => {
    const opened = trackOpenedConnections();

    return Effect.gen(function* () {
      const connection = yield* connected;

      opened.queryPoolErrorHandlers[0]?.(new Error("idle client died"));
      yield* settlePromises;

      const state = yield* connection.getState;
      expect(Option.isNone(state.connection)).toBe(true);
      expect(opened.queryEnds[0]).toHaveBeenCalledTimes(1);
    });
  });

  it.effect(
    "bounds the close of a connection whose flush hangs by the test clock after a pool error",
    () => {
      let releaseFlush: (() => void) | undefined;
      const opened = trackOpenedConnections(
        () =>
          new Promise<void>((resolve) => {
            releaseFlush = resolve;
          })
      );

      return Effect.gen(function* () {
        yield* connected;

        opened.queryPoolErrorHandlers[0]?.(new Error("idle client died"));
        yield* settlePromises;
        const closedBeforeBound = opened.senderCloses[0]?.mock.calls.length;
        yield* TestClock.adjust(Duration.millis(5000));
        yield* settlePromises;

        releaseFlush?.();
        expect(closedBeforeBound).toBe(0);
        expect(opened.senderCloses[0]).toHaveBeenCalledTimes(1);
      });
    }
  );

  it.effect(
    "leaves an in-progress reconnect alone when the dropped connection reports again",
    () => {
      const opened = trackOpenedConnections();

      return Effect.gen(function* () {
        const connection = yield* connected;
        const dropped = yield* connection.getConnection;
        vi.mocked(Sender.fromConfig).mockImplementation(
          () => new Promise(() => undefined)
        );
        yield* connection.markDisconnected(dropped, "dropped");
        yield* TestClock.adjust(Duration.seconds(5));
        yield* settlePromises;
        const reconnecting = yield* connection.getState;

        yield* connection.markDisconnected(dropped, "late");

        const after = yield* connection.getState;
        expect(reconnecting.isConnecting).toBe(true);
        expect(after).toEqual(reconnecting);
        expect(Option.map(after.lastError, (error) => error.message)).toEqual(
          Option.some("dropped")
        );
        expect(opened.senderCloses[0]).toHaveBeenCalledTimes(1);
      });
    }
  );
});
