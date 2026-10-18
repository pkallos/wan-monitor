import { Pool, type PoolConfig } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { queryPoolConfig } from "@/infrastructure/database/questdb/connection";
import { pgConnectionSettings } from "@/infrastructure/database/questdb/pgwire";
import { isQuestDBAvailable } from "@/infrastructure/database/questdb/test-utils/setup";

const skip = !isQuestDBAvailable();

const database = (queryTimeout: number) => ({
  host: process.env.DB_HOST ?? "localhost",
  pgPort: Number(process.env.DB_PG_PORT ?? 8812),
  queryTimeout,
});

const SLOW_QUERY_MARKER = "long_sequence(4000000000)";
const slowQuery = `SELECT sum(rnd_double()) FROM ${SLOW_QUERY_MARKER}`;

const runningSlowQueries = async (pool: Pool): Promise<number> => {
  const { rows } = await pool.query(
    `SELECT count() AS n FROM query_activity() WHERE query LIKE '%${SLOW_QUERY_MARKER}%' AND query NOT LIKE '%query_activity%'`
  );
  return Number(rows[0].n);
};

const settle = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(skip)("pg pool timeouts against QuestDB", () => {
  const pools: Pool[] = [];
  const open = (config: PoolConfig): Pool => {
    const pool = new Pool(config);
    pools.push(pool);
    return pool;
  };

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it("cuts a slow query off at the query timeout and leaves nothing running", async () => {
    const pool = open({ ...queryPoolConfig(database(1500)), max: 1 });
    const watcher = open(pgConnectionSettings(database(0)));
    const startedAt = Date.now();

    const error = await pool.query(slowQuery).then(
      () => undefined,
      (caught: unknown) => caught
    );
    const tookMs = Date.now() - startedAt;

    expect(String(error)).toMatch(/timeout/);
    expect(tookMs).toBeGreaterThanOrEqual(1400);
    expect(tookMs).toBeLessThan(4000);
    await settle(1500);
    expect(await runningSlowQueries(watcher)).toBe(0);
    expect((await pool.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
  }, 60_000);

  it("is not cut off by a statement_timeout sent as a startup parameter, which QuestDB ignores", async () => {
    const pool = open({
      ...pgConnectionSettings(database(0)),
      statement_timeout: 500,
      max: 1,
    });

    const result = await pool.query(
      "SELECT sum(rnd_double()) AS total FROM long_sequence(1500000000)"
    );

    expect(result.rows).toHaveLength(1);
  }, 60_000);
});
