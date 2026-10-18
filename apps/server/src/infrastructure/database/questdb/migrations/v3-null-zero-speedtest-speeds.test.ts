import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { MigrationRow } from "@/infrastructure/database/questdb/migrations/migration";
import {
  nullZeroSpeedtestSpeeds,
  ZERO_FILLED_SPEEDTEST_COLUMNS,
} from "@/infrastructure/database/questdb/migrations/v3-null-zero-speedtest-speeds";
import {
  createFakeContext,
  type FakeDigest,
  type FakeWalStatus,
  transient,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

type Column = (typeof ZERO_FILLED_SPEEDTEST_COLUMNS)[number];

const TABLE = "metrics";
const ROWS_WITH_A_SPEED = 10;

const countSql = (column: Column) =>
  `SELECT count() AS zeros FROM ${TABLE} WHERE source = 'speedtest' AND ${column} = 0`;
const updateSql = (column: Column) =>
  `UPDATE ${TABLE} SET ${column} = NULL WHERE source = 'speedtest' AND ${column} = 0`;

const updates = (statements: readonly string[]) =>
  statements.filter((sql) => sql.startsWith("UPDATE"));

const isDigestRead = (sql: string) => sql.includes("AS row_count");
const isWalRead = (sql: string) => sql.includes("FROM wal_tables()");

interface Scenario {
  readonly zeros: Partial<Record<Column, number>>;
  /** Non-null values per column before the update, zeros included; defaults to ROWS_WITH_A_SPEED. */
  readonly valuesBefore?: Partial<Record<Column, number>>;
  /** Figures that differ from a faithful update, applied to the digest read after it. */
  readonly afterUpdate?: (digest: FakeDigest) => FakeDigest;
  readonly wal?: (statements: readonly string[]) => FakeWalStatus;
  readonly failOn?: (sql: string) => ReturnType<typeof transient> | undefined;
}

const settled: FakeWalStatus = {
  suspended: false,
  writerTxn: 5,
  sequencerTxn: 5,
};

const setup = ({
  zeros,
  valuesBefore = {},
  afterUpdate,
  wal,
  failOn,
}: Scenario) => {
  const hasUpdated = (statements: readonly string[], column: Column) =>
    statements.includes(updateSql(column));

  const countFor = (column: Column, statements: readonly string[]) =>
    hasUpdated(statements, column) ? 0 : (zeros[column] ?? 0);

  const answers = (
    sql: string,
    statements: readonly string[]
  ): readonly MigrationRow[] | undefined => {
    const column = ZERO_FILLED_SPEEDTEST_COLUMNS.find(
      (name) => sql === countSql(name)
    );
    return column === undefined
      ? undefined
      : [{ zeros: String(countFor(column, statements)) }];
  };

  const digestFor = (
    _table: string,
    statements: readonly string[]
  ): FakeDigest => {
    const valuesLeft = (column: Column) =>
      (valuesBefore[column] ?? ROWS_WITH_A_SPEED) -
      (hasUpdated(statements, column) ? (zeros[column] ?? 0) : 0);
    const nonNull = Object.fromEntries(
      ZERO_FILLED_SPEEDTEST_COLUMNS.map((column) => [
        `nn_${column}`,
        String(valuesLeft(column)),
      ])
    );
    const onlyZeros = (column: Column) =>
      (valuesBefore[column] ?? ROWS_WITH_A_SPEED) === (zeros[column] ?? 0);
    // QuestDB's sum() is NULL, not 0, over a column with no values.
    const sums = Object.fromEntries(
      ZERO_FILLED_SPEEDTEST_COLUMNS.map((column) => [
        `sum_${column}`,
        valuesLeft(column) === 0
          ? null
          : onlyZeros(column)
            ? "0"
            : column === "download_bandwidth"
              ? "9000"
              : "4000",
      ])
    );
    const digest: FakeDigest = {
      totals: {
        row_count: "40",
        nn_latency: "40",
        ...sums,
        ...nonNull,
      },
      groups: [
        { source: "ping", host: "8.8.8.8", group_count: "30" },
        { source: "speedtest", host: null, group_count: "10" },
      ],
    };
    return updates(statements).length > 0 && afterUpdate !== undefined
      ? afterUpdate(digest)
      : digest;
  };

  const fake = createFakeContext({
    table: TABLE,
    tables: [TABLE],
    wal: { [TABLE]: wal ?? settled },
    answers,
    digestFor,
    failOn,
  });
  return { ...fake, up: nullZeroSpeedtestSpeeds.up(fake.ctx) };
};

describe("null-zero-speedtest-speeds", () => {
  it("is named for what it does", () => {
    expect(nullZeroSpeedtestSpeeds.name).toBe("null-zero-speedtest-speeds");
  });

  it("covers the two speed columns and leaves latency, jitter and packet loss alone", () => {
    expect(ZERO_FILLED_SPEEDTEST_COLUMNS).toEqual([
      "download_bandwidth",
      "upload_bandwidth",
    ]);
  });

  it.effect(
    "empties each column's zeros on speed test rows with an exact predicate",
    () => {
      const { up, statements } = setup({
        zeros: { download_bandwidth: 3, upload_bandwidth: 5 },
      });

      return Effect.gen(function* () {
        yield* up;

        expect(updates(statements)).toEqual([
          updateSql("download_bandwidth"),
          updateSql("upload_bandwidth"),
        ]);
      });
    }
  );

  it.effect("updates only the columns that hold zeros", () => {
    const { up, statements } = setup({ zeros: { upload_bandwidth: 2 } });

    return Effect.gen(function* () {
      yield* up;

      expect(updates(statements)).toEqual([updateSql("upload_bandwidth")]);
    });
  });

  it.effect(
    "changes nothing and reads no digest when no zero is stored",
    () => {
      const { up, statements } = setup({ zeros: {} });

      return Effect.gen(function* () {
        yield* up;

        expect(updates(statements)).toEqual([]);
        expect(statements.some(isDigestRead)).toBe(false);
      });
    }
  );

  it.effect("counts only after pending writes have applied", () => {
    const { up, statements } = setup({
      zeros: { download_bandwidth: 1 },
      wal: (seen) => {
        const reads = seen.filter(isWalRead).length;
        return reads < 3
          ? { suspended: false, writerTxn: 4, sequencerTxn: 5 }
          : settled;
      },
    });

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(up);
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Fiber.join(fiber);

      const firstCount = statements.indexOf(countSql("download_bandwidth"));
      const lastWalReadBeforeCount = statements
        .slice(0, firstCount)
        .filter(isWalRead).length;
      expect(lastWalReadBeforeCount).toBe(3);
    });
  });

  it.effect(
    "reads the digest after the update only once it has applied",
    () => {
      const { up, statements } = setup({
        zeros: { download_bandwidth: 2 },
        wal: (seen) => {
          const update = seen.findIndex((sql) => sql.startsWith("UPDATE"));
          const readsSinceUpdate =
            update === -1 ? 0 : seen.slice(update).filter(isWalRead).length;
          return update !== -1 && readsSinceUpdate < 3
            ? { suspended: false, writerTxn: 5, sequencerTxn: 6 }
            : settled;
        },
      });

      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(up);
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Fiber.join(fiber);

        const update = statements.findIndex((sql) => sql.startsWith("UPDATE"));
        const digestReads = statements
          .map((sql, index) => (isDigestRead(sql) ? index : -1))
          .filter((index) => index !== -1);
        expect(digestReads).toHaveLength(2);
        expect(digestReads[0]).toBeLessThan(update);
        expect(
          statements.slice(update, digestReads[1]).filter(isWalRead)
        ).toHaveLength(3);
      });
    }
  );

  it.effect("refuses a suspended table before changing anything", () => {
    const { up, statements } = setup({
      zeros: { download_bandwidth: 1 },
      wal: () => ({ suspended: true, writerTxn: 4, sequencerTxn: 5 }),
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(up);

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("RESUME WAL");
      expect(updates(statements)).toEqual([]);
    });
  });

  it.effect(
    "accepts a column whose only values were zeros, whose sum becomes NULL",
    () => {
      const { up, statements } = setup({
        zeros: { upload_bandwidth: 4 },
        valuesBefore: { upload_bandwidth: 4 },
      });

      return Effect.gen(function* () {
        yield* up;

        expect(updates(statements)).toEqual([updateSql("upload_bandwidth")]);
      });
    }
  );

  it.effect(
    "still refuses a column that kept values but whose sum became NULL",
    () => {
      const { up } = setup({
        zeros: { upload_bandwidth: 2 },
        afterUpdate: (digest) => ({
          ...digest,
          totals: { ...digest.totals, sum_upload_bandwidth: null },
        }),
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(up);

        expect(error.message).toContain("sum_upload_bandwidth");
      });
    }
  );

  it.effect(
    "fails terminally when a figure other than the counts moved",
    () => {
      const { up } = setup({
        zeros: { download_bandwidth: 3 },
        afterUpdate: (digest) => ({
          ...digest,
          totals: { ...digest.totals, sum_download_bandwidth: "8000" },
        }),
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(up);

        expect(error.kind).toBe("terminal");
        expect(error.sticky).toBe(true);
        expect(error.step).toBe("verify");
        expect(error.message).toContain(
          "sum_download_bandwidth: 9000 in expectation, 8000 in table"
        );
        expect(error.message).toContain("snapshot");
      });
    }
  );

  it.effect("fails terminally when the rows per host changed", () => {
    const { up } = setup({
      zeros: { upload_bandwidth: 1 },
      afterUpdate: (digest) => ({
        ...digest,
        groups: digest.groups.map((group) =>
          group.source === "ping" ? { ...group, group_count: "31" } : group
        ),
      }),
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(up);

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("rows for");
    });
  });

  it.effect.each([
    ["fewer", 4],
    ["more", 6],
  ])(
    "fails terminally when %s values were emptied than were counted",
    ([, emptied]) => {
      const { up } = setup({
        zeros: { download_bandwidth: 5 },
        afterUpdate: (digest) => ({
          ...digest,
          totals: {
            ...digest.totals,
            nn_download_bandwidth: String(ROWS_WITH_A_SPEED - Number(emptied)),
          },
        }),
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(up);

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("nn_download_bandwidth");
      });
    }
  );

  it.effect("propagates a failing update without recording success", () => {
    const { up, statements } = setup({
      zeros: { download_bandwidth: 1, upload_bandwidth: 1 },
      failOn: (sql) =>
        sql === updateSql("download_bandwidth")
          ? transient("connection reset")
          : undefined,
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(up);

      expect(error.kind).toBe("transient");
      expect(error.message).toBe("connection reset");
      expect(updates(statements)).toEqual([updateSql("download_bandwidth")]);
    });
  });

  it.effect("never touches latency, jitter or ping rows", () => {
    const { up, statements } = setup({
      zeros: { download_bandwidth: 1, upload_bandwidth: 1 },
    });

    return Effect.gen(function* () {
      yield* up;

      for (const sql of updates(statements)) {
        expect(sql).not.toMatch(/latency|jitter|packet_loss/);
        expect(sql).toContain("source = 'speedtest'");
      }
    });
  });
});
