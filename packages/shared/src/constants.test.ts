import { GetConnectivityStatusQuery } from "@shared/api/routes/connectivity-status";
import { GetMetricsQueryParams } from "@shared/api/routes/metrics";
import {
  isValidGranularity,
  PACKET_LOSS_THRESHOLDS,
  VALID_GRANULARITIES,
} from "@shared/constants";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

/** Flattens a schema AST down to the string literals it accepts. */
const acceptedLiterals = (ast: {
  _tag: string;
  literal?: unknown;
  types?: unknown[];
}): string[] => {
  if (ast._tag === "Literal") return [String(ast.literal)];
  if (ast._tag === "Union") {
    return (ast.types ?? []).flatMap((type) =>
      acceptedLiterals(type as Parameters<typeof acceptedLiterals>[0])
    );
  }
  return [];
};

describe("VALID_GRANULARITIES", () => {
  it("lists the six supported bucket widths", () => {
    expect(VALID_GRANULARITIES).toEqual(["1m", "5m", "15m", "1h", "6h", "1d"]);
  });
});

describe("isValidGranularity", () => {
  it.each(VALID_GRANULARITIES)("accepts %s", (granularity) => {
    expect(isValidGranularity(granularity)).toBe(true);
  });

  it.each(["invalid", "", "2m"])("rejects %j", (value) => {
    expect(isValidGranularity(value)).toBe(false);
  });
});

describe("PACKET_LOSS_THRESHOLDS", () => {
  it("marks samples degraded from 10% loss up to 50%", () => {
    expect(PACKET_LOSS_THRESHOLDS.degradedFloor).toBe(10);
    expect(PACKET_LOSS_THRESHOLDS.degradedCeiling).toBe(50);
  });

  it("keeps the degraded band non-empty", () => {
    expect(PACKET_LOSS_THRESHOLDS.degradedFloor).toBeLessThan(
      PACKET_LOSS_THRESHOLDS.degradedCeiling
    );
  });
});

/**
 * The granularity literals are spelled out again in every query schema, so
 * these guard against one copy drifting from `VALID_GRANULARITIES`.
 */
describe.each([
  ["metrics", GetMetricsQueryParams],
  ["connectivity-status", GetConnectivityStatusQuery],
] as const)("%s query granularity", (_name, query) => {
  const granularity = (
    query as unknown as {
      fields: Record<string, { ast: Parameters<typeof acceptedLiterals>[0] }>;
    }
  ).fields.granularity;

  it("accepts exactly VALID_GRANULARITIES", () => {
    expect(acceptedLiterals(granularity.ast)).toEqual(VALID_GRANULARITIES);
  });

  it("decodes every valid granularity and rejects unknown ones", () => {
    const decode = Schema.decodeUnknownSync(query as never);

    for (const value of VALID_GRANULARITIES) {
      expect(decode({ granularity: value })).toMatchObject({
        granularity: value,
      });
    }

    expect(() => decode({ granularity: "2m" })).toThrow();
  });
});
