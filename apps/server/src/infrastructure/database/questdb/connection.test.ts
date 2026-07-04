import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Sender } from "@questdb/nodejs-client";
import { Duration, Effect, Either, Layer, Option } from "effect";
import { Pool } from "pg";
import { vi } from "vitest";
import {
  QuestDBConnection,
  QuestDBConnectionLive,
} from "@/infrastructure/database/questdb/connection";
import { DbUnavailable } from "@/infrastructure/database/questdb/errors";
import { makeTestConfigLayer } from "@/test/config";

vi.mock("@questdb/nodejs-client");
vi.mock("pg");

const asSender = (mock: Partial<Sender>): Sender => mock as Sender;
const asPool = (mock: Partial<Pool>): Pool => mock as Pool;

const TestConfigLayer = makeTestConfigLayer({
  database: { requestTimeout: 5000, retryTimeout: 10000 },
});

describe("QuestDBConnection integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("connection creation", () => {
    it.scopedLive(
      "should create connection successfully with http protocol",
      () => {
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
        vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

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
        }).pipe(
          Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
        );
      }
    );

    it.scopedLive(
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
        vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

        return Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(200));
          yield* connection.getConnection;

          expect(mockSender.connect).toHaveBeenCalled();
          expect(Sender.fromConfig).toHaveBeenCalledWith(
            expect.stringContaining("tcp::addr=localhost:9009")
          );
        }).pipe(
          Effect.provide(
            Layer.provide(QuestDBConnectionLive, TestConfigTcpLayer)
          )
        );
      }
    );

    it.scopedLive("should handle sender connection failure", () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Sender connection failed")
      );

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.either(connection.getConnection);
        expect(Either.isLeft(result)).toBe(true);
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });

    it.scopedLive(
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
        vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

        return Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(200));
          const result = yield* Effect.either(connection.getConnection);
          expect(Either.isLeft(result)).toBe(true);

          expect(mockSender.close).toHaveBeenCalled();
          expect(mockPgClient.end).toHaveBeenCalled();
        }).pipe(
          Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
        );
      }
    );

    it.scopedLive(
      "should handle connection verification failure and cleanup",
      () => {
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
        vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

        return Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(200));
          const result = yield* Effect.either(connection.getConnection);
          expect(Either.isLeft(result)).toBe(true);

          expect(mockSender.close).toHaveBeenCalled();
          expect(mockPgClient.end).toHaveBeenCalled();
        }).pipe(
          Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
        );
      }
    );
  });

  describe("connection lifecycle", () => {
    it.scopedLive("should return DbUnavailable when not connected", () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Connection failed")
      );

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.either(connection.getConnection);

        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(DbUnavailable);
        }
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });

    it.scopedLive("should track connection state correctly", () => {
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
      vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

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
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });

    it.scopedLive("should close connection properly", () => {
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
      vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        yield* connection.close;

        const state = yield* connection.getState;
        expect(Option.isNone(state.connection)).toBe(true);

        expect(mockSender.flush).toHaveBeenCalled();
        expect(mockSender.close).toHaveBeenCalled();
        expect(mockPgClient.end).toHaveBeenCalled();
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });
  });

  describe("connection retry logic", () => {
    it.scopedLive("should retry connection on failure", () => {
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
      vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(3000));
        const conn = yield* connection.getConnection;
        expect(conn).toBeDefined();
        expect(attemptCount).toBeGreaterThan(1);
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });

    it.scopedLive("should update lastError on connection failure", () => {
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
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });
  });

  describe("error handling and recovery", () => {
    it.scopedLive("should mark connection as disconnected on error", () => {
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
      vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

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
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });

    it.scopedLive("should handle health check failures and reconnect", () => {
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
      vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(6000));

        yield* connection.getState;
        expect(healthCheckCount).toBeGreaterThan(1);
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });

    it.scopedLive("should handle pg error events", () => {
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
      vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

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
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });

    it.scopedLive("should handle cleanup errors gracefully", () => {
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
      vi.mocked(Pool).mockImplementation(() => asPool(mockPgClient));

      return Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        yield* connection.close;
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer))
      );
    });
  });
});
