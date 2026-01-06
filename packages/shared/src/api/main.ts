import { HttpApi } from "@effect/platform";
import { AuthApiGroup } from "@shared/api/routes/auth";
import { ConnectivityStatusApiGroup } from "@shared/api/routes/connectivity-status";
import { HealthApiGroup } from "@shared/api/routes/health";
import { MetricsApiGroup } from "@shared/api/routes/metrics";
import { PingApiGroup } from "@shared/api/routes/ping";
import { SpeedTestApiGroup } from "@shared/api/routes/speedtest";

export const WanMonitorApi = HttpApi.make("WanMonitorAPI")
  .add(AuthApiGroup.prefix("/auth"))
  .add(ConnectivityStatusApiGroup.prefix("/connectivity-status"))
  .add(HealthApiGroup.prefix("/health"))
  .add(MetricsApiGroup.prefix("/metrics"))
  .add(PingApiGroup.prefix("/ping"))
  .add(SpeedTestApiGroup.prefix("/speedtest"))
  .prefix("/api");
