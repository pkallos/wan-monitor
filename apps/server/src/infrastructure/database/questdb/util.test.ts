import { describe, expect, it } from "vitest";
import {
  errorMessage,
  isLikelyConnectionError,
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
});

describe("isLikelyConnectionError", () => {
  it("should detect ECONNREFUSED error", () => {
    expect(isLikelyConnectionError("ECONNREFUSED: Connection refused")).toBe(
      true
    );
    expect(isLikelyConnectionError("Error: econnrefused")).toBe(true);
  });

  it("should detect ECONNRESET error", () => {
    expect(
      isLikelyConnectionError("ECONNRESET: Connection reset by peer")
    ).toBe(true);
    expect(isLikelyConnectionError("Socket error: econnreset")).toBe(true);
  });

  it("should detect ENOTFOUND error", () => {
    expect(isLikelyConnectionError("ENOTFOUND: Host not found")).toBe(true);
    expect(isLikelyConnectionError("DNS error: enotfound")).toBe(true);
  });

  it("should detect timeout errors", () => {
    expect(isLikelyConnectionError("Request timeout exceeded")).toBe(true);
    expect(isLikelyConnectionError("Connection timeout error")).toBe(true);
    expect(isLikelyConnectionError("TIMEOUT")).toBe(true);
  });

  it("should detect generic connect errors", () => {
    expect(isLikelyConnectionError("Failed to connect to database")).toBe(true);
    expect(isLikelyConnectionError("Cannot connect")).toBe(true);
  });

  it("should detect connection-related errors", () => {
    expect(isLikelyConnectionError("Connection failed")).toBe(true);
    expect(isLikelyConnectionError("Lost connection to server")).toBe(true);
    expect(isLikelyConnectionError("No active connection")).toBe(true);
  });

  it("should detect socket errors", () => {
    expect(isLikelyConnectionError("Socket hang up")).toBe(true);
    expect(isLikelyConnectionError("Socket error occurred")).toBe(true);
  });

  it("should detect terminated connection errors", () => {
    expect(isLikelyConnectionError("Connection terminated")).toBe(true);
    expect(isLikelyConnectionError("Process terminated unexpectedly")).toBe(
      true
    );
  });

  it("should be case insensitive", () => {
    expect(isLikelyConnectionError("ECONNREFUSED")).toBe(true);
    expect(isLikelyConnectionError("eConnRefused")).toBe(true);
    expect(isLikelyConnectionError("Connection TIMEOUT")).toBe(true);
  });

  it("should return false for non-connection errors", () => {
    expect(isLikelyConnectionError("Validation error")).toBe(false);
    expect(isLikelyConnectionError("Invalid query syntax")).toBe(false);
    expect(isLikelyConnectionError("Permission denied")).toBe(false);
    expect(isLikelyConnectionError("File not found")).toBe(false);
    expect(isLikelyConnectionError("")).toBe(false);
  });

  it("should detect partial matches in longer error messages", () => {
    expect(
      isLikelyConnectionError("Database query failed: ECONNREFUSED at line 45")
    ).toBe(true);
    expect(
      isLikelyConnectionError(
        "Error during operation: connection timeout after 30s"
      )
    ).toBe(true);
    expect(
      isLikelyConnectionError("Network error: socket closed unexpectedly")
    ).toBe(true);
  });

  it("should handle error messages with mixed keywords", () => {
    expect(
      isLikelyConnectionError("Failed to establish connection due to timeout")
    ).toBe(true);
    expect(
      isLikelyConnectionError("Socket connection terminated by remote host")
    ).toBe(true);
  });
});
