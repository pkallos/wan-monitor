import { types } from "pg";

export const configurePgTypeParsers = (): void => {
  types.setTypeParser(types.builtins.TIMESTAMP, (val: string) =>
    val ? `${val.replace(" ", "T")}Z` : val
  );
  types.setTypeParser(types.builtins.TIMESTAMPTZ, (val: string) =>
    val ? `${val.replace(" ", "T")}Z` : val
  );
};

/** The host, credentials and database every pgwire connection to QuestDB shares. */
export const pgConnectionSettings = (database: {
  readonly host: string;
  readonly pgPort: number;
}) => ({
  host: database.host,
  port: database.pgPort,
  database: "qdb",
  user: "admin",
  password: "quest",
});
