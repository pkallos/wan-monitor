import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Sender } from "@questdb/nodejs-client";
import {
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
  QuestDBConnection,
  QuestDBConnectionOverMigrator,
  type QuestDBConnectionService,
} from "@/infrastructure/database/questdb/connection";
import { DatabaseUnavailable } from "@/infrastructure/database/questdb/errors";
import { MigrationError } from "@/infrastructure/database/questdb/migrations/migration";
import {
  SchemaMigrator,
  type SchemaMigratorService,
} from "@/infrastructure/database/questdb/migrations/service";
import { makeTestConfigLayer } from "@/test/config";

vi.mock("@questdb/nodejs-client");
vi.mock("pg");

const asSender = (mock: Partial<Sender>): Sender => mock as Sender;
const asPool = (mock: Partial<Pool>): Pool => mock as Pool;
const mockPool = (mock: Partial<Pool>) => {
  vi.mocked(Pool).mockImplementation(function (this: unknown) {
    return asPool(mock);
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

        yield* connection.markDisconnected("Test error");

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

      vi.mocked(Sender.fromConfig).mockResolvedValue(asSender(mockSender));
      mockPool(mockPgClient);

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(6000));

        yield* connection.getState;
        expect(healthCheckCount).toBeGreaterThan(1);
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

        yield* connection.markDisconnected("connection dropped");
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

            yield* connection.markDisconnected("connection dropped");
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
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const flush = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>(() => undefined))
      .mockResolvedValue(true);
    vi.mocked(Sender.fromConfig).mockResolvedValue(asSender({ flush, close }));
    mockPool({ query, end, on: vi.fn() });
    return { close, end, query };
  };

  const settlePromises = Effect.promise(
    () => new Promise((resolve) => setTimeout(resolve, 20))
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.effect(
    "markDisconnected closes the sender and pool once the flush bound passes",
    () => {
      const { close, end } = connectionWithHungFlush();

      return Effect.gen(function* () {
        const { connection } = yield* connectInScope(() => Effect.void);
        yield* untilConnected(connection);

        const fiber = yield* Effect.forkChild(
          connection.markDisconnected("write timed out")
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
      });
    }
  );

  it.effect(
    "closing the scope logs the close and ends the pool once the flush bound passes",
    () => {
      const { close, end } = connectionWithHungFlush();
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
      const pools: { pool: Pool; end: ReturnType<typeof vi.fn> }[] = [];
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
      vi.mocked(Pool).mockImplementation(function (this: unknown) {
        const end = vi.fn().mockResolvedValue(undefined);
        const pool = asPool({
          query: vi.fn().mockResolvedValue({ rows: [] }),
          end,
          on: vi.fn(),
        });
        pools.push({ pool, end });
        return pool;
      });

      return Effect.gen(function* () {
        const { connection } = yield* connectInScope(() => Effect.void);
        yield* untilConnected(connection);
        yield* settlePromises;

        yield* TestClock.adjust(Duration.millis(1000));
        yield* Effect.forkChild(connection.markDisconnected("first"));
        yield* TestClock.adjust(Duration.millis(4500));
        yield* settlePromises;
        yield* Effect.forkChild(connection.markDisconnected("second"));
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
        expect(pools.length).toBeGreaterThan(1);
        for (const { pool, end } of pools) {
          expect(end).toHaveBeenCalledTimes(pool === currentPool ? 0 : 1);
        }
      });
    }
  );
});
