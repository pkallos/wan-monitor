import { WanMonitorApi } from "@shared/api";
import { HealthUnhealthy } from "@shared/api/errors";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getReadyHandler = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    yield* db.health();

    return {
      status: "ok",
      timestamp: DateTime.nowUnsafe(),
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.fail(
        new HealthUnhealthy({ message: `Database unhealthy: ${error}` })
      )
    )
  );

export const getLiveHandler = () =>
  Effect.succeed({
    status: "ok",
    timestamp: DateTime.nowUnsafe(),
  });

export const HealthGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "health",
  (handlers) =>
    handlers
      .handle("getReady", getReadyHandler)
      .handle("getLive", getLiveHandler)
);
