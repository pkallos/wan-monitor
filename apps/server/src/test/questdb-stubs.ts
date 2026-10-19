import { Effect } from "effect";
import type { QuestDBService } from "@/infrastructure/database/questdb";

/**
 * Empty-result implementations of the summary, host, outage run and window
 * uptime queries, for mock `QuestDBService` objects whose test never reads
 * them.
 */
export const emptyAnalyticsQueries = {
  querySummaryStats: () =>
    Effect.succeed({
      latency_p50: null,
      latency_p95: null,
      avg_packet_loss: null,
      avg_jitter: null,
    }),
  queryHostStats: () => Effect.succeed([]),
  queryOutageRuns: () => Effect.succeed([]),
  queryWindowUptime: () => Effect.succeed([]),
} satisfies Pick<
  QuestDBService,
  | "querySummaryStats"
  | "queryHostStats"
  | "queryOutageRuns"
  | "queryWindowUptime"
>;
