import { describe, expect, it } from "@effect/vitest";
import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import {
  MIGRATIONS,
  NETWORK_METRICS_SHAPE,
} from "@/infrastructure/database/questdb/migrations/registry";
import { createNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v1-create-network-metrics";
import { conformNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";

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
    expect(MIGRATIONS[0]).toBe(createNetworkMetrics);
    expect(MIGRATIONS[1]).toBe(conformNetworkMetrics);
  });

  it("targets the declared columns, grouped by source and host", () => {
    expect(NETWORK_METRICS_SHAPE.columns).toEqual(NETWORK_METRICS_COLUMNS);
    expect(NETWORK_METRICS_SHAPE.groupColumns).toEqual(["source", "host"]);
  });
});
