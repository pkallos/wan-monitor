import { Sender } from "@questdb/nodejs-client";
import { ConnectivityStatusSchema, type NetworkMetric } from "@shared/metrics";
import {
  buildCreateTableSql,
  NETWORK_METRICS_COLUMNS,
} from "@wan-monitor/shared/db-schema";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeMetricToSender } from "@/infrastructure/database/questdb/ilp";
import {
  type Migration,
  type MigrationContext,
  MigrationError,
  stickyError,
} from "@/infrastructure/database/questdb/migrations/migration";
import {
  MIGRATIONS,
  NETWORK_METRICS_SHAPE,
} from "@/infrastructure/database/questdb/migrations/registry";
import { runMigrations } from "@/infrastructure/database/questdb/migrations/runner";
import {
  MIGRATION_STATEMENT_TIMEOUT_MS,
  pgMigrationContext,
  SchemaMigrator,
} from "@/infrastructure/database/questdb/migrations/service";
import { isDuplicateColumnError } from "@/infrastructure/database/questdb/migrations/v1-create-network-metrics";
import { nullZeroSpeedtestSpeeds } from "@/infrastructure/database/questdb/migrations/v3-null-zero-speedtest-speeds";
import { pgConnectionSettings } from "@/infrastructure/database/questdb/pgwire";
import {
  createLegacyTable,
  type LegacyRow,
  type LegacyStringColumns,
} from "@/infrastructure/database/questdb/test-utils/legacy-table";
import { waitForRowCount } from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createMigratorTestLayer,
  dropTableFamily,
  isQuestDBAvailable,
  QUESTDB_HTTP_URL,
  queryQuestDB,
  TEST_TABLE,
} from "@/infrastructure/database/questdb/test-utils/setup";

const skip = !isQuestDBAvailable();

const ALL_VERSIONS = MIGRATIONS.map((migration) => migration.version);

/**
 * QuestDB's ILP writer loses the next batch for a name whose table was dropped,
 * so each test gets a name no earlier test or run has written through ILP.
 */
const RUN_ID = Date.now().toString(36);
let sequence = 0;

const familyOf = (table: string) => ({
  table,
  rebuild: `${table}__rebuild`,
  previous: `${table}__previous`,
  ledger: `${table}_migrations`,
});
let family = familyOf(`${TEST_TABLE}_mig_${RUN_ID}_0`);

const T0 = Date.parse("2024-02-10T08:00:00Z");
const CYCLE_MS = 30_000;

const migrateExit = () =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const migrator = yield* SchemaMigrator;
      yield* migrator.migrate({ canRewriteTables: true });
    }).pipe(Effect.provide(createMigratorTestLayer(family.table)))
  );

const migrate = async (): Promise<void> => {
  const exit = await migrateExit();
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
};

const migrationFailure = async (): Promise<MigrationError> => {
  const exit = await migrateExit();
  if (Exit.isSuccess(exit)) throw new Error("expected the migration to fail");
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isNone(error) || !(error.value instanceof MigrationError)) {
    throw new Error(Cause.pretty(exit.cause));
  }
  return error.value;
};

const count = async (table: string): Promise<number> =>
  Number((await queryQuestDB(`SELECT count() FROM ${table}`))[0]?.[0]);

const tableNames = async (): Promise<string[]> => {
  const wanted = [family.table, family.rebuild, family.previous, family.ledger];
  const present = (
    await queryQuestDB(
      `SELECT table_name FROM tables() WHERE table_name IN (${wanted
        .map((name) => `'${name}'`)
        .join(", ")})`
    )
  ).map((row) => String(row[0]));
  return present.sort();
};

const tableId = async (table: string): Promise<number> =>
  Number(
    (
      await queryQuestDB(
        `SELECT id FROM tables() WHERE table_name = '${table}'`
      )
    )[0]?.[0]
  );

const ledgerVersions = async (): Promise<number[]> =>
  (
    await queryQuestDB(`SELECT version FROM ${family.ledger} ORDER BY version`)
  ).map((row) => Number(row[0]));

