import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api/main";
import { Effect } from "effect";
import { PingExecutor } from "@/core/monitoring/ping-executor";
import { ConfigService } from "@/infrastructure/config/config";

export const PingGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "ping",
  (handlers) =>
    handlers
      .handle("triggerPing", ({ payload }) =>
        Effect.gen(function* () {
          const pingExecutor = yield* PingExecutor;

          const results = payload?.hosts
            ? yield* pingExecutor.executeHosts(payload.hosts)
            : yield* pingExecutor.executeAll();

          return {
            success: true,
            timestamp: new Date().toISOString(),
            results,
          };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(`Failed to execute ping: ${error}`)
          )
        )
      )
      .handle("getHosts", () =>
        Effect.gen(function* () {
          const config = yield* ConfigService;
          return {
            hosts: config.ping.hosts,
          };
        })
      )
);
