import { Layer } from "effect";
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
  auth?: Partial<AppConfig["auth"]>;
}

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
    autoFlushRows: 100,
    autoFlushInterval: 1000,
    requestTimeout: 10000,
    retryTimeout: 1000,
    ...overrides.database,
  },
  ping: { timeout: 5, trainCount: 10, hosts: ["8.8.8.8"], ...overrides.ping },
  auth: {
    username: "admin",
    password: "",
    jwtSecret: "test-secret",
    jwtExpiresIn: "24h",
    ...overrides.auth,
  },
});

/**
 * Convenience wrapper returning a `ConfigService` Layer backed by
 * {@link makeTestAppConfig}.
 */
export const makeTestConfigLayer = (
  overrides?: TestConfigOverrides
): Layer.Layer<ConfigService> =>
  Layer.succeed(ConfigService, makeTestAppConfig(overrides));