const columnsOf = async (table: string) =>
  (
    await queryQuestDB(
      `SELECT "column", type, designated FROM table_columns('${table}')`
    )
  ).map(([name, type, designated]) => ({
    name: String(name),
    type: String(type),
    designated: designated === true,
  }));

const connectPgClient = async (): Promise<Client> => {
  const client = new Client({
    ...pgConnectionSettings({
      host: process.env.DB_HOST ?? "localhost",
      pgPort: Number(process.env.DB_PG_PORT ?? 8812),
    }),
    options: `-c statement_timeout=${MIGRATION_STATEMENT_TIMEOUT_MS}`,
  });
  await client.connect();
  return client;
};

const canonicalColumns = NETWORK_METRICS_COLUMNS.map((column) => ({
  ...column,
  designated: column.name === "timestamp",
}));

const insertCanonicalRow = async (table: string, atMs: number) => {
  await queryQuestDB(
    `INSERT INTO ${table} (timestamp, source, host, latency, connectivity_status) VALUES (cast(${atMs * 1000}L as timestamp), 'ping', '8.8.8.8', 21.5, 'up')`
  );
  await Effect.runPromise(waitForRowCount(1, "30 seconds", table));
};

/** Two hosts pinged every cycle with one cycle down, plus two speed tests. */
const legacyRows = (note?: string): LegacyRow[] => {
  const pings = Array.from({ length: 10 }, (_, cycle) =>
    ["8.8.8.8", "1.1.1.1"].map(
      (host): LegacyRow =>
        cycle === 5
          ? {
              timestampMs: T0 + cycle * CYCLE_MS,
              source: "ping",
              host,
              packetLoss: 100,
              connectivityStatus: "down",
              note,
            }
          : {
              timestampMs: T0 + cycle * CYCLE_MS,
              source: "ping",
              host,
              latency: 20 + cycle * 1.5,
              jitter: 1 + cycle * 0.25,
              packetLoss: cycle % 3 === 0 ? 10 : 0,
              connectivityStatus: cycle % 3 === 0 ? "degraded" : "up",
              note,
            }
    )
  ).flat();
  const speedtests = [0, 1].map(
    (index): LegacyRow => ({
      timestampMs: T0 + index * 3_600_000 + 1_000,
      source: "speedtest",
      connectivityStatus: "up",
      downloadBandwidth: 250_000_000 + index * 1_234_567,
      uploadBandwidth: 20_000_000 + index,
      serverLocation: "Zürich, CH",
      isp: "Example Fiber \u{1F600}",
      externalIp: "203.0.113.7",
      internalIp: "192.168.1.10",
      note,
    })
  );
  return [...pings, ...speedtests];
};

const FIELDS = `cast(timestamp as long), source, host, latency, jitter, packet_loss, connectivity_status, download_bandwidth, upload_bandwidth, server_location, isp, external_ip, internal_ip`;

const sortedRows = (rows: readonly (readonly unknown[])[]) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

const expectedRows = (rows: readonly LegacyRow[]) =>
  sortedRows(
    rows.map((row) => [
      row.timestampMs * 1000,
      row.source,
      row.host ?? null,
      row.latency ?? null,
      row.jitter ?? null,
      row.packetLoss ?? null,
      row.connectivityStatus ?? null,
      row.downloadBandwidth ?? null,
      row.uploadBandwidth ?? null,
      row.serverLocation ?? null,
      row.isp ?? null,
      row.externalIp ?? null,
      row.internalIp ?? null,
    ])
  );

const storedRows = async (table: string) =>
  sortedRows(await queryQuestDB(`SELECT ${FIELDS} FROM ${table}`));

/**
 * Speed tests as older versions stored them: a missing reading as 0. The ping
 * row's zero bandwidth is synthetic: it proves the predicate is limited to
 * speed test rows.
 */
