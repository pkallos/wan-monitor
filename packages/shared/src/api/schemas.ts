import { isValidIsoTimestamp } from "@shared/timestamp";
import { Schema } from "effect";

/** An ISO 8601 timestamp with a time and a zone, such as `2024-02-10T08:00:00Z`. */
export const IsoTimestampSchema = Schema.String.check(
  Schema.makeFilter((value) => isValidIsoTimestamp(value), {
    message:
      "Expected an ISO 8601 timestamp in years 0000 to 9999, such as 2024-02-10T08:00:00Z",
  })
);

/** A query-string positive integer, such as a row `limit`. */
export const PositiveIntFromStringSchema = Schema.NumberFromString.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0, {
    message: "Expected a positive integer",
  })
);
