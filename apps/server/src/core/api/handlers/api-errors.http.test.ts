import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatabaseQueryError,
  DatabaseUnavailable,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import { makeTestApp, stubQuestDB, type TestApp } from "@/test/http-app";

const DRIVER_UNAVAILABLE = "connect ECONNREFUSED 127.0.0.1:8812";
const DRIVER_FAILURE = "relation secret_table does not exist";

const endpoints = [
  ["/api/metrics", "queryMetrics"],
  ["/api/metrics/earliest", "queryEarliestTimestamp"],
  ["/api/connectivity-status", "queryConnectivityStatus"],
  ["/api/connectivity-status/live", "queryLiveConnectivity"],
  ["/api/connectivity-status/outages", "queryOutageRuns"],
  ["/api/summary", "querySummaryStats"],
  ["/api/summary", "queryWindowUptime"],
  ["/api/speedtest/history", "querySpeedtests"],
] as const satisfies readonly [string, keyof QuestDBService][];

describe.each(endpoints)("GET %s when %s fails", (path, query) => {
  let app: TestApp;

  afterEach(async () => {
    await app.dispose();
  });

  const request = (failure: DatabaseUnavailable | DatabaseQueryError) => {
    app = makeTestApp(stubQuestDB({ [query]: () => Effect.fail(failure) }));
    return app.handler(new Request(`http://localhost${path}`));
  };

  it("answers 503 DbUnavailable without the driver's message", async () => {
    const response = await request(
      new DatabaseUnavailable({ message: DRIVER_UNAVAILABLE })
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      _tag: "DbUnavailable",
      message: "Database temporarily unavailable",
    });
    expect(text).not.toContain("ECONNREFUSED");
  });

  it("answers 500 InternalError without the database's error text", async () => {
    const response = await request(
      new DatabaseQueryError({
        message: `Failed to query ${query}: ${DRIVER_FAILURE}`,
      })
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      _tag: "InternalError",
      message: "Internal server error",
    });
    expect(text).not.toContain("secret_table");
  });
});
