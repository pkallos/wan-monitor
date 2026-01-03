export class DatabaseConnectionError {
  readonly _tag = "DatabaseConnectionError";
  constructor(readonly message: string) {}
}

export class DbUnavailable {
  readonly _tag = "DbUnavailable";
  constructor(readonly message: string) {}
}

export class DatabaseWriteError {
  readonly _tag = "DatabaseWriteError";
  constructor(readonly message: string) {}
}

export class DatabaseQueryError {
  readonly _tag = "DatabaseQueryError";
  constructor(readonly message: string) {}
}
