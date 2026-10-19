import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Redacted,
} from "effect";
import { describe, expect, it } from "vitest";
import {
  type AppConfig,
  ConfigService,
  ConfigServiceLive,
  MinimumLogLevelLive,
} from "@/infrastructure/config/config";

const envProvider = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(env));

/**
 * Load `ConfigService` against an explicit set of env values, isolated from the
 * ambient process env so the assertions hold whatever the runner exports.
 */
const loading = (env: Record<string, string>) =>
  Effect.gen(function* () {
    return yield* ConfigService;
  }).pipe(
    Effect.provide(ConfigServiceLive.pipe(Layer.provide(envProvider(env))))
  );

const loadConfig = (env: Record<string, string>): Promise<AppConfig> =>
  Effect.runPromise(loading(env));

const loadConfigExit = (env: Record<string, string>) =>
  Effect.runPromiseExit(loading(env));

const failureMessage = async (env: Record<string, string>): Promise<string> => {
  const exit = await loadConfigExit(env);
  if (Exit.isSuccess(exit)) {
    throw new Error("expected config load to fail");
  }
  return Cause.pretty(exit.cause);
};

const passwordOf = (config: AppConfig): string | undefined =>
  Option.getOrUndefined(Option.map(config.auth.password, Redacted.value));

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
      DB_QUERY_TIMEOUT: "20000",
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
      LOG_LEVEL: "debug",
    });

    const { password, jwtSecret, ...auth } = config.auth;
    expect({ ...config, auth }).toEqual({
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
        queryTimeout: 20000,
      },
      ping: {
        timeout: 3,
        trainCount: 4,
        intervalSeconds: 15,
        hosts: ["9.9.9.9"],
      },
      speedtest: { intervalSeconds: 600, timeoutSeconds: 60 },
      auth: { username: "phil", jwtExpiresInSeconds: 3600 },
      logging: { level: "Debug" },
    });
    expect(Option.map(password, Redacted.value)).toEqual(
      Option.some("hunter2")
    );
    expect(Redacted.value(jwtSecret)).toBe("not-the-default");
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

  describe("JWT_SECRET", () => {
    const loadWithWarnings = async (env: Record<string, string>) => {
      const warnings: string[] = [];
      const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
        if (logLevel === "Warn") {
          warnings.push(String(message));
        }
      });
      const config = await Effect.runPromise(
        loading(env).pipe(Effect.provide(Logger.layer([logger])))
      );
      return { config, warnings };
    };

    it("uses the configured value as-is", async () => {
      const config = await loadConfig({ JWT_SECRET: "fake-configured-secret" });

      expect(Redacted.value(config.auth.jwtSecret)).toBe(
        "fake-configured-secret"
      );
    });

    it("generates a random hex secret when unset", async () => {
      const config = await loadConfig({});

      expect(Redacted.value(config.auth.jwtSecret)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates a different secret on every load", async () => {
      const first = await loadConfig({});
      const second = await loadConfig({});

      expect(Redacted.value(first.auth.jwtSecret)).not.toBe(
        Redacted.value(second.auth.jwtSecret)
      );
    });

    it("generates a random secret when set to an empty string", async () => {
      const config = await loadConfig({ JWT_SECRET: "" });

      expect(Redacted.value(config.auth.jwtSecret)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("warns once when auth is enabled without a configured secret", async () => {
      const { warnings } = await loadWithWarnings({
        WAN_MONITOR_PASSWORD: "fake-password",
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("JWT_SECRET");
    });

    it("does not warn when the secret is configured", async () => {
      const { warnings } = await loadWithWarnings({
        WAN_MONITOR_PASSWORD: "fake-password",
        JWT_SECRET: "fake-configured-secret",
      });

      expect(warnings).toEqual([]);
    });

    it("does not warn when auth is disabled", async () => {
      const { warnings } = await loadWithWarnings({});

      expect(warnings).toEqual([]);
    });
  });

  describe("WAN_MONITOR_PASSWORD", () => {
    it("is absent when unset", async () => {
      const config = await loadConfig({});

      expect(Option.isNone(config.auth.password)).toBe(true);
    });

    it("is absent when explicitly set to an empty string", async () => {
      const config = await loadConfig({ WAN_MONITOR_PASSWORD: "" });

      expect(Option.isNone(config.auth.password)).toBe(true);
    });

    it("holds the configured value", async () => {
      const config = await loadConfig({ WAN_MONITOR_PASSWORD: "hunter2" });

      expect(passwordOf(config)).toBe("hunter2");
    });
  });

  describe("secret redaction", () => {
    it("prints <redacted> for both secrets when the config is logged", async () => {
      const config = await loadConfig({
        WAN_MONITOR_PASSWORD: "fake-password",
        JWT_SECRET: "fake-configured-secret",
      });
      const lines: string[] = [];
      const logger = Logger.map(Logger.formatSimple, (line) => {
        lines.push(line);
      });

      await Effect.runPromise(
        Effect.log(config).pipe(Effect.provide(Logger.layer([logger])))
      );

      const output = lines.join("\n");
      expect(output).toContain("<redacted>");
      expect(output).not.toContain("fake-password");
      expect(output).not.toContain("fake-configured-secret");
    });

    it("keeps the secrets out of the JSON form of the config", async () => {
      const config = await loadConfig({
        WAN_MONITOR_PASSWORD: "fake-password",
        JWT_SECRET: "fake-configured-secret",
      });

      const json = JSON.stringify(config);

      expect(json).not.toContain("fake-password");
      expect(json).not.toContain("fake-configured-secret");
    });
  });

  describe("JWT_EXPIRES_IN", () => {
    it("defaults to one day", async () => {
      const config = await loadConfig({});

      expect(config.auth.jwtExpiresInSeconds).toBe(86400);
    });

    it("falls back to the default for an empty value", async () => {
      const config = await loadConfig({ JWT_EXPIRES_IN: "" });

      expect(config.auth.jwtExpiresInSeconds).toBe(86400);
    });

    it.each([
      ["90s", 90],
      ["1h", 3600],
      ["7d", 604800],
      ["2w", 1209600],
      ["90 minutes", 5400],
      ["1.5h", 5400],
      [".5h", 1800],
      ["1H", 3600],
      ["1y", 31557600],
      ["1500ms", 1],
      [" 24h ", 86400],
    ])("reads %j as %i seconds", async (raw, seconds) => {
      const config = await loadConfig({ JWT_EXPIRES_IN: raw });

      expect(config.auth.jwtExpiresInSeconds).toBe(seconds);
    });

    it.each([
      "tomorrow",
      "-10s",
      "0s",
      "500ms",
      "1.5.5h",
      "h",
      "10 parsecs",
      "300000y",
    ])("fails to load for %j and names the variable", async (raw) => {
      const message = await failureMessage({ JWT_EXPIRES_IN: raw });

      expect(message).toContain("JWT_EXPIRES_IN");
    });

    it.each(["0s", "500ms", "300000y"])(
      "explains the accepted range when rejecting %j",
      async (raw) => {
        const message = await failureMessage({ JWT_EXPIRES_IN: raw });

        expect(message).toContain("at least one second");
        expect(message).toContain("valid expiry date");
      }
    );

    it.each(["3600", "0", "1.5"])(
      "rejects the bare number %j and asks for a unit",
      async (raw) => {
        const message = await failureMessage({ JWT_EXPIRES_IN: raw });

        expect(message).toContain("JWT_EXPIRES_IN");
        expect(message).toContain("unit");
      }
    );
  });

  describe("DB_QUERY_TIMEOUT", () => {
    it("defaults to 25 seconds", async () => {
      const config = await loadConfig({});

      expect(config.database.queryTimeout).toBe(25_000);
    });

    it("falls back to the default for an empty value", async () => {
      const config = await loadConfig({ DB_QUERY_TIMEOUT: "" });

      expect(config.database.queryTimeout).toBe(25_000);
    });

    it("reads milliseconds", async () => {
      const config = await loadConfig({ DB_QUERY_TIMEOUT: "60000" });

      expect(config.database.queryTimeout).toBe(60_000);
    });

    it.each(["0", "-1", "1.5", "abc", "30s"])(
      "fails to load for %j and names the variable",
      async (raw) => {
        const message = await failureMessage({ DB_QUERY_TIMEOUT: raw });

        expect(message).toContain("DB_QUERY_TIMEOUT");
      }
    );
  });

  describe("PING_INTERVAL_SECONDS", () => {
    it("defaults to 30 seconds", async () => {
      const config = await loadConfig({});

      expect(config.ping.intervalSeconds).toBe(30);
    });

    it("reads whole seconds", async () => {
      const config = await loadConfig({ PING_INTERVAL_SECONDS: "900" });

      expect(config.ping.intervalSeconds).toBe(900);
    });

    it.each(["0", "-30", "1.5", "abc", "30s"])(
      "fails to load for %j and names the variable, since every report reads its spacing from it",
      async (raw) => {
        const message = await failureMessage({ PING_INTERVAL_SECONDS: raw });

        expect(message).toContain("PING_INTERVAL_SECONDS");
      }
    );
  });

  describe("LOG_LEVEL", () => {
    it("defaults to Info when unset", async () => {
      const config = await loadConfig({});

      expect(config.logging.level).toBe("Info");
    });

    it("defaults to Info when empty", async () => {
      const config = await loadConfig({ LOG_LEVEL: "" });

      expect(config.logging.level).toBe("Info");
    });

    it.each([
      ["trace", "Trace"],
      ["debug", "Debug"],
      ["info", "Info"],
      ["warn", "Warn"],
      ["error", "Error"],
      ["fatal", "Fatal"],
      ["WARN", "Warn"],
      ["Info", "Info"],
      [" warn ", "Warn"],
    ] as const)("maps %j to %s", async (raw, level) => {
      const config = await loadConfig({ LOG_LEVEL: raw });

      expect(config.logging.level).toBe(level);
    });

    it.each(["verbose", "warning", "none", "all"])(
      "fails to load for %j and names the variable",
      async (raw) => {
        const message = await failureMessage({ LOG_LEVEL: raw });

        expect(message).toContain("LOG_LEVEL");
      }
    );
  });

  describe("MinimumLogLevelLive", () => {
    const captureLevels = async (
      logLevel: string,
      program: Effect.Effect<void>
    ) => {
      const levels: string[] = [];
      const capture = Logger.make<unknown, void>(({ logLevel: level }) => {
        levels.push(level);
      });
      const levelLayer = MinimumLogLevelLive.pipe(
        Layer.provide(ConfigServiceLive),
        Layer.provide(envProvider({ LOG_LEVEL: logLevel }))
      );
      await Effect.runPromise(
        program.pipe(
          Effect.provide(levelLayer),
          Effect.provide(Logger.layer([capture]))
        )
      );
      return levels;
    };

    const logsAtEveryLevel = Effect.gen(function* () {
      yield* Effect.logDebug("debug");
      yield* Effect.logInfo("info");
      yield* Effect.logWarning("warn");
    });

    it("suppresses info logs when LOG_LEVEL is warn", async () => {
      expect(await captureLevels("warn", logsAtEveryLevel)).toEqual(["Warn"]);
    });

    it("shows debug logs when LOG_LEVEL is debug", async () => {
      expect(await captureLevels("debug", logsAtEveryLevel)).toEqual([
        "Debug",
        "Info",
        "Warn",
      ]);
    });

    it("filters logs emitted while a layer built on top of it is constructed", async () => {
      const levels: string[] = [];
      const capture = Logger.make<unknown, void>(({ logLevel }) => {
        levels.push(logLevel);
      });
      const building = Layer.effectDiscard(Effect.logInfo("building"));
      const graph = building.pipe(
        Layer.provide(
          MinimumLogLevelLive.pipe(
            Layer.provide(ConfigServiceLive),
            Layer.provide(envProvider({ LOG_LEVEL: "warn" }))
          )
        )
      );

      await Effect.runPromise(
        Effect.void.pipe(
          Effect.provide(graph),
          Effect.provide(Logger.layer([capture]))
        )
      );

      expect(levels).toEqual([]);
    });
  });
});
