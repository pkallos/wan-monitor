import { Layer } from "effect";
import { SpeedTestRunnerLive } from "@/core/monitoring/speed-test-runner";
import type { QuestDB } from "@/infrastructure/database/questdb";
import type { SpeedTestService } from "@/infrastructure/speedtest/types";

export const speedTestRunnerFrom = (
  speedTest: Layer.Layer<SpeedTestService>,
  db: Layer.Layer<QuestDB>
) => SpeedTestRunnerLive.pipe(Layer.provide(Layer.merge(speedTest, db)));
