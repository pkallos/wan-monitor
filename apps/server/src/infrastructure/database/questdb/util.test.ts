import { createServer, type Server, type Socket } from "node:net";
import { DatabaseError, Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatabaseUnavailable,
  DatabaseWriteError,
} from "@/infrastructure/database/questdb/errors";
import {
  classifyWriteError,
  errorMessage,
  isConnectionError,
} from "@/infrastructure/database/questdb/util";

describe("errorMessage", () => {
  it("should extract message from Error instance", () => {
    const error = new Error("Test error message");

    const result = errorMessage(error);

    expect(result).toBe("Test error message");
  });

  it("should convert string error to string", () => {
    const error = "Simple string error";

    const result = errorMessage(error);

    expect(result).toBe("Simple string error");
  });

  it("should convert number to string", () => {
    const error = 404;

    const result = errorMessage(error);

    expect(result).toBe("404");
  });

  it("should convert object to string", () => {
    const error = { code: "ERR_001", message: "Custom error" };

    const result = errorMessage(error);

    expect(result).toBe("[object Object]");
  });

  it("should handle null", () => {
    const error = null;

    const result = errorMessage(error);

    expect(result).toBe("null");
  });

  it("should handle undefined", () => {
    const error = undefined;

    const result = errorMessage(error);

    expect(result).toBe("undefined");
  });

  it("should handle custom error types", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }

    const error = new CustomError("Custom error occurred");

    const result = errorMessage(error);

    expect(result).toBe("Custom error occurred");
  });

  it("should fall back to the error code when the message is empty", () => {
    const error = Object.assign(new AggregateError([]), {
      code: "ECONNREFUSED",
    });

    expect(errorMessage(error)).toBe("ECONNREFUSED");
  });

  it("should fall back to the error name when message and code are empty", () => {
    expect(errorMessage(new Error(""))).toBe("Error");
  });
});

const systemError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

describe("isConnectionError", () => {
  it.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EPIPE",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ])("should treat a %s system error as a connection error", (code) => {
    expect(isConnectionError(systemError(`connect ${code}`, code))).toBe(true);
  });

  it("should treat an AggregateError carrying a connection code as a connection error", () => {
    const error = Object.assign(new AggregateError([]), {
      code: "ECONNREFUSED",
    });

    expect(isConnectionError(error)).toBe(true);
  });

  it.each([
    "Connection terminated",
    "Connection terminated unexpectedly",
    "Connection terminated due to connection timeout",
  ])("should treat pg's %j error as a connection error", (message) => {
    expect(isConnectionError(new Error(message))).toBe(true);
  });

  it.each([
    "connect",
    "connection",
    "connectivity_status",
    "timeout",
    "socket",
    "terminated",
  ])(
    "should not treat a server error mentioning %j as a connection error",
    (word) => {
      const error = new DatabaseError(`failed near ${word}`, 0, "error");

      expect(isConnectionError(error)).toBe(false);
    }
  );

  it("should not treat a server error that starts with Connection terminated as a connection error", () => {
    const error = new DatabaseError(
      "Connection terminated by server",
      0,
      "error"
    );

    expect(isConnectionError(error)).toBe(false);
  });

  it.each([
    "Query read timeout",
    "timeout exceeded when trying to connect",
    "Client has encountered a connection error and is not queryable",
    "HTTP request timeout, no response from server in time",
    "Validation error",
    "",
  ])("should not treat the plain error %j as a connection error", (message) => {
    expect(isConnectionError(new Error(message))).toBe(false);
  });

  it("should not treat an unrelated system error code as a connection error", () => {
    expect(isConnectionError(systemError("no such file", "ENOENT"))).toBe(
      false
    );
  });

  it.each([
    ["a string naming a code", "ECONNREFUSED"],
    ["null", null],
    ["undefined", undefined],
    ["an object without a code", { message: "connect ECONNREFUSED" }],
    ["an object with a non-string code", { code: 111 }],
  ])("should not treat %s as a connection error", (_label, value) => {
    expect(isConnectionError(value)).toBe(false);
  });
});

describe("classifyWriteError", () => {
  const rejected = new Error("invalid column: nope");

  it("should keep a rejected write a write error over HTTP", () => {
    const error = classifyWriteError("write metric", "http")(rejected);

    expect(error).toBeInstanceOf(DatabaseWriteError);
    expect(error.message).toBe("Failed to write metric: invalid column: nope");
  });

  it("should treat a rejected write as an unavailable database over TCP", () => {
    const error = classifyWriteError("write metric", "tcp")(rejected);

    expect(error).toBeInstanceOf(DatabaseUnavailable);
    expect(error.message).toBe("invalid column: nope");
  });
});

describe("isConnectionError against a real pg client", () => {
  const servers: Server[] = [];
  const sockets: Socket[] = [];
  const pools: Pool[] = [];

  const listen = (onConnection: (socket: Socket) => void) =>
    new Promise<number>((resolve) => {
      const server = createServer((socket) => {
        sockets.push(socket);
        onConnection(socket);
      });
      servers.push(server);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });

  const closedPort = async () => {
    const port = await listen(() => undefined);
    const server = servers[servers.length - 1];
    await new Promise((resolve) => server?.close(resolve));
    return port;
  };

  const failure = async (host: string, port: number, timeoutMs = 2000) => {
    const pool = new Pool({ host, port, connectionTimeoutMillis: timeoutMs });
    pools.push(pool);
    return pool.query("SELECT 1").then(
      () => undefined,
      (error: unknown) => error
    );
  };

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise((resolve) => server.close(resolve)))
    );
  });

  it("should classify a refused connection to 127.0.0.1", async () => {
    const error = await failure("127.0.0.1", await closedPort());

    expect(error).toMatchObject({ code: "ECONNREFUSED" });
    expect(isConnectionError(error)).toBe(true);
  });

  it("should classify a refused connection to localhost", async () => {
    const error = await failure("localhost", await closedPort());

    expect(isConnectionError(error)).toBe(true);
  });

  it("should classify a server that drops the socket", async () => {
    const port = await listen((socket) => socket.destroy());

    const error = await failure("127.0.0.1", port);

    expect(error).toBeInstanceOf(Error);
    expect(isConnectionError(error)).toBe(true);
  });

  it("should classify a server that never answers", async () => {
    const port = await listen(() => undefined);

    const error = await failure("127.0.0.1", port, 100);

    expect(error).toBeInstanceOf(Error);
    expect(isConnectionError(error)).toBe(true);
  });

  it("should not classify an error response from the server", async () => {
    const fields = [
      "SFATAL",
      "C28000",
      "Mconnection to connectivity_status timeout",
    ]
      .map((field) => `${field}\0`)
      .join("");
    const body = Buffer.from(`${fields}\0`);
    const header = Buffer.alloc(5);
    header.write("E");
    header.writeInt32BE(body.length + 4, 1);
    const port = await listen((socket) => {
      socket.on("data", () => socket.write(Buffer.concat([header, body])));
    });

    const error = await failure("127.0.0.1", port);

    expect(error).toBeInstanceOf(DatabaseError);
    expect(isConnectionError(error)).toBe(false);
  });
});
