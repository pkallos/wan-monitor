import { describe, expect, it } from "@effect/vitest";
import {
  acceptAsAppliedSql,
  ledgerName,
} from "@/infrastructure/database/questdb/migrations/ledger";

describe("ledgerName", () => {
  it("appends _migrations to the table name", () => {
    expect(ledgerName("network_metrics")).toBe("network_metrics_migrations");
  });
});

describe("acceptAsAppliedSql", () => {
  it("records a positive version under the migration's name", () => {
    expect(
      acceptAsAppliedSql("metrics_migrations", {
        version: 4,
        name: "add-ping-duration",
      })
    ).toBe(
      "INSERT INTO metrics_migrations VALUES (4, 'add-ping-duration', now())"
    );
  });
});
