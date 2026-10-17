import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  affectedHostsText,
  assignIncidents,
  describeTotals,
  lossText,
  openIncident,
  openIncidentParts,
  outageLogPhrase,
  outageTotals,
  outageWindow,
  peakText,
  refLabel,
} from "@/dashboard/incidents";

const outage = (
  overrides: Partial<Parameters<typeof assignIncidents>[0][number]> = {}
) => ({
  start: "2026-10-09T02:00:00.000Z",
  end: "2026-10-09T02:06:00.000Z",
  durationSeconds: 360,
  status: "down" as const,
  affectedHosts: ["1.1.1.1", "8.8.8.8"],
  maxPacketLoss: 100,
  peakLatency: null,
  ...overrides,
});

describe("refLabel", () => {
  test.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("labels index %i as %s", (index, label) => {
    expect(refLabel(index)).toBe(label);
  });
});

describe("assignIncidents", () => {
  const newest = outage({
    start: "2026-10-14T23:00:00.000Z",
    end: "2026-10-14T23:10:00.000Z",
  });
  const middle = outage({
    start: "2026-10-11T19:00:00.000Z",
    end: "2026-10-11T20:00:00.000Z",
    status: "degraded",
  });
  const oldest = outage();

  test("letters the oldest outage A so a new outage never renames an old one", () => {
    const refs = assignIncidents([newest, middle, oldest]).map((i) => i.ref);

    expect(refs).toEqual(["C", "B", "A"]);
    expect(
      assignIncidents([
        outage({
          start: "2026-10-15T09:00:00.000Z",
          end: "2026-10-15T09:01:00.000Z",
        }),
        newest,
        middle,
        oldest,
      ]).map((i) => i.ref)
    ).toEqual(["D", "C", "B", "A"]);
  });

  test("keeps the newest-first order the endpoint returns", () => {
    expect(
      assignIncidents([newest, middle, oldest]).map((i) => i.startMs)
    ).toEqual([
      Date.parse(newest.start),
      Date.parse(middle.start),
      Date.parse(oldest.start),
    ]);
  });

  test("carries the span and status the charts mark", () => {
    const [incident] = assignIncidents([oldest]);

    expect(incident).toEqual({
      ref: "A",
      startMs: Date.parse(oldest.start),
      endMs: Date.parse(oldest.end),
      status: "down",
    });
  });

  test("is empty with no outages", () => {
    expect(assignIncidents([])).toEqual([]);
  });
});

describe("outageTotals and describeTotals", () => {
  const log = [
    outage({ durationSeconds: 600 }),
    outage({ durationSeconds: 510 }),
    outage({ status: "degraded", durationSeconds: 3600 }),
    outage({ status: "degraded", durationSeconds: 1800 }),
  ];

  test("counts outages and degraded periods apart and sums only down time", () => {
    expect(outageTotals(log)).toEqual({
      outageCount: 2,
      degradedCount: 2,
      downSeconds: 1110,
    });
  });

  test("words the totals the way the log's footnote reads", () => {
    expect(describeTotals(outageTotals(log))).toBe(
      "2 down, 2 degraded, 18m 30s down"
    );
  });

  test("uses the singular for one of each", () => {
    expect(
      describeTotals({ outageCount: 1, degradedCount: 1, downSeconds: 60 })
    ).toBe("1 down, 1 degraded, 1m down");
  });

  test("leaves out a kind that did not happen", () => {
    expect(
      describeTotals({ outageCount: 0, degradedCount: 2, downSeconds: 0 })
    ).toBe("2 degraded");
    expect(
      describeTotals({ outageCount: 1, degradedCount: 0, downSeconds: 390 })
    ).toBe("1 down, 6m 30s down");
  });

  test("says so when nothing happened", () => {
    expect(
      describeTotals({ outageCount: 0, degradedCount: 0, downSeconds: 0 })
    ).toBe("No incidents");
  });
});

describe("outageWindow", () => {
  test("passes a window inside the limit through untouched", () => {
    const window = {
      startTime: "2026-10-01T00:00:00.000Z",
      endTime: "2026-10-15T00:00:00.000Z",
    };

    expect(outageWindow(window)).toEqual({ ...window, isClamped: false });
  });

  test("accepts a window of exactly the limit", () => {
    const window = {
      startTime: "2026-07-17T00:00:00.000Z",
      endTime: "2026-10-15T00:00:00.000Z",
    };

    expect(outageWindow(window).isClamped).toBe(false);
  });

  test("keeps the newest 90 days of a longer window, flagged as clamped", () => {
    const result = outageWindow({
      startTime: "2025-01-01T00:00:00.000Z",
      endTime: "2026-10-15T00:00:00.000Z",
    });

    expect(result).toEqual({
      startTime: "2026-07-17T00:00:00.000Z",
      endTime: "2026-10-15T00:00:00.000Z",
      isClamped: true,
    });
  });
});

