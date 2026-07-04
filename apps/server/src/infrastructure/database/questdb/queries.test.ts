import { describe, expect, it } from "@effect/vitest";
import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import { Cause, Effect, Exit } from "effect";
import { DatabaseQueryError } from "@/infrastructure/database/questdb/errors";
import type {
  QueryMetricsParams,
  QuerySpeedtestsParams,
} from "@/infrastructure/database/questdb/model";
import {
  buildQueryConnectivityStatus,
  buildQueryMetrics,
  buildQuerySpeedtests,
} from "@/infrastructure/database/questdb/queries";

describe("buildQueryMetrics", () => {
  it.effect("should build query with default time range and no filters", () => {
    const params: QueryMetricsParams = {};

    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics(params);

      expect(result.query).toContain("FROM network_metrics");
      expect(result.query).toContain("WHERE timestamp >= $1");
      expect(result.query).toContain("AND timestamp <= $2");
      expect(result.query).toContain("ORDER BY timestamp DESC");
      expect(result.params).toHaveLength(2);
      expect(result.params[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.params[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it.effect("should build query with custom time range", () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-02T00:00:00Z");
    const params: QueryMetricsParams = { startTime, endTime };

    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics(params);

      expect(result.params[0]).toBe("2024-01-01T00:00:00.000Z");
      expect(result.params[1]).toBe("2024-01-02T00:00:00.000Z");
    });
  });

  it.effect("should build query with host filter", () => {
    const params: QueryMetricsParams = {
      host: "8.8.8.8",
    };

    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics(params);

      expect(result.query).toContain("AND host = $3");
      expect(result.params).toHaveLength(3);
      expect(result.params[2]).toBe("8.8.8.8");
    });
  });

  it.effect("should build query with limit", () => {
    const params: QueryMetricsParams = {
      limit: 100,
    };

    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics(params);

      expect(result.query).toContain("LIMIT $3");
      expect(result.params).toHaveLength(3);
      expect(result.params[2]).toBe(100);
    });
  });

  it.effect("should build query with host filter and limit", () => {
    const params: QueryMetricsParams = {
      host: "1.1.1.1",
      limit: 50,
    };

    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics(params);

      expect(result.query).toContain("AND host = $3");
      expect(result.query).toContain("LIMIT $4");
      expect(result.params).toHaveLength(4);
      expect(result.params[2]).toBe("1.1.1.1");
      expect(result.params[3]).toBe(50);
    });
  });

  it.effect("should build query with valid granularity", () => {
    const params: QueryMetricsParams = {
      granularity: "1m",
    };

    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics(params);

      expect(result.query).toContain("SAMPLE BY 1m");
      expect(result.query).toContain("avg(latency) as latency");
      expect(result.query).toContain("avg(jitter) as jitter");
    });
  });

  it.effect("should build query with all parameters", () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-02T00:00:00Z");
    const params: QueryMetricsParams = {
      startTime,
      endTime,
      host: "8.8.8.8",
      limit: 100,
      granularity: "5m",
    };

    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics(params);

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
  });

  it.effect("should fail with invalid granularity", () => {
    const params: QueryMetricsParams = { granularity: "invalid" };

    return Effect.gen(function* () {
      const result = yield* Effect.exit(buildQueryMetrics(params));

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const cause = result.cause;
        expect(Cause.isFailType(cause)).toBe(true);
        if (Cause.isFailType(cause)) {
          expect(cause.error).toBeInstanceOf(DatabaseQueryError);
          expect(cause.error.message).toContain("Invalid granularity: invalid");
        }
      }
    });
  });

  it.effect(
    "should include latency validation in query when using granularity",
    () => {
      const params: QueryMetricsParams = {
        granularity: "1m",
      };

      return Effect.gen(function* () {
        const result = yield* buildQueryMetrics(params);

        expect(result.query).toContain("(latency IS NULL OR latency >= 0)");
      });
    }
  );
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
  it.effect(
    "should build connectivity status query with default time range",
    () => {
      const params: QueryMetricsParams = {};

      return Effect.gen(function* () {
        const result = yield* buildQueryConnectivityStatus(params);

        expect(result.query).toContain("FROM network_metrics");
        expect(result.query).toContain("WHERE timestamp >= $1");
        expect(result.query).toContain("AND timestamp <= $2");
        expect(result.query).toContain("AND source = 'ping'");
        expect(result.query).toContain("SAMPLE BY 5m");
        expect(result.params).toHaveLength(2);
      });
    }
  );

  it.effect(
    "should build connectivity status query with custom time range",
    () => {
      const startTime = new Date("2024-01-01T00:00:00Z");
      const endTime = new Date("2024-01-02T00:00:00Z");
      const params: QueryMetricsParams = { startTime, endTime };

      return Effect.gen(function* () {
        const result = yield* buildQueryConnectivityStatus(params);

        expect(result.params[0]).toBe("2024-01-01T00:00:00.000Z");
        expect(result.params[1]).toBe("2024-01-02T00:00:00.000Z");
      });
    }
  );

  it.effect(
    "should build connectivity status query with custom granularity",
    () => {
      const params: QueryMetricsParams = {
        granularity: "1m",
      };

      return Effect.gen(function* () {
        const result = yield* buildQueryConnectivityStatus(params);

        expect(result.query).toContain("SAMPLE BY 1m");
      });
    }
  );

  it.effect("should include connectivity status aggregations", () => {
    const params: QueryMetricsParams = {};

    return Effect.gen(function* () {
      const result = yield* buildQueryConnectivityStatus(params);

      expect(result.query).toContain("down_count");
      expect(result.query).toContain("degraded_count");
      expect(result.query).toContain("up_count");
      expect(result.query).toContain("total_count");
      expect(result.query).toContain("connectivity_status = 'down'");
      expect(result.query).toContain("connectivity_status != 'down'");
      expect(result.query).toContain("packet_loss >= 5");
    });
  });

  it.effect(
    "classifies via connectivity_status without a packet-loss ceiling or latency gap",
    () => {
      // Regression guard for PHI-140: the previous SQL dropped reachable samples
      // with >= 50% packet loss (upper bound) and double-counted samples with a
      // negative latency sentinel as both up and down. The exhaustive/mutually-
      // exclusive classification removes both the `packet_loss < 50` ceiling and
      // any latency-based branch.
      return Effect.gen(function* () {
        const result = yield* buildQueryConnectivityStatus({});

        expect(result.query).not.toContain("packet_loss < 50");
        expect(result.query).not.toContain("latency < 0");
        expect(result.query).not.toContain("latency >= 0");
        expect(result.query).not.toContain("latency > 0");
      });
    }
  );

  it.effect(
    "should classify packet loss using the shared PACKET_LOSS_THRESHOLDS",
    () => {
      const params: QueryMetricsParams = {};

      return Effect.gen(function* () {
        const result = yield* buildQueryConnectivityStatus(params);

        expect(result.query).toContain(
          `packet_loss >= ${PACKET_LOSS_THRESHOLDS.degradedFloor}`
        );
        expect(result.query).toContain(
          `packet_loss < ${PACKET_LOSS_THRESHOLDS.degradedFloor} OR packet_loss IS NULL`
        );
      });
    }
  );

  it.effect("should fail with invalid granularity", () => {
    const params: QueryMetricsParams = { granularity: "invalid" };

    return Effect.gen(function* () {
      const result = yield* Effect.exit(buildQueryConnectivityStatus(params));

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const cause = result.cause;
        expect(Cause.isFailType(cause)).toBe(true);
        if (Cause.isFailType(cause)) {
          expect(cause.error).toBeInstanceOf(DatabaseQueryError);
          expect(cause.error.message).toContain("Invalid granularity: invalid");
        }
      }
    });
  });

  it.effect("should order by timestamp ascending", () => {
    const params: QueryMetricsParams = {};

    return Effect.gen(function* () {
      const result = yield* buildQueryConnectivityStatus(params);

      expect(result.query).toContain("ORDER BY timestamp ASC");
    });
  });
});

