import { Data, type Effect } from "effect";

/** A `terminal` error needs an operator; retrying cannot fix it. */
export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly step: string;
  readonly message: string;
  readonly kind: "transient" | "terminal";
}> {}

export const terminalError = (step: string, message: string): MigrationError =>
  new MigrationError({ step, message, kind: "terminal" });

export const transientError = (step: string, message: string): MigrationError =>
  new MigrationError({ step, message, kind: "transient" });

export type MigrationRow = Readonly<Record<string, unknown>>;

export interface MigrationContext {
  readonly table: string;
  /**
   * False once this process has opened an ILP connection, which would keep
   * writing to a renamed table that QuestDB then drops along with the writes.
   */
  readonly canRewriteTables: boolean;
  readonly query: (
    sql: string,
    params?: readonly unknown[]
  ) => Effect.Effect<readonly MigrationRow[], MigrationError>;
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Must be safe to run again after a partial or repeated run. */
  readonly up: (ctx: MigrationContext) => Effect.Effect<void, MigrationError>;
}
