import { Layer, Option, Redacted } from "effect";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";

/**
 * Per-section overrides for {@link makeTestAppConfig}. Each section is a partial
 * so a test only specifies the fields it cares about; everything else falls
 * back to the shared defaults below.
 */
export interface TestConfigOverrides {
  server?: Partial<AppConfig["server"]>;
  database?: Partial<AppConfig["database"]>;
  ping?: Partial<AppConfig["ping"]>;
  speedtest?: Partial<AppConfig["speedtest"]>;
  /** `password` and `jwtSecret` are plain strings here; an empty password disables auth. */
  auth?: {
    username?: string;
    password?: string;
    jwtSecret?: string;
    jwtExpiresInSeconds?: number;
  };
  logging?: Partial<AppConfig["logging"]>;
}

const passwordOption = (
  password: string | undefined
): AppConfig["auth"]["password"] =>
  password === undefined || password === ""
    ? Option.none()
    : Option.some(Redacted.make(password));

/**
 * Build an {@link AppConfig} for tests from shared defaults plus per-section
 * overrides. Replaces the config object literal that was previously copy-pasted
 * across the server test suite.
 */
export const makeTestAppConfig = (
  overrides: TestConfigOverrides = {}
): AppConfig => ({
  server: { port: 3001, host: "0.0.0.0", ...overrides.server },
  database: {
    host: "localhost",
    port: 9000,
    pgPort: 8812,
    protocol: "http",
    table: "network_metrics",
    autoFlushRows: 100,
    autoFlushInterval: 1000,
    requestTimeout: 10000,
    retryTimeout: 1000,
    ...overrides.database,
  },
  ping: {
    timeout: 5,
    trainCount: 10,
    intervalSeconds: 30,
    hosts: ["8.8.8.8"],
    ...overrides.ping,
  },
  speedtest: {
    intervalSeconds: 3600,
    timeoutSeconds: 120,
    ...overrides.speedtest,
  },
  auth: {
    username: overrides.auth?.username ?? "admin",
    password: passwordOption(overrides.auth?.password),
    jwtSecret: Redacted.make(overrides.auth?.jwtSecret ?? "test-secret"),
    jwtExpiresInSeconds: overrides.auth?.jwtExpiresInSeconds ?? 86_400,
  },
  logging: { level: "Info", ...overrides.logging },
});

/**
 * Convenience wrapper returning a `ConfigService` Layer backed by
 * {@link makeTestAppConfig}.
 */
export const makeTestConfigLayer = (
  overrides?: TestConfigOverrides
): Layer.Layer<ConfigService> =>
  Layer.succeed(ConfigService, makeTestAppConfig(overrides));
