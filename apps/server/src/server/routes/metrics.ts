import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api/main";
import { Effect } from "effect";
import { QuestDB } from "@/database/questdb";

export const MetricsGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "metrics",
  (handlers) =>
    handlers.handle("getMetrics", ({ urlParams }) =>
      Effect.gen(function* () {
        const db = yield* QuestDB;

        const data = yield* db.queryMetrics({
          startTime: urlParams.startTime
            ? new Date(urlParams.startTime)
            : undefined,
          endTime: urlParams.endTime ? new Date(urlParams.endTime) : undefined,
          host: urlParams.host,
          limit: urlParams.limit,
          granularity: urlParams.granularity,
        });

        return {
          data,
          meta: {
            startTime:
              urlParams.startTime ||
              new Date(Date.now() - 3600000).toISOString(),
            endTime: urlParams.endTime || new Date().toISOString(),
            count: data.length,
          },
        };
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(`Failed to query metrics: ${error}`)
        )
      )
    )
);
