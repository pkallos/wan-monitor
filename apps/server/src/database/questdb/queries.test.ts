import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DatabaseQueryError } from "@/database/questdb/errors";
import type {
  QueryMetricsParams,
  QuerySpeedtestsParams,
} from "@/database/questdb/model";
import {
  buildQueryConnectivityStatus,
  buildQueryMetrics,
  buildQuerySpeedtests,
} from "@/database/questdb/queries";

describe("buildQueryMetrics", () => {
  it("should build query with default time range and no filters", async () => {
    const params: QueryMetricsParams = {};

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.query).toContain("FROM network_metrics");
    expect(result.query).toContain("WHERE timestamp >= $1");
    expect(result.query).toContain("AND timestamp <= $2");
    expect(result.query).toContain("ORDER BY timestamp DESC");
    expect(result.params).toHaveLength(2);
    expect(result.params[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.params[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("should build query with custom time range", async () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-02T00:00:00Z");
    const params: QueryMetricsParams = { startTime, endTime };

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.params[0]).toBe("2024-01-01T00:00:00.000Z");
    expect(result.params[1]).toBe("2024-01-02T00:00:00.000Z");
  });

  it("should build query with host filter", async () => {
    const params: QueryMetricsParams = {
      host: "8.8.8.8",
    };

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.query).toContain("AND host = $3");
    expect(result.params).toHaveLength(3);
    expect(result.params[2]).toBe("8.8.8.8");
  });

  it("should build query with limit", async () => {
    const params: QueryMetricsParams = {
      limit: 100,
    };

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.query).toContain("LIMIT $3");
    expect(result.params).toHaveLength(3);
    expect(result.params[2]).toBe(100);
  });

  it("should build query with host filter and limit", async () => {
    const params: QueryMetricsParams = {
      host: "1.1.1.1",
      limit: 50,
    };

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.query).toContain("AND host = $3");
    expect(result.query).toContain("LIMIT $4");
    expect(result.params).toHaveLength(4);
    expect(result.params[2]).toBe("1.1.1.1");
    expect(result.params[3]).toBe(50);
  });

  it("should build query with valid granularity", async () => {
    const params: QueryMetricsParams = {
      granularity: "1m",
    };

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.query).toContain("SAMPLE BY 1m");
    expect(result.query).toContain("avg(latency) as latency");
    expect(result.query).toContain("avg(jitter) as jitter");
  });

  it("should build query with all parameters", async () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-02T00:00:00Z");
    const params: QueryMetricsParams = {
      startTime,
      endTime,
      host: "8.8.8.8",
      limit: 100,
      granularity: "5m",
    };

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.query).toContain("SAMPLE BY 5m");
    expect(result.query).toContain("AND host = $3");
    expect(result.query).toContain("LIMIT $4");
    expect(result.params).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2024-01-02T00:00:00.000Z",
      "8.8.8.8",
      100,
    ]);
  });

  it("should fail with invalid granularity", async () => {
    const params: QueryMetricsParams = {
      // biome-ignore lint/suspicious/noExplicitAny: Testing invalid input
      granularity: "invalid" as any,
    };

    const result = await Effect.runPromiseExit(buildQueryMetrics(params));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const error = result.cause;
      expect(error._tag).toBe("Fail");
      if (error._tag === "Fail") {
        expect(error.error).toBeInstanceOf(DatabaseQueryError);
        expect(error.error.message).toContain("Invalid granularity: invalid");
      }
    }
  });

  it("should include latency validation in query when using granularity", async () => {
    const params: QueryMetricsParams = {
      granularity: "1m",
    };

    const result = await Effect.runPromise(buildQueryMetrics(params));

    expect(result.query).toContain("(latency IS NULL OR latency >= 0)");
  });
});

