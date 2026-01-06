import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api/main";
import { Layer } from "effect";
import { AuthGroupLive } from "@/server/routes/auth";
import { ConnectivityStatusGroupLive } from "@/server/routes/connectivity-status";
import { HealthGroupLive } from "@/server/routes/health";
import { MetricsGroupLive } from "@/server/routes/metrics";
import { PingGroupLive } from "@/server/routes/ping";
import { SpeedTestGroupLive } from "@/server/routes/speedtest";
import { AuthorizationLive, AuthServiceLive } from "@/services/auth-middleware";

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