describe("affectedHostsText", () => {
  const configured = Option.some(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);

  test("lists the hosts that failed", () => {
    expect(affectedHostsText(["1.1.1.1", "8.8.8.8"], configured)).toBe(
      "1.1.1.1, 8.8.8.8"
    );
  });

  test("says all hosts when every configured target was hit", () => {
    expect(
      affectedHostsText(["9.9.9.9", "1.1.1.1", "8.8.8.8"], configured)
    ).toBe("All 3 hosts");
  });

  test("lists the hosts when as many failed as are configured but they are not the configured ones", () => {
    expect(affectedHostsText(["a", "b", "c"], configured)).toBe("a, b, c");
  });

  test("says all hosts when the configured ones were hit along with one no longer configured", () => {
    expect(
      affectedHostsText(
        ["1.1.1.1", "8.8.8.8", "9.9.9.9", "retired"],
        configured
      )
    ).toBe("All 3 hosts");
  });

  test("names the host when only one is configured", () => {
    expect(affectedHostsText(["a"], Option.some(["a"]))).toBe("a");
  });

  test("lists the hosts when the configured ones are unknown", () => {
    expect(affectedHostsText(["a", "b"], Option.none())).toBe("a, b");
  });

  test("has a dash when no host is recorded", () => {
    expect(affectedHostsText([], configured)).toBe("-");
  });
});

describe("outageLogPhrase", () => {
  test("uses the range's own phrase when the whole range was asked for", () => {
    expect(outageLogPhrase(false, "the last 30 days")).toBe("the last 30 days");
  });

  test("names the 90 days actually covered when the request was clamped", () => {
    expect(outageLogPhrase(true, "all time")).toBe("the last 90 days");
  });
});

describe("lossText and peakText", () => {
  test("keeps a whole loss whole and a fractional one to one decimal", () => {
    expect(lossText(100)).toBe("100%");
    expect(lossText(12.34)).toBe("12.3%");
  });

  test("rounds the peak to whole milliseconds and dashes a run with no replies", () => {
    expect(peakText(61.4)).toBe("61 ms");
    expect(peakText(null)).toBe("-");
  });
});

