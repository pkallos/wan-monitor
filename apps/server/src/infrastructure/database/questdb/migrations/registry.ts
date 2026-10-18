import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import type { Migration } from "@/infrastructure/database/questdb/migrations/migration";
import type { TableShape } from "@/infrastructure/database/questdb/migrations/schema";
import { createNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v1-create-network-metrics";
import {
  conformNetworkMetrics,
  NETWORK_METRICS_GROUP_COLUMNS,
} from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";

/** Every migration, oldest first. A schema change is a new entry appended here. */
export const MIGRATIONS: readonly Migration[] = [
  createNetworkMetrics,
  conformNetworkMetrics,
];

/** What the table must look like once every migration has run. */
export const NETWORK_METRICS_SHAPE: TableShape = {
  columns: NETWORK_METRICS_COLUMNS,
  groupColumns: NETWORK_METRICS_GROUP_COLUMNS,
};
