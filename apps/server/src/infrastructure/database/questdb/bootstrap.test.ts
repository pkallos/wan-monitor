import {
  buildAddColumnSql,
  buildCreateTableSql,
  missingColumns,
  NETWORK_METRICS_COLUMNS,
  NETWORK_METRICS_TABLE,
} from "@wan-monitor/shared/db-schema";
import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapSchema } from "@/infrastructure/database/questdb/bootstrap";

/**
 * Minimal pg client stub: dispatches on the SQL text so a single mock can serve
 * CREATE TABLE, the table_columns introspection query, and ALTER statements.
 * `existingColumns` controls what the introspection query reports.
 */
const createMockPgClient = (
  existingColumns: readonly string[],
  options: { readonly alterError?: string } = {}
) => {
  const query = vi.fn((text: string) => {
    if (text.includes("table_columns")) {
      return Promise.resolve({
        rows: existingColumns.map((name) => ({ name })),
      });
    }
    if (options.alterError !== undefined && text.includes("ADD COLUMN")) {
      return Promise.reject(new Error(options.alterError));
    }
    return Promise.resolve({ rows: [] });
  });
  // Only `query` is exercised by bootstrapSchema.
  return { client: { query } as never, query };
};

const allColumnNames = NETWORK_METRICS_COLUMNS.map((column) => column.name);

describe("db-schema canonical builders", () => {
  describe("buildCreateTableSql", () => {
    const sql = buildCreateTableSql();

    it("creates the table idempotently with WAL + daily partitioning", () => {
      expect(sql).toContain(
        `CREATE TABLE IF NOT EXISTS ${NETWORK_METRICS_TABLE}`
      );
      expect(sql).toContain("TIMESTAMP(timestamp)");
      expect(sql).toContain("PARTITION BY DAY WAL");
    });

    it("declares every canonical column with its type", () => {
      for (const column of NETWORK_METRICS_COLUMNS) {
        expect(sql).toContain(`${column.name} ${column.type}`);
      }
    });

    it("includes the speedtest columns that ILP schema-on-write lazily created", () => {
      // These columns caused missing-column HTTP 500s before bootstrap existed.
      expect(allColumnNames).toContain("download_bandwidth");
      expect(allColumnNames).toContain("upload_bandwidth");
      expect(allColumnNames).toContain("server_location");
      expect(allColumnNames).toContain("isp");
    });
  });

  describe("buildAddColumnSql", () => {
    it("builds a non-destructive ALTER ADD COLUMN statement", () => {
      expect(buildAddColumnSql({ name: "isp", type: "STRING" })).toBe(
        `ALTER TABLE ${NETWORK_METRICS_TABLE} ADD COLUMN isp STRING;`
      );
    });
  });

  describe("missingColumns", () => {
    it("returns nothing when all canonical columns exist", () => {
      expect(missingColumns(allColumnNames)).toEqual([]);
    });

    it("returns only the canonical columns that are absent, in canonical order", () => {
      const existing = allColumnNames.filter(
        (name) => name !== "isp" && name !== "latency"
      );
      const missing = missingColumns(existing).map((column) => column.name);
      expect(missing).toEqual(["latency", "isp"]);
    });
  });
});

describe("bootstrapSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the table before introspecting columns", async () => {
    const { client, query } = createMockPgClient(allColumnNames);

    await Effect.runPromise(bootstrapSchema(client));

    const createCallIndex = query.mock.calls.findIndex(([sql]) =>
      (sql as string).includes("CREATE TABLE IF NOT EXISTS")
    );
    const introspectCallIndex = query.mock.calls.findIndex(([sql]) =>
      (sql as string).includes("table_columns")
    );
    expect(createCallIndex).toBeGreaterThanOrEqual(0);
    expect(introspectCallIndex).toBeGreaterThan(createCallIndex);
  });

  it("adds no columns when the existing table already matches the canonical schema", async () => {
    const { client, query } = createMockPgClient(allColumnNames);

    await Effect.runPromise(bootstrapSchema(client));

    const alterCalls = query.mock.calls.filter(([sql]) =>
      (sql as string).includes("ADD COLUMN")
    );
    expect(alterCalls).toHaveLength(0);
  });

  it("adds exactly the missing columns on a partially-migrated table", async () => {
    const existing = allColumnNames.filter(
      (name) => name !== "external_ip" && name !== "internal_ip"
    );
    const { client, query } = createMockPgClient(existing);

    await Effect.runPromise(bootstrapSchema(client));

    const altered = query.mock.calls
      .map(([sql]) => sql as string)
      .filter((sql) => sql.includes("ADD COLUMN"));
    expect(altered).toHaveLength(2);
    expect(altered.some((sql) => sql.includes("external_ip STRING"))).toBe(
      true
    );
    expect(altered.some((sql) => sql.includes("internal_ip STRING"))).toBe(
      true
    );
  });

  it("fails with DatabaseConnectionError when table creation fails", async () => {
    const query = vi.fn(() => Promise.reject(new Error("boom")));
    const client = { query } as never;

    const exit = await Effect.runPromiseExit(bootstrapSchema(client));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause;
      expect(String(error)).toContain("DatabaseConnectionError");
    }
  });

  it("treats a concurrent duplicate-column error as success (race hardening)", async () => {
    // introspection reports `isp` missing, but a concurrent ILP write creates
    // it before our ALTER lands, so QuestDB rejects the ADD COLUMN.
    const existing = allColumnNames.filter((name) => name !== "isp");
    const { client } = createMockPgClient(existing, {
      alterError: "column already exists [name=isp]",
    });

    const exit = await Effect.runPromiseExit(bootstrapSchema(client));

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("treats a 'Duplicate column' error variant as success", async () => {
    const existing = allColumnNames.filter((name) => name !== "isp");
    const { client } = createMockPgClient(existing, {
      alterError: "Duplicate column [name=isp]",
    });

    const exit = await Effect.runPromiseExit(bootstrapSchema(client));

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("still fails when an ALTER raises a non-duplicate (real) error", async () => {
    const existing = allColumnNames.filter((name) => name !== "isp");
    const { client } = createMockPgClient(existing, {
      alterError: "table lock timeout",
    });

    const exit = await Effect.runPromiseExit(bootstrapSchema(client));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
