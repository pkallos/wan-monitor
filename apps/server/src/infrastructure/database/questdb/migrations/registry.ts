import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import { Array as Arr } from "effect";
import { withLedgerLossGuard } from "@/infrastructure/database/questdb/migrations/ledger-loss-guard";
import type { Migration } from "@/infrastructure/database/questdb/migrations/migration";
import type { TableShape } from "@/infrastructure/database/questdb/migrations/schema";
import { createNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v1-create-network-metrics";
import {
  conformNetworkMetrics,
  NETWORK_METRICS_GROUP_COLUMNS,
} from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";
import { nullZeroSpeedtestSpeeds } from "@/infrastructure/database/questdb/migrations/v3-null-zero-speedtest-speeds";
import { addPingDuration } from "@/infrastructure/database/questdb/migrations/v4-add-ping-duration";

/**
 * Every migration, oldest first. A schema change is a new entry appended here.
 * v2 runs behind the ledger-loss guard because v2 predates the migrations that
 * add columns.
 */
export const MIGRATIONS: readonly [Migration, ...Migration[]] = [
  createNetworkMetrics,
  withLedgerLossGuard(conformNetworkMetrics, () =>
    Arr.lastNonEmpty(MIGRATIONS)
  ),
  nullZeroSpeedtestSpeeds,
  addPingDuration,
];

/** What the table must look like once every migration has run. */
export const NETWORK_METRICS_SHAPE: TableShape = {
  columns: NETWORK_METRICS_COLUMNS,
  groupColumns: NETWORK_METRICS_GROUP_COLUMNS,
};
