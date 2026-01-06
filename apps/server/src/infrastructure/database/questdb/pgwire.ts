import { types } from "pg";

export const configurePgTypeParsers = (): void => {
  types.setTypeParser(types.builtins.TIMESTAMP, (val: string) =>
    val ? `${val.replace(" ", "T")}Z` : val
  );
  types.setTypeParser(types.builtins.TIMESTAMPTZ, (val: string) =>
    val ? `${val.replace(" ", "T")}Z` : val
  );
};
