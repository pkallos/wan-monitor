import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import { Layer } from "effect";
import { AuthGroupLive } from "@/core/api/handlers/auth";
import { ConnectivityStatusGroupLive } from "@/core/api/handlers/connectivity-status";
import { HealthGroupLive } from "@/core/api/handlers/health";
import { MetricsGroupLive } from "@/core/api/handlers/metrics";
import { PingGroupLive } from "@/core/api/handlers/ping";
import { SpeedTestGroupLive } from "@/core/api/handlers/speedtest";
import {
  AuthorizationLive,
  AuthServiceLive,
} from "@/infrastructure/auth/middleware";

export const ApiServiceLayer = HttpApiBuilder.api(WanMonitorApi).pipe(
  Layer.provide([
    AuthGroupLive,
    ConnectivityStatusGroupLive,
    HealthGroupLive,
    MetricsGroupLive,
    PingGroupLive,
    SpeedTestGroupLive,
  ]),
  Layer.provide(AuthServiceLive),
  Layer.provide(AuthorizationLive)
);
