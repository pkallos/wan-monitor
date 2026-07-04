import { Data } from "effect";

export class DatabaseConnectionError extends Data.TaggedError(
  "DatabaseConnectionError"
)<{
  readonly message: string;
}> {}

export class DbUnavailable extends Data.TaggedError("DbUnavailable")<{
  readonly message: string;
}> {}

export class DatabaseWriteError extends Data.TaggedError("DatabaseWriteError")<{
  readonly message: string;
}> {}

export class DatabaseQueryError extends Data.TaggedError("DatabaseQueryError")<{
  readonly message: string;
}> {}
