import { describe, expect, it } from "vitest";
import {
  ApiError,
  AUTH_NOT_CONFIGURED,
  INVALID_CREDENTIALS,
  isDbUnavailableError,
  MISSING_CREDENTIALS,
  toApiError,
} from "@/api/errors";

describe("errors", () => {
  describe("isDbUnavailableError", () => {
    it("detects the ApiError form (503 + DB_UNAVAILABLE details)", () => {
      const error = new ApiError("boom", 503, { error: "DB_UNAVAILABLE" });
      expect(isDbUnavailableError(error)).toBe(true);
    });

    it("detects the decoded payload form", () => {
      const payload = {
        error: "DB_UNAVAILABLE",
        message: "Database temporarily unavailable",
        timestamp: new Date().toISOString(),
      };
      expect(isDbUnavailableError(payload)).toBe(true);
    });

    it("is false for non-503 ApiErrors and unrelated values", () => {
      expect(isDbUnavailableError(new ApiError("nope", 500, {}))).toBe(false);
      expect(
        isDbUnavailableError(new ApiError("nope", 503, { error: "OTHER" }))
      ).toBe(false);
      expect(isDbUnavailableError("boom")).toBe(false);
      expect(isDbUnavailableError(null)).toBe(false);
    });
  });

  describe("toApiError", () => {
    it("wraps the decoded DB-unavailable payload in a 503 ApiError", () => {
      const payload = {
        error: "DB_UNAVAILABLE",
        message: "Database temporarily unavailable",
        timestamp: new Date().toISOString(),
      };
      const result = toApiError(payload);
      expect(result).toBeInstanceOf(ApiError);
      expect((result as ApiError).status).toBe(503);
      expect((result as ApiError).details).toBe(payload);
      expect(isDbUnavailableError(result)).toBe(true);
    });

    it("returns existing ApiError instances unchanged", () => {
      const original = new ApiError("x", 401, {});
      expect(toApiError(original)).toBe(original);
    });

    it("passes non-DB errors through unchanged", () => {
      const original = new Error("network");
      expect(toApiError(original)).toBe(original);
      expect(toApiError("plain")).toBe("plain");
    });

    it("wraps MissingCredentials decoded error in a 400 ApiError", () => {
      const decoded = { _tag: MISSING_CREDENTIALS, message: "fields required" };
      const result = toApiError(decoded) as ApiError;
      expect(result).toBeInstanceOf(ApiError);
      expect(result.status).toBe(400);
      expect(result.message).toBe("fields required");
    });

    it("wraps InvalidCredentials decoded error in a 401 ApiError", () => {
      const decoded = {
        _tag: INVALID_CREDENTIALS,
        message: "wrong password",
      };
      const result = toApiError(decoded) as ApiError;
      expect(result).toBeInstanceOf(ApiError);
      expect(result.status).toBe(401);
    });

    it("wraps AuthNotConfigured decoded error in a 503 ApiError", () => {
      const decoded = {
        _tag: AUTH_NOT_CONFIGURED,
        message: "not configured",
      };
      const result = toApiError(decoded) as ApiError;
      expect(result).toBeInstanceOf(ApiError);
      expect(result.status).toBe(503);
    });
  });
});