const zeroFilledRows = (): LegacyRow[] => [
  {
    timestampMs: T0 + 1_000,
    source: "speedtest",
    connectivityStatus: "up",
    downloadBandwidth: 0,
    uploadBandwidth: 0,
    latency: 0,
    serverLocation: "Zürich, CH",
    isp: "Example Fiber",
    externalIp: "203.0.113.7",
    internalIp: "192.168.1.10",
  },
  {
    timestampMs: T0 + 3_601_000,
    source: "speedtest",
    connectivityStatus: "up",
    downloadBandwidth: 180_000_000,
    uploadBandwidth: 0,
    latency: 12.5,
  },
  {
    timestampMs: T0 + 7_201_000,
    source: "speedtest",
    connectivityStatus: "up",
    downloadBandwidth: 250_000_000,
    uploadBandwidth: 20_000_000,
    latency: 18,
    jitter: 0,
  },
  {
    timestampMs: T0 + 500,
    source: "ping",
    host: "9.9.9.9",
    latency: 0,
    packetLoss: 0,
    connectivityStatus: "up",
    downloadBandwidth: 0,
    uploadBandwidth: 0,
  },
];

const withSpeedZerosEmptied = (rows: readonly LegacyRow[]): LegacyRow[] =>
  rows.map((row) => {
    if (row.source !== "speedtest") return row;
    const { downloadBandwidth, uploadBandwidth, ...rest } = row;
    return {
      ...rest,
      ...(downloadBandwidth === 0 ? {} : { downloadBandwidth }),
      ...(uploadBandwidth === 0 ? {} : { uploadBandwidth }),
    };
  });

const toMetric = (row: LegacyRow): NetworkMetric => ({
  timestamp: new Date(row.timestampMs),
  source: row.source,
  host: row.host,
  latency: row.latency,
  jitter: row.jitter,
  packetLoss: row.packetLoss,
  connectivityStatus: Schema.is(ConnectivityStatusSchema)(
    row.connectivityStatus
  )
    ? row.connectivityStatus
    : undefined,
  downloadBandwidth: row.downloadBandwidth,
  uploadBandwidth: row.uploadBandwidth,
  serverLocation: row.serverLocation,
  isp: row.isp,
  externalIp: row.externalIp,
  internalIp: row.internalIp,
});

const writeThroughProductionWriter = async (
  table: string,
  rows: readonly LegacyRow[]
): Promise<void> => {
  const rowsBefore = await count(table);
  const sender = await Sender.fromConfig(
    `http::addr=${new URL(QUESTDB_HTTP_URL).host};`
  );
  try {
    for (const row of rows) {
      await writeMetricToSender(sender, toMetric(row), table);
    }
    await sender.flush();
  } finally {
    await sender.close();
  }
  await Effect.runPromise(
    waitForRowCount(rowsBefore + rows.length, "30 seconds", table)
  );
};

