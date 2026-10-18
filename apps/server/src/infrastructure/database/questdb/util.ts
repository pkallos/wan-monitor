import { DatabaseError } from "pg";
import type { AppConfig } from "@/infrastructure/config/config";
import {
  DatabaseQueryError,
  DatabaseUnavailable,
  DatabaseWriteError,
} from "@/infrastructure/database/questdb/errors";

const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : undefined;

export const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message || errorCode(error) || String(error)
    : String(error);

/**
 * Whether the database is unreachable. A server error, slow query or pool
 * saturation is not; treating one as a disconnect tears the pool down.
 */
export const isConnectionError = (error: unknown): boolean => {
  if (error instanceof DatabaseError) {
    return false;
  }
  const code = errorCode(error);
  if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }
  // pg raises these without a code or a dedicated class.
  return (
    error instanceof Error && error.message.startsWith("Connection terminated")
  );
};

export const classifyQueryError =
  (label: string) =>
  (error: unknown): DatabaseUnavailable | DatabaseQueryError => {
    const message = errorMessage(error);
    return isConnectionError(error)
      ? new DatabaseUnavailable({ message })
      : new DatabaseQueryError({
          message: `Failed to query ${label}: ${message}`,
        });
  };

export const classifyWriteError =
  (action: string, protocol: AppConfig["database"]["protocol"]) =>
  (error: unknown): DatabaseUnavailable | DatabaseWriteError => {
    const message = errorMessage(error);
    // QuestDB closes a TCP ILP connection on any server-side error, and the
    // sender then rejects every write with a code-less "not connected" error.
    return protocol === "tcp" || isConnectionError(error)
      ? new DatabaseUnavailable({ message })
      : new DatabaseWriteError({ message: `Failed to ${action}: ${message}` });
  };