describe("table name parameterization", () => {
  it.effect("buildQueryMetrics targets a custom table when provided", () => {
    return Effect.gen(function* () {
      const result = yield* buildQueryMetrics({}, "network_metrics_test_2");

      expect(result.query).toContain("FROM network_metrics_test_2");
      expect(result.query).not.toContain("FROM network_metrics\n");
    });
  });

  it.effect(
    "buildQueryMetrics targets a custom table in the granularity branch",
    () => {
      return Effect.gen(function* () {
        const result = yield* buildQueryMetrics(
          { granularity: "5m" },
          "network_metrics_test_2"
        );

        expect(result.query).toContain("FROM network_metrics_test_2");
      });
    }
  );

  it("buildQuerySpeedtests targets a custom table when provided", () => {
    const result = buildQuerySpeedtests({}, "network_metrics_test_2");

    expect(result.query).toContain("FROM network_metrics_test_2");
  });

  it.effect(
    "buildQueryConnectivityStatus targets a custom table when provided",
    () => {
      return Effect.gen(function* () {
        const result = yield* buildQueryConnectivityStatus(
          {},
          "network_metrics_test_2"
        );

        expect(result.query).toContain("FROM network_metrics_test_2");
      });
    }
  );

  it.effect("defaults to the canonical network_metrics table", () => {
    return Effect.gen(function* () {
      const metrics = yield* buildQueryMetrics({});
      const speedtests = buildQuerySpeedtests({});
      const connectivity = yield* buildQueryConnectivityStatus({});

      expect(metrics.query).toContain("FROM network_metrics");
      expect(speedtests.query).toContain("FROM network_metrics");
      expect(connectivity.query).toContain("FROM network_metrics");
    });
  });
});