describe.skipIf(skip)(
  "SchemaMigrator against QuestDB",
  { timeout: 60_000 },
  () => {
    beforeEach(() => {
      sequence += 1;
      family = familyOf(`${TEST_TABLE}_mig_${RUN_ID}_${sequence}`);
    });

    afterEach(async () => {
      await Effect.runPromise(dropTableFamily(family.table));
    });

    it("creates exactly the declared schema on an empty database", async () => {
      await migrate();

      expect(await columnsOf(family.table)).toEqual(canonicalColumns);
      expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
      expect(await tableNames()).toEqual([family.table, family.ledger].sort());
    });

    it.each<[string, LegacyStringColumns, string]>([
      ["VARCHAR strings", "varchar", "VARCHAR"],
      ["SYMBOL strings", "symbol", "SYMBOL"],
    ])(
      "rebuilds a legacy table with nanosecond timestamps and %s, keeping every value",
      async (_name, stringColumns, legacyStringType) => {
        const rows = legacyRows();
        await Effect.runPromise(
          createLegacyTable(family.table, rows, stringColumns)
        );
        const legacy = await columnsOf(family.table);
        expect(legacy.find((c) => c.designated)?.type).toBe("TIMESTAMP_NS");
        expect(legacy.find((c) => c.name === "isp")?.type).toBe(
          legacyStringType
        );

        await migrate();

        expect(await columnsOf(family.table)).toEqual(
          expect.arrayContaining(canonicalColumns)
        );
        expect(await columnsOf(family.table)).toHaveLength(
          canonicalColumns.length
        );
        expect(await storedRows(family.table)).toEqual(expectedRows(rows));
        expect(await tableNames()).toEqual(
          [family.table, family.ledger].sort()
        );
        expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
      },
      60_000
    );

    it("refuses a legacy table with an extra column and leaves it untouched", async () => {
      await Effect.runPromise(
        createLegacyTable(family.table, legacyRows("keep me"))
      );
      const before = await queryQuestDB(`SELECT * FROM ${family.table}`);
      const id = await tableId(family.table);

      const error = await migrationFailure();

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("v2");
      expect(error.message).toContain("note");
      expect(await tableId(family.table)).toBe(id);
      expect(await queryQuestDB(`SELECT * FROM ${family.table}`)).toEqual(
        before
      );
      expect(await tableNames()).toEqual([family.table, family.ledger].sort());
      expect(await ledgerVersions()).toEqual([1]);
    });

    it("makes no change when run again on a migrated database", async () => {
      await Effect.runPromise(createLegacyTable(family.table, legacyRows()));
      await migrate();
      const id = await tableId(family.table);
      const rows = await storedRows(family.table);

      await migrate();

      expect(await tableId(family.table)).toBe(id);
      expect(await storedRows(family.table)).toEqual(rows);
      expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
    });

    it("adds missing columns without rebuilding the table, keeping what is stored", async () => {
      const dropped = [
        "isp",
        "external_ip",
        "internal_ip",
        "download_bandwidth",
      ];
      await queryQuestDB(
        buildCreateTableSql(
          family.table,
          NETWORK_METRICS_COLUMNS.filter(
            (column) => !dropped.includes(column.name)
          )
        )
      );
      await queryQuestDB(
        `INSERT INTO ${family.table} (timestamp, source, host, latency, jitter, packet_loss, connectivity_status, upload_bandwidth, server_location) VALUES
        (cast(${T0 * 1000}L as timestamp), 'ping', '8.8.8.8', 21.5, 1.25, 10.0, 'degraded', NULL, NULL),
        (cast(${(T0 + CYCLE_MS) * 1000}L as timestamp), 'ping', '1.1.1.1', 19.0, 0.5, 0.0, 'up', NULL, NULL),
        (cast(${(T0 + 60_000) * 1000}L as timestamp), 'speedtest', NULL, NULL, NULL, NULL, 'up', 20000001, 'Oslo, NO')`
      );
      await Effect.runPromise(waitForRowCount(3, "30 seconds", family.table));
      const id = await tableId(family.table);

      await migrate();

      expect(await columnsOf(family.table)).toEqual(
        expect.arrayContaining(canonicalColumns)
      );
      expect(await tableId(family.table)).toBe(id);
      expect(await storedRows(family.table)).toEqual(
        sortedRows([
          [
            T0 * 1000,
            "ping",
            "8.8.8.8",
            21.5,
            1.25,
            10,
            "degraded",
            null,
            null,
            null,
            null,
            null,
            null,
          ],
          [
            (T0 + CYCLE_MS) * 1000,
            "ping",
            "1.1.1.1",
            19,
            0.5,
            0,
            "up",
            null,
            null,
            null,
            null,
            null,
            null,
          ],
          [
            (T0 + 60_000) * 1000,
            "speedtest",
            null,
            null,
            null,
            null,
            "up",
            null,
            20000001,
            "Oslo, NO",
            null,
            null,
            null,
          ],
        ])
      );
      expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
    });

    it("replaces a stale copy left by an interrupted rebuild", async () => {
      const rows = legacyRows();
      await Effect.runPromise(createLegacyTable(family.table, rows));
      await queryQuestDB(buildCreateTableSql(family.rebuild));
      await insertCanonicalRow(family.rebuild, T0 - 1_000_000);

      await migrate();

      expect(await storedRows(family.table)).toEqual(expectedRows(rows));
      expect(await tableNames()).toEqual([family.table, family.ledger].sort());
    });

    describe("recovery from an interrupted rebuild", () => {
      const seedCanonical = async (table: string, rows: number) => {
        await queryQuestDB(buildCreateTableSql(table));
        await queryQuestDB(
          `INSERT INTO ${table} (timestamp, source, host, latency, connectivity_status)
         SELECT cast(${T0 * 1000}L + (x - 1) * ${CYCLE_MS * 1000}L as timestamp), 'ping', '8.8.8.8', 20.0 + x, 'up'
         FROM long_sequence(${rows})`
        );
        await Effect.runPromise(waitForRowCount(rows, "30 seconds", table));
      };

      it("drops a stale copy and keeps the original", async () => {
        await seedCanonical(family.table, 5);
        await seedCanonical(family.rebuild, 3);

        await migrate();

        expect(await count(family.table)).toBe(5);
        expect(await tableNames()).toEqual(
          [family.table, family.ledger].sort()
        );
      });

      it("finishes a swap interrupted between the renames", async () => {
        await seedCanonical(family.previous, 5);
        await seedCanonical(family.rebuild, 5);

        await migrate();

        expect(await count(family.table)).toBe(5);
        expect(await tableNames()).toEqual(
          [family.table, family.ledger].sort()
        );
      });

      it("drops the original once the swapped-in table matches it", async () => {
        await seedCanonical(family.table, 5);
        await seedCanonical(family.previous, 5);

        await migrate();

        expect(await count(family.table)).toBe(5);
        expect(await tableNames()).toEqual(
          [family.table, family.ledger].sort()
        );
      });

      it("keeps both tables when the swapped-in table does not match the original", async () => {
        await seedCanonical(family.table, 4);
        await seedCanonical(family.previous, 5);

        const error = await migrationFailure();

        expect(error.kind).toBe("terminal");
        expect(await count(family.table)).toBe(4);
        expect(await count(family.previous)).toBe(5);
      });

      it("restores a lone original and rebuilds it", async () => {
        const rows = legacyRows();
        await Effect.runPromise(createLegacyTable(family.previous, rows));

        await migrate();

        expect(await storedRows(family.table)).toEqual(expectedRows(rows));
        expect(await columnsOf(family.table)).toHaveLength(
          canonicalColumns.length
        );
        expect(await tableNames()).toEqual(
          [family.table, family.ledger].sort()
        );
      });

      it("refuses a renamed-in copy that differs from the original and drops nothing", async () => {
        await seedCanonical(family.previous, 5);
        await seedCanonical(family.rebuild, 4);

        const error = await migrationFailure();

        expect(error.kind).toBe("terminal");
        expect(await count(family.table)).toBe(4);
        expect(await count(family.previous)).toBe(5);
      });

      it("refuses a copy that has no original", async () => {
        await seedCanonical(family.rebuild, 3);

        const error = await migrationFailure();

        expect(error.kind).toBe("terminal");
        expect(await tableNames()).toEqual(
          [family.ledger, family.rebuild].sort()
        );
      });

      it("refuses when the table, its copy and its original all exist", async () => {
        await seedCanonical(family.table, 3);
        await seedCanonical(family.rebuild, 3);
        await seedCanonical(family.previous, 3);

        const error = await migrationFailure();

        expect(error.kind).toBe("terminal");
        expect(await tableNames()).toEqual(
          [family.ledger, family.table, family.previous, family.rebuild].sort()
        );
      });
    });

    describe("verification of the copy", () => {
      const columnList = NETWORK_METRICS_COLUMNS.map(
        (column) => column.name
      ).join(", ");
      const selectCasts = (shiftMicros = 0) =>
        NETWORK_METRICS_COLUMNS.map((column) =>
          column.name === "timestamp" && shiftMicros !== 0
            ? `dateadd('u', ${shiftMicros}, cast(timestamp as TIMESTAMP))`
            : `cast(${column.name} as ${column.type})`
        ).join(", ");
      /** Cycle 2 of host 1.1.1.1, as the nanosecond legacy table stores it. */
      const inLegacy = `cast(timestamp as long) = ${(T0 + 2 * CYCLE_MS) * 1_000_000}L AND host = '1.1.1.1'`;
      /** The same row in the rebuilt table. */
      const inCopy = `timestamp = cast(${(T0 + 2 * CYCLE_MS) * 1000}L as timestamp) AND host = '1.1.1.1'`;
      const aSpeedtest = `source = 'speedtest' AND download_bandwidth = 250000000`;

      /** Both hosts' rows of cycle 2: moving them together leaves the distinct timestamps unchanged. */
      const inLegacyCycle = `cast(timestamp as long) = ${(T0 + 2 * CYCLE_MS) * 1_000_000}L`;

      /** Replaces the copy's rows with the legacy rows, minus those matching `where` and optionally plus them shifted in time. */
      const reloadCopy = async (
        client: Client,
        where: string,
        shiftMicros?: number
      ) => {
        await client.query(
          `ALTER TABLE ${family.rebuild} DROP PARTITION LIST '2024-02-10'`
        );
        await client.query(
          `INSERT INTO ${family.rebuild} (${columnList}) SELECT ${selectCasts()} FROM ${family.table} WHERE NOT (${where})`
        );
        if (shiftMicros !== undefined) {
          await client.query(
            `INSERT INTO ${family.rebuild} (${columnList}) SELECT ${selectCasts(shiftMicros)} FROM ${family.table} WHERE ${where}`
          );
        }
      };

      const corruptions: [string, (client: Client) => Promise<void>][] = [
        ["a row is missing", (client) => reloadCopy(client, inLegacy)],
        [
          "a text value is NULL",
          async (client) => {
            await client.query(
              `UPDATE ${family.rebuild} SET isp = NULL WHERE ${aSpeedtest}`
            );
          },
        ],
        [
          "a text value has a different length",
          async (client) => {
            await client.query(
              `UPDATE ${family.rebuild} SET external_ip = '203.0.113.77' WHERE ${aSpeedtest}`
            );
          },
        ],
        [
          "a DOUBLE value is off by one",
          async (client) => {
            await client.query(
              `UPDATE ${family.rebuild} SET latency = latency + 1 WHERE ${inCopy}`
            );
          },
        ],
        [
          "a LONG value is off by one",
          async (client) => {
            await client.query(
              `UPDATE ${family.rebuild} SET upload_bandwidth = upload_bandwidth + 1 WHERE ${aSpeedtest}`
            );
          },
        ],
        [
          "a row moved to another host",
          async (client) => {
            await client.query(
              `UPDATE ${family.rebuild} SET host = '8.8.8.8' WHERE ${inCopy}`
            );
          },
        ],
        [
          "a cycle's timestamps are a microsecond late",
          (client) => reloadCopy(client, inLegacyCycle, 1),
        ],
      ];

      it.each(corruptions)(
        "refuses a copy where %s and leaves the original in place",
        async (_name, corrupt) => {
          await Effect.runPromise(
            createLegacyTable(family.table, legacyRows())
          );
          const before = await storedRows(family.table);
          const id = await tableId(family.table);
          const client = await connectPgClient();

          try {
            const live = pgMigrationContext(client, family.table, true);
            const corrupting: MigrationContext = {
              ...live,
              query: (sql, params) =>
                live.query(sql, params).pipe(
                  Effect.tap(() =>
                    sql.startsWith(`INSERT INTO ${family.rebuild}`)
                      ? Effect.tryPromise({
                          try: () => corrupt(client),
                          catch: (error) =>
                            new MigrationError({
                              step: "corrupt",
                              kind: "transient",
                              message: `corrupting the copy failed: ${error}`,
                            }),
                        })
                      : Effect.void
                  )
                ),
            };

            const error = await Effect.runPromise(
              Effect.flip(
                runMigrations(corrupting, {
                  migrations: MIGRATIONS,
                  target: NETWORK_METRICS_SHAPE,
                })
              )
            );

            expect(error.kind).toBe("terminal");
            expect(error.message).toContain(`${family.table} is unchanged`);
          } finally {
            await client.end();
          }

          expect(await tableId(family.table)).toBe(id);
          expect(await storedRows(family.table)).toEqual(before);
          expect(await tableNames()).toEqual(
            [family.table, family.ledger].sort()
          );
        }
      );
    });

    describe("v3: speed tests stored as 0", () => {
      const withClient = async <T>(
        use: (client: Client) => Promise<T>
      ): Promise<T> => {
        const client = await connectPgClient();
        try {
          return await use(client);
        } finally {
          await client.end();
        }
      };

      const runV3 = (client: Client, canRewriteTables = true) =>
        Effect.runPromise(
          nullZeroSpeedtestSpeeds.up(
            pgMigrationContext(client, family.table, canRewriteTables)
          )
        );

      it("empties them on a rebuilt legacy table and changes nothing else", async () => {
        const rows = [...legacyRows(), ...zeroFilledRows()];
        await Effect.runPromise(createLegacyTable(family.table, rows));

        await migrate();

        expect(await storedRows(family.table)).toEqual(
          expectedRows(withSpeedZerosEmptied(rows))
        );
        expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
        expect(await tableNames()).toEqual(
          [family.table, family.ledger].sort()
        );
      });

      it("empties them in place on a table written through the production writer", async () => {
        const rows = [...legacyRows(), ...zeroFilledRows()];
        await withClient((client) =>
          Effect.runPromise(
            runMigrations(pgMigrationContext(client, family.table, true), {
              migrations: MIGRATIONS.slice(0, 2),
              target: NETWORK_METRICS_SHAPE,
            })
          )
        );
        await writeThroughProductionWriter(family.table, rows);
        const id = await tableId(family.table);
        expect(await ledgerVersions()).toEqual([1, 2]);

        await migrate();

        expect(await tableId(family.table)).toBe(id);
        expect(await storedRows(family.table)).toEqual(
          expectedRows(withSpeedZerosEmptied(rows))
        );
        expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
      });

      it("finishes a run that stopped between the two columns, and needs no rewrite permission", async () => {
        const rows = zeroFilledRows();
        await withClient((client) =>
          Effect.runPromise(
            runMigrations(pgMigrationContext(client, family.table, true), {
              migrations: MIGRATIONS.slice(0, 2),
              target: NETWORK_METRICS_SHAPE,
            })
          )
        );
        await writeThroughProductionWriter(family.table, rows);
        await queryQuestDB(
          `UPDATE ${family.table} SET download_bandwidth = NULL WHERE source = 'speedtest' AND download_bandwidth = 0`
        );
        const id = await tableId(family.table);

        await withClient((client) => runV3(client, false));

        expect(await tableId(family.table)).toBe(id);
        expect(await storedRows(family.table)).toEqual(
          expectedRows(withSpeedZerosEmptied(rows))
        );
      });

      it("does nothing when no zero is stored", async () => {
        await Effect.runPromise(
          createLegacyTable(family.table, zeroFilledRows())
        );
        await migrate();
        const id = await tableId(family.table);
        const rows = await storedRows(family.table);
        const txn = await queryQuestDB(
          `SELECT sequencerTxn FROM wal_tables() WHERE name = '${family.table}'`
        );

        await withClient((client) => runV3(client));

        expect(await tableId(family.table)).toBe(id);
        expect(await storedRows(family.table)).toEqual(rows);
        expect(
          await queryQuestDB(
            `SELECT sequencerTxn FROM wal_tables() WHERE name = '${family.table}'`
          )
        ).toEqual(txn);
      });

      it("accepts a column whose every stored value was a zero, so its sum becomes NULL", async () => {
        const rows = legacyRows().map((row) =>
          row.source === "speedtest" ? { ...row, uploadBandwidth: 0 } : row
        );
        await Effect.runPromise(createLegacyTable(family.table, rows));

        await migrate();

        expect(await storedRows(family.table)).toEqual(
          expectedRows(withSpeedZerosEmptied(rows))
        );
        expect(
          await queryQuestDB(
            `SELECT count(upload_bandwidth), sum(upload_bandwidth) FROM ${family.table}`
          )
        ).toEqual([[0, null]]);
        expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
      });

      describe("when the update changed anything else", () => {
        const damageAfterUpdate = (client: Client): MigrationContext => {
          const live = pgMigrationContext(client, family.table, true);
          return {
            ...live,
            query: (sql, params) =>
              live
                .query(sql, params)
                .pipe(
                  Effect.tap(() =>
                    sql.startsWith(
                      `UPDATE ${family.table} SET upload_bandwidth`
                    )
                      ? live.query(
                          `UPDATE ${family.table} SET isp = 'changed' WHERE source = 'speedtest'`
                        )
                      : Effect.void
                  )
                ),
          };
        };

        const damagedRun = async () => {
          await Effect.runPromise(
            createLegacyTable(family.table, zeroFilledRows())
          );
          return withClient((client) =>
            Effect.runPromise(
              Effect.flip(
                runMigrations(damageAfterUpdate(client), {
                  migrations: MIGRATIONS,
                  target: NETWORK_METRICS_SHAPE,
                })
              )
            )
          );
        };

        it("refuses, pointing at the snapshot, and records the failure instead of the version", async () => {
          const error = await damagedRun();

          expect(error.kind).toBe("terminal");
          expect(error.message).toContain("len_isp");
          expect(error.message).toContain("snapshot");
          expect(await ledgerVersions()).toEqual([-3, 1, 2]);
        });

        it("keeps refusing on every later start, and stops once the ledger is dropped", async () => {
          await damagedRun();

          for (let start = 0; start < 2; start += 1) {
            const error = await migrationFailure();

            expect(error.kind).toBe("terminal");
            expect(error.message).toContain("earlier start");
            expect(error.message).toContain("len_isp");
          }
          expect(await ledgerVersions()).toEqual([-3, 1, 2]);

          await queryQuestDB(`DROP TABLE ${family.ledger}`);
          await migrate();

          expect(await ledgerVersions()).toEqual(ALL_VERSIONS);
        });
      });

      it("stores a failure message that holds quotes and reads it back", async () => {
        const quoted = `it's "damaged"`;
        const damaging: Migration = {
          version: 3,
          name: "damaging",
          up: () => Effect.fail(stickyError("verify", quoted)),
        };

        await withClient(async (client) => {
          const ctx = pgMigrationContext(client, family.table, true);
          const plan = {
            migrations: [...MIGRATIONS.slice(0, 2), damaging],
            target: NETWORK_METRICS_SHAPE,
          };
          await Effect.runPromise(Effect.flip(runMigrations(ctx, plan)));

          const error = await Effect.runPromise(
            Effect.flip(runMigrations(ctx, plan))
          );

          expect(error.message).toContain(quoted);
        });
      });
    });

    it("refuses a table that ILP recreated with the wrong types after the ledger was written", async () => {
      await migrate();
      await queryQuestDB(`DROP TABLE ${family.table}`);
      await Effect.runPromise(createLegacyTable(family.table, legacyRows()));

      const error = await migrationFailure();

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("TIMESTAMP_NS");
      expect(error.message).toContain(family.ledger);
    });
  }
);

describe.skipIf(skip)("QuestDB's duplicate-column error", () => {
  let client: Client;

  beforeEach(async () => {
    sequence += 1;
    family = familyOf(`${TEST_TABLE}_mig_${RUN_ID}_${sequence}`);
    client = await connectPgClient();
  });

  afterEach(async () => {
    await client.end();
    await Effect.runPromise(dropTableFamily(family.table));
  });

  it("is recognized, so the race hardening actually fires", async () => {
    await client.query(buildCreateTableSql(family.table));

    const error = await Effect.runPromise(
      Effect.flip(
        pgMigrationContext(client, family.table, true).query(
          `ALTER TABLE ${family.table} ADD COLUMN isp STRING`
        )
      )
    );

    expect(isDuplicateColumnError(error.message)).toBe(true);
  });
});
