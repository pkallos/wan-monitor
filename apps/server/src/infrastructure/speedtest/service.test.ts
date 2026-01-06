import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigProvider, Effect, Exit, Layer, Logger, LogLevel } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SPEEDTEST_TIMEOUT_SECONDS,
  makeSpeedTestService,
  SpeedTestExecutionError,
  SpeedTestService,
  SpeedTestServiceLive,
  SpeedTestTimeoutError,
} from "./service";

const isMacArm64 = process.platform === "darwin" && process.arch === "arm64";

const mockSpeedTestResult = {
  type: "result" as const,
  timestamp: new Date(),
  download: { bandwidth: 12500000, bytes: 100000000, elapsed: 8000 },
  upload: { bandwidth: 6250000, bytes: 50000000, elapsed: 8000 },
  ping: { latency: 15.5, jitter: 2.1 },
  server: {
    id: 12345,
    name: "Test Server",
    location: "Test City",
    country: "Test Country",
    host: "test.speedtest.net",
    port: 8080,
    ip: "1.2.3.4",
  },
  isp: "Test ISP",
  interface: {
    externalIp: "1.2.3.4",
    internalIp: "192.168.1.100",
    isVpn: false,
    macAddr: "00:00:00:00:00:00",
    name: "eth0",
  },
  packetLoss: 0,
  result: { id: "test-id", url: "https://speedtest.net/result/test-id" },
};

