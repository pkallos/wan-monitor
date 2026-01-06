import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import { DateTime, Effect } from "effect";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getReadyHandler = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    yield* db.health();

    return {
      status: "ok",
      timestamp: DateTime.unsafeNow(),
    };
  }).pipe(
    Effect.catchAll((error) => Effect.fail(`Database unhealthy: ${error}`))
  );

export const getLiveHandler = () =>
  Effect.succeed({
    status: "ok",
    timestamp: DateTime.unsafeNow(),
  });

export const HealthGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "health",
  (handlers) =>
    handlers
      .handle("getReady", getReadyHandler)
      .handle("getLive", getLiveHandler)
);
