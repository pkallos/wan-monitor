import { Sender } from "@questdb/nodejs-client";
import { type Context, Duration, Effect, Layer, Option } from "effect";
import { Client as PgClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@/infrastructure/config/config";
import {
  QuestDBConnection,
  QuestDBConnectionLive,
} from "@/infrastructure/database/questdb/connection";
import { DbUnavailable } from "@/infrastructure/database/questdb/errors";

vi.mock("@questdb/nodejs-client");
vi.mock("pg");

const mockConfig = {
  database: {
    host: "localhost",
    port: 9000,
    protocol: "http" as const,
    autoFlushRows: 100,
    autoFlushInterval: 1000,
    requestTimeout: 5000,
    retryTimeout: 10000,
  },
} as const;

const TestConfigLayer = Layer.succeed(
  ConfigService,
  mockConfig as unknown as Context.Tag.Service<ConfigService>
);

describe("QuestDBConnection integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("connection creation", () => {
    it("should create connection successfully with http protocol", async () => {
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

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const conn = yield* connection.getConnection;
        expect(conn.sender).toBe(mockSender);
        expect(conn.pgClient).toBe(mockPgClient);
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);

      expect(Sender.fromConfig).toHaveBeenCalledWith(
        expect.stringContaining("http::addr=localhost:9000")
      );
      expect(mockPgClient.connect).toHaveBeenCalled();
      expect(mockPgClient.query).toHaveBeenCalledWith("SELECT 1");
    });

    it("should create connection with tcp protocol and call connect", async () => {
      const tcpConfig = {
        database: {
          ...mockConfig.database,
          protocol: "tcp" as const,
        },
      };
      const TestConfigTcpLayer = Layer.succeed(
        ConfigService,
        tcpConfig as unknown as Context.Tag.Service<ConfigService>
      );

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

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        yield* connection.getConnection;
      }).pipe(
        Effect.provide(
          Layer.provide(QuestDBConnectionLive, TestConfigTcpLayer)
        ),
        Effect.scoped
      );

      await Effect.runPromise(program);

      expect(mockSender.connect).toHaveBeenCalled();
      expect(Sender.fromConfig).toHaveBeenCalledWith(
        expect.stringContaining("tcp::addr=localhost:9009")
      );
    });

    it("should handle sender connection failure", async () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Sender connection failed")
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.either(connection.getConnection);
        expect(result._tag).toBe("Left");
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });

    it("should handle pgClient connection failure and cleanup sender", async () => {
      const mockSender = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockRejectedValue(new Error("PgWire failed")),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.either(connection.getConnection);
        expect(result._tag).toBe("Left");
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);

      expect(mockSender.close).toHaveBeenCalled();
      expect(mockPgClient.end).toHaveBeenCalled();
    });

    it("should handle connection verification failure and cleanup", async () => {
      const mockSender = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockRejectedValue(new Error("Verification failed")),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.either(connection.getConnection);
        expect(result._tag).toBe("Left");
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);

      expect(mockSender.close).toHaveBeenCalled();
      expect(mockPgClient.end).toHaveBeenCalled();
    });
  });

  describe("connection lifecycle", () => {
    it("should return DbUnavailable when not connected", async () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Connection failed")
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        const result = yield* Effect.either(connection.getConnection);

        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(DbUnavailable);
        }
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });

    it("should track connection state correctly", async () => {
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

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
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
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });

    it("should close connection properly", async () => {
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

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        yield* connection.close;

        const state = yield* connection.getState;
        expect(Option.isNone(state.connection)).toBe(true);
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);

      expect(mockSender.flush).toHaveBeenCalled();
      expect(mockSender.close).toHaveBeenCalled();
      expect(mockPgClient.end).toHaveBeenCalled();
    });
  });

  describe("connection retry logic", () => {
    it("should retry connection on failure", async () => {
      let attemptCount = 0;
      vi.mocked(Sender.fromConfig).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("First attempt failed");
        }
        return {
          flush: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        } as unknown as Sender;
      });

      const mockPgClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(3000));
        const conn = yield* connection.getConnection;
        expect(conn).toBeDefined();
        expect(attemptCount).toBeGreaterThan(1);
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });

    it("should update lastError on connection failure", async () => {
      vi.mocked(Sender.fromConfig).mockRejectedValue(
        new Error("Connection failed")
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(500));

        const state = yield* connection.getState;
        expect(Option.isSome(state.lastError)).toBe(true);
        if (Option.isSome(state.lastError)) {
          expect(state.lastError.value.message).toContain("timed out");
        }
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });
  });

  describe("error handling and recovery", () => {
    it("should mark connection as disconnected on error", async () => {
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

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
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
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });

    it(
      "should handle health check failures and reconnect",
      { timeout: 10000 },
      async () => {
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

        vi.mocked(Sender.fromConfig).mockResolvedValue(
          mockSender as unknown as Sender
        );
        vi.mocked(PgClient).mockImplementation(
          () => mockPgClient as unknown as PgClient
        );

        const program = Effect.gen(function* () {
          const connection = yield* QuestDBConnection;
          yield* Effect.sleep(Duration.millis(6000));

          yield* connection.getState;
          expect(healthCheckCount).toBeGreaterThan(1);
        }).pipe(
          Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
          Effect.scoped
        );

        await Effect.runPromise(program);
      }
    );

    it("should handle pg error events", async () => {
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

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
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
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });

    it("should handle cleanup errors gracefully", async () => {
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

      vi.mocked(Sender.fromConfig).mockResolvedValue(
        mockSender as unknown as Sender
      );
      vi.mocked(PgClient).mockImplementation(
        () => mockPgClient as unknown as PgClient
      );

      const program = Effect.gen(function* () {
        const connection = yield* QuestDBConnection;
        yield* Effect.sleep(Duration.millis(200));
        yield* connection.close;
      }).pipe(
        Effect.provide(Layer.provide(QuestDBConnectionLive, TestConfigLayer)),
        Effect.scoped
      );

      await Effect.runPromise(program);
    });
  });
});
