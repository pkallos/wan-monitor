import { WanMonitorApi } from "@shared/api";
import { HealthUnhealthy } from "@shared/api/errors";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getReadyHandler = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    yield* db.health();
    const timestamp = yield* DateTime.now;

    return { status: "ok", timestamp };
  }).pipe(
    Effect.catch((error) =>
      Effect.fail(
        new HealthUnhealthy({ message: `Database unhealthy: ${error}` })
      )
    )
  );

export const getLiveHandler = () =>
  DateTime.now.pipe(Effect.map((timestamp) => ({ status: "ok", timestamp })));

export const HealthGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "health",
  (handlers) =>
    handlers
      .handle("getReady", getReadyHandler)
      .handle("getLive", getLiveHandler)
);
