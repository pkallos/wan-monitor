/**
 * Speed test error types
 *
 * These are extracted to a separate file to avoid loading the speedtest-net
 * native module dependencies when only type checking is needed.
 */

import { Data } from "effect";

export class SpeedTestExecutionError extends Data.TaggedError(
  "SpeedTestExecutionError"
)<{
  readonly message: string;
}> {}

export class SpeedTestTimeoutError extends Data.TaggedError(
  "SpeedTestTimeoutError"
)<{
  readonly timeoutMs: number;
}> {
  override get message(): string {
    return `Timeout after ${this.timeoutMs}ms`;
  }
}

export type SpeedTestError = SpeedTestExecutionError | SpeedTestTimeoutError;