describe("openIncident", () => {
  const FETCHED_AT = "2026-10-15T12:00:00.000Z";
  const FETCHED_AT_MS = Date.parse(FETCHED_AT);
  const logEndingAt = (
    endTime: string,
    ...outages: ReadonlyArray<ReturnType<typeof outage>>
  ) => ({
    log: {
      data: outages,
      meta: {
        startTime: "2026-10-08T12:00:00.000Z",
        endTime,
        count: outages.length,
        totalCount: outages.length,
      },
    },
    fetchedAtMs: FETCHED_AT_MS,
  });
  const log = (...outages: ReadonlyArray<ReturnType<typeof outage>>) =>
    logEndingAt(FETCHED_AT, ...outages);
  const running = outage({
    start: "2026-10-15T11:30:00.000Z",
    end: FETCHED_AT,
    status: "degraded",
  });
  const finished = outage({
    start: "2026-10-14T09:00:00.000Z",
    end: "2026-10-14T09:10:00.000Z",
  });

  test("is the newest incident the server cut off at the end of the range", () => {
    expect(
      openIncident(log(running, finished), "degraded", Option.none())
    ).toEqual(Option.some(running));
  });

  test("is none when the newest incident ended before the range did", () => {
    expect(openIncident(log(finished), "down", Option.none())).toEqual(
      Option.none()
    );
  });

  test("is none while the live status says the connection is up", () => {
    expect(openIncident(log(running), "up", Option.none())).toEqual(
      Option.none()
    );
  });

  test("is none while the monitor is silent or still checking", () => {
    expect(openIncident(log(running), "noInfo", Option.none())).toEqual(
      Option.none()
    );
    expect(openIncident(log(running), "checking", Option.none())).toEqual(
      Option.none()
    );
  });

  test("is none for an empty log", () => {
    expect(openIncident(log(), "down", Option.none())).toEqual(Option.none());
  });

  test("shows a running outage in a custom range that ends later today", () => {
    const endsTonight = "2026-10-16T07:00:00.000Z";
    const runningToTheNextCycle = outage({
      start: "2026-10-15T11:30:00.000Z",
      end: "2026-10-15T12:00:30.000Z",
      status: "down",
    });

    expect(
      openIncident(
        logEndingAt(endsTonight, runningToTheNextCycle),
        "down",
        Option.none()
      )
    ).toEqual(Option.some(runningToTheNextCycle));
  });

  test("tolerates a ping cycle that arrived a little late", () => {
    const lateCycle = outage({
      start: "2026-10-15T11:30:00.000Z",
      end: "2026-10-15T11:59:20.000Z",
      status: "down",
    });

    expect(
      openIncident(
        logEndingAt("2026-10-16T07:00:00.000Z", lateCycle),
        "down",
        Option.none()
      )
    ).toEqual(Option.some(lateCycle));
  });

  test("is none in a future-ending range when the newest incident ended well before now", () => {
    const earlier = outage({
      start: "2026-10-15T09:00:00.000Z",
      end: "2026-10-15T09:10:00.000Z",
    });

    expect(
      openIncident(
        logEndingAt("2026-10-16T07:00:00.000Z", earlier),
        "down",
        Option.none()
      )
    ).toEqual(Option.none());
  });

  test("is none for a past range even while the connection is down now", () => {
    const pastRangeEnd = "2026-10-12T00:00:00.000Z";
    const clippedAtRangeEnd = outage({
      start: "2026-10-11T23:50:00.000Z",
      end: pastRangeEnd,
    });

    expect(
      openIncident(
        logEndingAt(pastRangeEnd, clippedAtRangeEnd),
        "down",
        Option.none()
      )
    ).toEqual(Option.none());
  });

  test("tolerates a cycle as late as the live window allows, two ping intervals", () => {
    const missedACycle = outage({
      start: "2026-10-15T11:30:00.000Z",
      end: "2026-10-15T11:51:00.000Z",
      status: "down",
    });
    const slowMonitor = Option.some(600);

    expect(openIncident(log(missedACycle), "down", slowMonitor)).toEqual(
      Option.some(missedACycle)
    );
    expect(openIncident(log(missedACycle), "down", Option.some(30))).toEqual(
      Option.none()
    );
  });

  test("falls back to the 60 second floor while the ping interval is unknown", () => {
    const lateCycle = outage({
      start: "2026-10-15T11:30:00.000Z",
      end: "2026-10-15T11:58:30.000Z",
      status: "down",
    });

    expect(openIncident(log(lateCycle), "down", Option.none())).toEqual(
      Option.none()
    );
    expect(openIncident(log(lateCycle), "down", Option.some(60))).toEqual(
      Option.some(lateCycle)
    );
  });
});

describe("openIncidentParts", () => {
  const at = (hour: number, minute: number, day = 15) =>
    new Date(2026, 9, day, hour, minute);
  const open = (overrides: Partial<ReturnType<typeof outage>> = {}) =>
    outage({
      start: at(14, 29).toISOString(),
      status: "degraded",
      affectedHosts: ["1.1.1.1"],
      maxPacketLoss: 20,
      ...overrides,
    });
  const now = at(14, 40).getTime();
  const configured = Option.some(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);

  test("gives the start time, then the failing hosts and the worst loss", () => {
    expect(openIncidentParts(open(), configured, now)).toEqual({
      since: "Since 2:29 PM",
      details: ["1.1.1.1", "up to 20% loss"],
    });
  });

  test("names the date when the incident began on an earlier day", () => {
    const earlier = open({ start: at(23, 51, 14).toISOString() });
    const date = at(23, 51, 14).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });

    expect(openIncidentParts(earlier, configured, now).since).toBe(
      `Since ${date}, 11:51 PM`
    );
  });

  test("says all hosts when every configured target is affected", () => {
    const all = open({ affectedHosts: ["1.1.1.1", "8.8.8.8", "9.9.9.9"] });

    expect(openIncidentParts(all, configured, now).details).toEqual([
      "All 3 hosts",
      "up to 20% loss",
    ]);
  });

  test("leaves out the details the incident does not have", () => {
    const bare = open({ affectedHosts: [], maxPacketLoss: 0 });

    expect(openIncidentParts(bare, Option.none(), now)).toEqual({
      since: "Since 2:29 PM",
      details: [],
    });
  });
});
