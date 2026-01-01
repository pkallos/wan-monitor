import { Context, type Effect } from "effect";
import type { SpeedTestError } from "@/services/speedtest-errors";

// Schema-like type definition (without importing Schema to avoid native module deps)
export interface SpeedTestResult {
  timestamp: Date;
  downloadSpeed: number;
  uploadSpeed: number;
  latency: number;
  jitter?: number;
  serverId?: string;
  serverName?: string;
  serverLocation?: string;
  serverCountry?: string;
  isp?: string;
  externalIp?: string;
  internalIp?: string;
}

export interface SpeedTestServiceInterface {
  readonly runTest: () => Effect.Effect<SpeedTestResult, SpeedTestError, never>;
}

export class SpeedTestService extends Context.Tag("SpeedTestService")<
  SpeedTestService,
  SpeedTestServiceInterface
>() {}