describe("buildQuerySpeedtests", () => {
  it("should build speedtest query with default time range", () => {
    const params: QuerySpeedtestsParams = {};

    const result = buildQuerySpeedtests(params);

    expect(result.query).toContain("FROM network_metrics");
    expect(result.query).toContain("WHERE timestamp >= $1");
    expect(result.query).toContain("AND timestamp <= $2");
    expect(result.query).toContain("AND source = 'speedtest'");
    expect(result.query).toContain("ORDER BY timestamp DESC");
    expect(result.params).toHaveLength(2);
  });

  it("should build speedtest query with custom time range", () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-02T00:00:00Z");
    const params: QuerySpeedtestsParams = { startTime, endTime };

    const result = buildQuerySpeedtests(params);

    expect(result.params[0]).toBe("2024-01-01T00:00:00.000Z");
    expect(result.params[1]).toBe("2024-01-02T00:00:00.000Z");
  });

  it("should build speedtest query with limit", () => {
    const params: QuerySpeedtestsParams = {
      limit: 50,
    };

    const result = buildQuerySpeedtests(params);

    expect(result.query).toContain("LIMIT $3");
    expect(result.params).toHaveLength(3);
    expect(result.params[2]).toBe(50);
  });

  it("should build speedtest query with all parameters", () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-02T00:00:00Z");
    const params: QuerySpeedtestsParams = {
      startTime,
      endTime,
      limit: 25,
    };

    const result = buildQuerySpeedtests(params);

    expect(result.params).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2024-01-02T00:00:00.000Z",
      25,
    ]);
  });

  it("should select all relevant speedtest columns", () => {
    const params: QuerySpeedtestsParams = {};

    const result = buildQuerySpeedtests(params);

    expect(result.query).toContain("download_bandwidth");
    expect(result.query).toContain("upload_bandwidth");
    expect(result.query).toContain("server_location");
    expect(result.query).toContain("isp");
    expect(result.query).toContain("external_ip");
    expect(result.query).toContain("internal_ip");
  });
});

describe("buildQueryConnectivityStatus", () => {
  it("should build connectivity status query with default time range", async () => {
    const params: QueryMetricsParams = {};

    const result = await Effect.runPromise(
      buildQueryConnectivityStatus(params)
    );

    expect(result.query).toContain("FROM network_metrics");
    expect(result.query).toContain("WHERE timestamp >= $1");
    expect(result.query).toContain("AND timestamp <= $2");
    expect(result.query).toContain("AND source = 'ping'");
    expect(result.query).toContain("SAMPLE BY 5m");
    expect(result.params).toHaveLength(2);
  });

  it("should build connectivity status query with custom time range", async () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-02T00:00:00Z");
    const params: QueryMetricsParams = { startTime, endTime };

    const result = await Effect.runPromise(
      buildQueryConnectivityStatus(params)
    );

    expect(result.params[0]).toBe("2024-01-01T00:00:00.000Z");
    expect(result.params[1]).toBe("2024-01-02T00:00:00.000Z");
  });

  it("should build connectivity status query with custom granularity", async () => {
    const params: QueryMetricsParams = {
      granularity: "1m",
    };

    const result = await Effect.runPromise(
      buildQueryConnectivityStatus(params)
    );

    expect(result.query).toContain("SAMPLE BY 1m");
  });

  it("should include connectivity status aggregations", async () => {
    const params: QueryMetricsParams = {};

    const result = await Effect.runPromise(
      buildQueryConnectivityStatus(params)
    );

    expect(result.query).toContain("down_count");
    expect(result.query).toContain("degraded_count");
    expect(result.query).toContain("up_count");
    expect(result.query).toContain("total_count");
    expect(result.query).toContain("connectivity_status = 'down'");
    expect(result.query).toContain("packet_loss >= 5");
    expect(result.query).toContain("packet_loss < 50");
  });

  it("should fail with invalid granularity", async () => {
    const params: QueryMetricsParams = {
      // biome-ignore lint/suspicious/noExplicitAny: Testing invalid input
      granularity: "invalid" as any,
    };

    const result = await Effect.runPromiseExit(
      buildQueryConnectivityStatus(params)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const error = result.cause;
      expect(error._tag).toBe("Fail");
      if (error._tag === "Fail") {
        expect(error.error).toBeInstanceOf(DatabaseQueryError);
        expect(error.error.message).toContain("Invalid granularity: invalid");
      }
    }
  });

  it("should order by timestamp ascending", async () => {
    const params: QueryMetricsParams = {};

    const result = await Effect.runPromise(
      buildQueryConnectivityStatus(params)
    );

    expect(result.query).toContain("ORDER BY timestamp ASC");
  });
});