describe("SpeedTest - timeout functionality", () => {
  it("should have correct default timeout value", () => {
    expect(DEFAULT_SPEEDTEST_TIMEOUT_SECONDS).toBe(120);
  });

  it("should complete successfully when executor resolves before timeout", async () => {
    const fastExecutor = () => Promise.resolve(mockSpeedTestResult);
    const service = makeSpeedTestService(fastExecutor, 5);

    const result = await Effect.runPromise(
      service
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    expect(result.downloadSpeed).toBeCloseTo(100, 0);
    expect(result.uploadSpeed).toBeCloseTo(50, 0);
    expect(result.latency).toBe(15.5);
    expect(result.jitter).toBe(2.1);
    expect(result.serverName).toBe("Test Server");
    expect(result.isp).toBe("Test ISP");
  });

  it("should return SpeedTestTimeoutError when executor exceeds timeout", async () => {
    const slowExecutor = () =>
      new Promise<typeof mockSpeedTestResult>((resolve) => {
        setTimeout(() => resolve(mockSpeedTestResult), 5000);
      });

    const timeoutSeconds = 0.1;
    const service = makeSpeedTestService(slowExecutor, timeoutSeconds);

    const exit = await Effect.runPromiseExit(
      service
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause;
      expect(error._tag).toBe("Fail");
      if (error._tag === "Fail") {
        expect(error.error).toBeInstanceOf(SpeedTestTimeoutError);
        expect((error.error as SpeedTestTimeoutError).timeoutMs).toBe(100);
      }
    }
  });

  it("should return SpeedTestExecutionError when executor throws", async () => {
    const failingExecutor = () =>
      Promise.reject(new Error("Network connection failed"));
    const service = makeSpeedTestService(failingExecutor, 5);

    const exit = await Effect.runPromiseExit(
      service
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause;
      expect(error._tag).toBe("Fail");
      if (error._tag === "Fail") {
        expect(error.error).toBeInstanceOf(SpeedTestExecutionError);
        expect((error.error as SpeedTestExecutionError).message).toBe(
          "Network connection failed"
        );
      }
    }
  });

  it("should return SpeedTestExecutionError when executor throws non-Error", async () => {
    const failingExecutor = () => Promise.reject("string error");
    const service = makeSpeedTestService(failingExecutor, 5);

    const exit = await Effect.runPromiseExit(
      service
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause;
      if (error._tag === "Fail") {
        expect(error.error).toBeInstanceOf(SpeedTestExecutionError);
        expect((error.error as SpeedTestExecutionError).message).toBe(
          "string error"
        );
      }
    }
  });

  it("should use configured timeout value", async () => {
    const slowExecutor = () =>
      new Promise<typeof mockSpeedTestResult>((resolve) => {
        setTimeout(() => resolve(mockSpeedTestResult), 500);
      });

    const shortTimeoutService = makeSpeedTestService(slowExecutor, 0.2);
    const longTimeoutService = makeSpeedTestService(slowExecutor, 2);

    const shortExit = await Effect.runPromiseExit(
      shortTimeoutService
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    const longExit = await Effect.runPromiseExit(
      longTimeoutService
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    expect(Exit.isFailure(shortExit)).toBe(true);
    expect(Exit.isSuccess(longExit)).toBe(true);
  });

  it("should handle missing optional fields in result", async () => {
    const minimalResult = {
      ...mockSpeedTestResult,
      download: { bandwidth: 0, bytes: 0, elapsed: 0 },
      upload: { bandwidth: 0, bytes: 0, elapsed: 0 },
      ping: { latency: 0, jitter: 0 },
      server: undefined as unknown as typeof mockSpeedTestResult.server,
      isp: undefined as unknown as string,
      interface: undefined as unknown as typeof mockSpeedTestResult.interface,
    };
    const executor = () => Promise.resolve(minimalResult);
    const service = makeSpeedTestService(executor, 5);

    const result = await Effect.runPromise(
      service
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    expect(result.downloadSpeed).toBe(0);
    expect(result.uploadSpeed).toBe(0);
    expect(result.latency).toBe(0);
    expect(result.serverName).toBeUndefined();
    expect(result.isp).toBeUndefined();
    expect(result.externalIp).toBeUndefined();
  });

  it("should include correct timeoutMs in SpeedTestTimeoutError", async () => {
    const slowExecutor = () =>
      new Promise<typeof mockSpeedTestResult>((resolve) => {
        setTimeout(() => resolve(mockSpeedTestResult), 5000);
      });

    const timeoutSeconds = 0.05;
    const service = makeSpeedTestService(slowExecutor, timeoutSeconds);

    const exit = await Effect.runPromiseExit(
      service
        .runTest()
        .pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause;
      if (error._tag === "Fail") {
        const timeoutError = error.error as SpeedTestTimeoutError;
        expect(timeoutError.timeoutMs).toBe(50);
        expect(timeoutError._tag).toBe("SpeedTestTimeoutError");
      }
    }
  });
});

describe("SpeedTestServiceLive - config integration", () => {
  const originalEnv = process.env.SPEEDTEST_TIMEOUT_SECONDS;

  beforeEach(() => {
    delete process.env.SPEEDTEST_TIMEOUT_SECONDS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SPEEDTEST_TIMEOUT_SECONDS = originalEnv;
    } else {
      delete process.env.SPEEDTEST_TIMEOUT_SECONDS;
    }
  });

  it("should use default timeout when env var is not set", async () => {
    const program = Effect.gen(function* () {
      const service = yield* SpeedTestService;
      return service;
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(
        Effect.provide(SpeedTestServiceLive),
        Effect.provide(Logger.minimumLogLevel(LogLevel.None))
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("should read SPEEDTEST_TIMEOUT_SECONDS from config provider", async () => {
    const customConfig = ConfigProvider.fromMap(
      new Map([["SPEEDTEST_TIMEOUT_SECONDS", "30"]])
    );

    const program = Effect.gen(function* () {
      const service = yield* SpeedTestService;
      return service;
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(
        Effect.provide(SpeedTestServiceLive),
        Effect.provide(Layer.setConfigProvider(customConfig)),
        Effect.provide(Logger.minimumLogLevel(LogLevel.None))
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("should read SPEEDTEST_TIMEOUT_SECONDS from environment variable", async () => {
    process.env.SPEEDTEST_TIMEOUT_SECONDS = "45";

    const program = Effect.gen(function* () {
      const service = yield* SpeedTestService;
      return service;
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(
        Effect.provide(SpeedTestServiceLive),
        Effect.provide(Logger.minimumLogLevel(LogLevel.None))
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe.skipIf(!isMacArm64)("SpeedTest - speedtest-net ARM64 patch", () => {
  it("should have darwin arm64 platform support in speedtest-net", () => {
    const speedtestIndexPath = path.join(
      __dirname,
      "../../../../../node_modules/.pnpm/speedtest-net@2.2.0/node_modules/speedtest-net/index.js"
    );

    if (!fs.existsSync(speedtestIndexPath)) {
      throw new Error(
        `speedtest-net not found at ${speedtestIndexPath}. Run pnpm install first.`
      );
    }

    const content = fs.readFileSync(speedtestIndexPath, "utf-8");

    // Check for darwin arm64 platform entry
    const hasDarwinArm64 =
      content.includes("platform: 'darwin'") &&
      content.includes("arch: 'arm64'");

    expect(hasDarwinArm64).toBe(true);

    // Verify the patch structure - should have both darwin arm64 and darwin x64
    const darwinArm64Match = content.match(
      /{\s*(?:defaultVersion:\s*'[\d.]+',\s*)?platform:\s*'darwin',\s*arch:\s*'arm64'/
    );
    const darwinX64Match = content.match(
      /{\s*(?:defaultVersion:\s*'[\d.]+',\s*)?platform:\s*'darwin',\s*arch:\s*'x64'/
    );

    expect(darwinArm64Match).toBeTruthy();
    expect(darwinX64Match).toBeTruthy();
  });

  it("should have correct binary information for darwin arm64", () => {
    const speedtestIndexPath = path.join(
      __dirname,
      "../../../../../node_modules/.pnpm/speedtest-net@2.2.0/node_modules/speedtest-net/index.js"
    );

    const content = fs.readFileSync(speedtestIndexPath, "utf-8");

    // Verify darwin arm64 entry has proper binary info
    const platformsSection = content.match(/const platforms = \[([\s\S]+?)\];/);
    expect(platformsSection).toBeTruthy();

    if (platformsSection) {
      const platforms = platformsSection[1];

      // Should have darwin arm64 with macosx package
      expect(platforms).toContain("platform: 'darwin'");
      expect(platforms).toContain("arch: 'arm64'");
      expect(platforms).toContain("pkg: 'macosx-universal");

      // Verify darwin arm64 entry exists with correct structure
      const darwinArm64Section = platforms.match(
        /platform:\s*'darwin',\s*arch:\s*'arm64'/
      );
      expect(darwinArm64Section).toBeTruthy();
    }
  });
});
