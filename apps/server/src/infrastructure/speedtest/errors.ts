/**
 * Speed test error types
 *
 * These are extracted to a separate file to avoid loading the speedtest-net
 * native module dependencies when only type checking is needed.
 */

export class SpeedTestExecutionError {
  readonly _tag = "SpeedTestExecutionError";
  constructor(readonly message: string) {}
}

export class SpeedTestTimeoutError {
  readonly _tag = "SpeedTestTimeoutError";
  constructor(readonly timeoutMs: number) {}
}

export type SpeedTestError = SpeedTestExecutionError | SpeedTestTimeoutError;
