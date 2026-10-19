import { describe, expect, it } from "@effect/vitest";
import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import type { Migration } from "@/infrastructure/database/questdb/migrations/migration";
import {
  MIGRATIONS,
  NETWORK_METRICS_SHAPE,
} from "@/infrastructure/database/questdb/migrations/registry";
import { createNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v1-create-network-metrics";
import { conformNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";
import { nullZeroSpeedtestSpeeds } from "@/infrastructure/database/questdb/migrations/v3-null-zero-speedtest-speeds";
import { addPingDuration } from "@/infrastructure/database/questdb/migrations/v4-add-ping-duration";
import {
  backticked,
  canonicalLiveColumns,
  createFakeContext,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

const indexOfMigration = (migration: Migration): number =>
  MIGRATIONS.findIndex(
    ({ version, name }) =>
      version === migration.version && name === migration.name
  );

describe("migration registry", () => {
  it("numbers migrations densely and ascending from 1", () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(
      MIGRATIONS.map((_, index) => index + 1)
    );
  });

  it("gives every migration a unique kebab-case name", () => {
    const names = MIGRATIONS.map((migration) => migration.name);

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("runs create-network-metrics before conform-network-metrics", () => {
    expect(indexOfMigration(createNetworkMetrics)).toBe(0);
    expect(indexOfMigration(conformNetworkMetrics)).toBe(1);
  });

  it("runs null-zero-speedtest-speeds after the schema is conformed", () => {
    expect(indexOfMigration(nullZeroSpeedtestSpeeds)).toBeGreaterThan(
      indexOfMigration(conformNetworkMetrics)
    );
  });

  it("runs add-ping-duration after the speed test values are cleaned", () => {
    expect(indexOfMigration(addPingDuration)).toBeGreaterThan(
      indexOfMigration(nullZeroSpeedtestSpeeds)
    );
  });

  it.effect(
    "guards v2 against a lost ledger by naming the last migration in the registry",
    () => {
      const { ctx } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        columns: { metrics: canonicalLiveColumns },
      });
      const last = MIGRATIONS.at(-1);

      return Effect.gen(function* () {
        const error = yield* Effect.flip(MIGRATIONS[1].up(ctx));

        expect(last?.version).toBe(addPingDuration.version);
        expect(backticked(error.message)).toEqual([
          "INSERT INTO metrics_migrations VALUES (4, 'add-ping-duration', now())",
        ]);
      });
    }
  );

  it("targets the declared columns, grouped by source and host", () => {
    expect(NETWORK_METRICS_SHAPE.columns).toEqual(NETWORK_METRICS_COLUMNS);
    expect(NETWORK_METRICS_SHAPE.groupColumns).toEqual(["source", "host"]);
  });
});
