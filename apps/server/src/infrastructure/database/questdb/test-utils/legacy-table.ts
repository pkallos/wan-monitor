import { Sender } from "@questdb/nodejs-client";
import { Data, Effect } from "effect";
import { waitForRowCount } from "@/infrastructure/database/questdb/test-utils/seed";
import { QUESTDB_HTTP_URL } from "@/infrastructure/database/questdb/test-utils/setup";

class LegacyTableError extends Data.TaggedError("LegacyTableError")<{
  readonly message: string;
}> {}

export interface LegacyRow {
  readonly timestampMs: number;
  readonly source: "ping" | "speedtest";
  readonly host?: string;
  readonly latency?: number;
  readonly jitter?: number;
  readonly packetLoss?: number;
  readonly connectivityStatus?: string;
  readonly downloadBandwidth?: number;
  readonly uploadBandwidth?: number;
  readonly serverLocation?: string;
  readonly isp?: string;
  readonly externalIp?: string;
  readonly internalIp?: string;
  /** A string column the schema does not declare. */
  readonly note?: string;
}

/** `varchar` is what ILP schema-on-write creates for strings; older writers sent `symbol`. */
export type LegacyStringColumns = "varchar" | "symbol";

const writeRow = (
  sender: Sender,
  table: string,
  row: LegacyRow,
  stringColumns: LegacyStringColumns
): void => {
  const strings: readonly (readonly [string, string | undefined])[] = [
    ["connectivity_status", row.connectivityStatus],
    ["server_location", row.serverLocation],
    ["isp", row.isp],
    ["external_ip", row.externalIp],
    ["internal_ip", row.internalIp],
  ];

  let line = sender.table(table).symbol("source", row.source);
  if (row.host !== undefined) line = line.symbol("host", row.host);
  if (stringColumns === "symbol") {
    for (const [name, value] of strings) {
      if (value !== undefined) line = line.symbol(name, value);
    }
  }
  if (row.latency !== undefined)
    line = line.floatColumn("latency", row.latency);
  if (row.jitter !== undefined) line = line.floatColumn("jitter", row.jitter);
  if (row.packetLoss !== undefined) {
    line = line.floatColumn("packet_loss", row.packetLoss);
  }
  if (row.downloadBandwidth !== undefined) {
    line = line.intColumn("download_bandwidth", row.downloadBandwidth);
  }
  if (row.uploadBandwidth !== undefined) {
    line = line.intColumn("upload_bandwidth", row.uploadBandwidth);
  }
  if (stringColumns === "varchar") {
    for (const [name, value] of strings) {
      if (value !== undefined) line = line.stringColumn(name, value);
    }
  }
  if (row.note !== undefined) line = line.stringColumn("note", row.note);
  line.at(BigInt(row.timestampMs) * 1_000_000n, "ns");
};

/**
 * Create `table` by writing through the ILP client, so QuestDB picks a
 * nanosecond designated timestamp and the column types itself. The table must not exist.
 */
export const createLegacyTable = (
  table: string,
  rows: readonly LegacyRow[],
  stringColumns: LegacyStringColumns = "varchar"
): Effect.Effect<void, LegacyTableError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const sender = await Sender.fromConfig(
          `http::addr=${new URL(QUESTDB_HTTP_URL).host};`
        );
        try {
          for (const row of rows) writeRow(sender, table, row, stringColumns);
          await sender.flush();
        } finally {
          await sender.close();
        }
      },
      catch: (error) =>
        new LegacyTableError({
          message: `Failed to write legacy rows to ${table}: ${error}`,
        }),
    });
    yield* waitForRowCount(rows.length, "30 seconds", table).pipe(
      Effect.mapError(
        (error) => new LegacyTableError({ message: error.message })
      )
    );
  });
