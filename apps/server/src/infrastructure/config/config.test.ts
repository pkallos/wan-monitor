import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  type AppConfig,
  ConfigService,
  ConfigServiceLive,
} from "@/infrastructure/config/config";

/**
 * Load `ConfigService` against an explicit set of env values, isolated from the
 * ambient process env so the assertions hold whatever the runner exports.
 */
const loading = (env: Record<string, string>) =>
  Effect.gen(function* () {
    return yield* ConfigService;
  }).pipe(
    Effect.provide(
      ConfigServiceLive.pipe(
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))
      )
    )
  );

const loadConfig = (env: Record<string, string>): Promise<AppConfig> =>
  Effect.runPromise(loading(env));

const loadConfigExit = (env: Record<string, string>) =>
  Effect.runPromiseExit(loading(env));

describe("ConfigService", () => {
  it("reads every section from the environment when set", async () => {
    const config = await loadConfig({
      SERVER_PORT: "8080",
      SERVER_HOST: "127.0.0.1",
      DB_HOST: "questdb.internal",
      DB_PORT: "9009",
      DB_PG_PORT: "8813",
      DB_PROTOCOL: "tcp",
      DB_TABLE: "custom_metrics",
      DB_AUTO_FLUSH_ROWS: "42",
      DB_AUTO_FLUSH_INTERVAL: "250",
      DB_REQUEST_TIMEOUT: "5000",
      DB_RETRY_TIMEOUT: "750",
      PING_TIMEOUT: "3",
      PING_TRAIN_COUNT: "4",
      PING_INTERVAL_SECONDS: "15",
      PING_HOSTS: "9.9.9.9",
      SPEEDTEST_INTERVAL_SECONDS: "600",
      SPEEDTEST_TIMEOUT_SECONDS: "60",
      WAN_MONITOR_USERNAME: "phil",
      WAN_MONITOR_PASSWORD: "hunter2",
      JWT_SECRET: "not-the-default",
      JWT_EXPIRES_IN: "1h",
    });

    expect(config).toEqual({
      server: { port: 8080, host: "127.0.0.1" },
      database: {
        host: "questdb.internal",
        port: 9009,
        pgPort: 8813,
        protocol: "tcp",
        table: "custom_metrics",
        autoFlushRows: 42,
        autoFlushInterval: 250,
        requestTimeout: 5000,
        retryTimeout: 750,
      },
      ping: {
        timeout: 3,
        trainCount: 4,
        intervalSeconds: 15,
        hosts: ["9.9.9.9"],
      },
      speedtest: { intervalSeconds: 600, timeoutSeconds: 60 },
      auth: {
        username: "phil",
        password: "hunter2",
        jwtSecret: "not-the-default",
        jwtExpiresIn: "1h",
      },
    } satisfies AppConfig);
  });

  it("fails to load when DB_PROTOCOL is not http or tcp", async () => {
    const exit = await loadConfigExit({ DB_PROTOCOL: "grpc" });

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("fails to load when SERVER_PORT is not a number", async () => {
    const exit = await loadConfigExit({ SERVER_PORT: "abc" });

    expect(Exit.isFailure(exit)).toBe(true);
  });

  describe("PING_HOSTS parsing", () => {
    it("trims whitespace around each host", async () => {
      const config = await loadConfig({
        PING_HOSTS: " 8.8.8.8 ,\t1.1.1.1 , cloudflare.com ",
      });

      expect(config.ping.hosts).toEqual([
        "8.8.8.8",
        "1.1.1.1",
        "cloudflare.com",
      ]);
    });

    // An empty env value reads as absent for every `Config` key, so the
    // documented defaults apply rather than "monitor nothing".
    it("falls back to the default hosts for an empty value", async () => {
      const config = await loadConfig({ PING_HOSTS: "" });

      expect(config.ping.hosts).toEqual([
        "8.8.8.8",
        "1.1.1.1",
        "cloudflare.com",
      ]);
    });

    it("drops empty entries from a trailing or doubled comma", async () => {
      const config = await loadConfig({ PING_HOSTS: "8.8.8.8,,1.1.1.1," });

      expect(config.ping.hosts).toEqual(["8.8.8.8", "1.1.1.1"]);
    });
  });

  describe("WAN_MONITOR_PASSWORD", () => {
    it("is empty when unset", async () => {
      const config = await loadConfig({});

      expect(config.auth.password).toBe("");
    });

    it("is empty when explicitly set to an empty string", async () => {
      const config = await loadConfig({ WAN_MONITOR_PASSWORD: "" });

      expect(config.auth.password).toBe("");
    });
  });
});
