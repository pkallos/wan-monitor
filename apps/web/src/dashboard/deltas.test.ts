import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { type DeltaInput, makeDelta, summaryDeltas } from "@/dashboard/deltas";

const LATENCY: Omit<DeltaInput, "current" | "previous"> = {
  higherIsBetter: false,
  unit: "ms",
  decimals: 1,
  steadyBelow: 0.5,
};

describe("makeDelta", () => {
  test("is absent when either side is unknown", () => {
    expect(makeDelta({ ...LATENCY, current: null, previous: 10 })).toEqual(
      Option.none()
    );
    expect(makeDelta({ ...LATENCY, current: 10, previous: null })).toEqual(
      Option.none()
    );
  });

  test("calls a rise in latency worse, with a signed value and the baseline", () => {
    expect(makeDelta({ ...LATENCY, current: 14.2, previous: 13.1 })).toEqual(
      Option.some({
        text: "+1.1 ms",
        word: "worse",
        tone: "bad",
        rest: "vs 13.1 ms prev.",
      })
    );
  });

  test("calls a fall in latency better and signs it with a true minus", () => {
    expect(makeDelta({ ...LATENCY, current: 10, previous: 12.5 })).toEqual(
      Option.some({
        text: "−2.5 ms",
        word: "better",
        tone: "good",
        rest: "vs 12.5 ms prev.",
      })
    );
  });

  test("flips good and bad for a metric where higher is better", () => {
    const availability = {
      higherIsBetter: true,
      unit: "pt",
      levelUnit: "%",
      decimals: 2,
      steadyBelow: 0.05,
    };

    expect(
      makeDelta({ ...availability, current: 99.82, previous: 99.95 })
    ).toEqual(
      Option.some({
        text: "−0.13 pt",
        word: "worse",
        tone: "bad",
        rest: "vs 99.95% prev.",
      })
    );
    expect(
      makeDelta({ ...availability, current: 99.99, previous: 99.9 })
    ).toMatchObject({ value: { word: "better", tone: "good" } });
  });

  test("reads as steady, with a neutral tone, inside the threshold", () => {
    expect(makeDelta({ ...LATENCY, current: 13.3, previous: 13.1 })).toEqual(
      Option.some({
        text: "+0.2 ms",
        word: "steady",
        tone: "neutral",
        rest: "vs 13.1 ms prev.",
      })
    );
  });

  test("drops the sign from a change that rounds to zero", () => {
    expect(makeDelta({ ...LATENCY, current: 13.1, previous: 13.14 })).toEqual(
      Option.some({
        text: "0.0 ms",
        word: "steady",
        tone: "neutral",
        rest: "vs 13.1 ms prev.",
      })
    );
    expect(
      makeDelta({ ...LATENCY, current: 13.14, previous: 13.1 })
    ).toMatchObject({ value: { text: "0.0 ms" } });
  });

  test("treats a change of exactly the threshold as a real change", () => {
    expect(
      makeDelta({ ...LATENCY, current: 13.6, previous: 13.1 })
    ).toMatchObject({ value: { word: "worse" } });
  });

  test("takes a change of exactly the threshold as real, not steady", () => {
    expect(
      makeDelta({ ...LATENCY, current: 10.5, previous: 10 })
    ).toMatchObject({ value: { word: "worse" } });
    expect(makeDelta({ ...LATENCY, current: 9.5, previous: 10 })).toMatchObject(
      {
        value: { word: "better" },
      }
    );
  });

  test("shows an identical pair as steady with no sign", () => {
    expect(makeDelta({ ...LATENCY, current: 13.1, previous: 13.1 })).toEqual(
      Option.some({
        text: "0.0 ms",
        word: "steady",
        tone: "neutral",
        rest: "vs 13.1 ms prev.",
      })
    );
  });

  test("measures a change in points but states the level it came from as a percent", () => {
    expect(
      makeDelta({
        higherIsBetter: true,
        unit: "pt",
        levelUnit: "%",
        decimals: 2,
        steadyBelow: 0.05,
        current: 99.55,
        previous: 100,
      })
    ).toEqual(
      Option.some({
        text: "\u22120.45 pt",
        word: "worse",
        tone: "bad",
        rest: "vs 100.00% prev.",
      })
    );
  });

  test("omits the unit space for a percent sign", () => {
    expect(
      makeDelta({
        higherIsBetter: false,
        unit: "%",
        decimals: 2,
        steadyBelow: 0.05,
        current: 0.6,
        previous: 0.2,
      })
    ).toMatchObject({ value: { text: "+0.40%", rest: "vs 0.20% prev." } });
  });
});

describe("summaryDeltas", () => {
  const range = {
    latencyP50: 14.2,
    latencyP95: 31.8,
    avgPacketLoss: 0.5,
    avgJitter: 2,
    uptimePercentage: 99.4,
    availabilityPercentage: 99.8,
    coveragePercentage: 100,
  };
  const previous = {
    ...range,
    latencyP50: 13.1,
    avgPacketLoss: 0.2,
    avgJitter: 2.1,
    uptimePercentage: 99.8,
    availabilityPercentage: 99.95,
  };

  const speed = {
    downloadMedian: 941,
    uploadMedian: 917,
    count: 24,
  };
  const previousSpeed = { ...speed, downloadMedian: 900, uploadMedian: 950 };

  test("compares each figure with the same figure of the previous window", () => {
    const deltas = summaryDeltas(range, previous, speed, previousSpeed);

    expect(deltas.latency).toMatchObject({ value: { word: "worse" } });
    expect(deltas.loss).toMatchObject({
      value: { word: "worse", text: "+0.30 pt", rest: "vs 0.20% prev." },
    });
    expect(deltas.jitter).toMatchObject({ value: { word: "steady" } });
    expect(deltas.availability).toMatchObject({
      value: { word: "worse", text: "\u22120.15 pt", rest: "vs 99.95% prev." },
    });
    expect(deltas.uptime).toMatchObject({
      value: { word: "worse", text: "\u22120.40 pt", rest: "vs 99.80% prev." },
    });
  });

  describe("at each figure's steady threshold", () => {
    const noSpeed = { downloadMedian: null, uploadMedian: null, count: 0 };
    const steadyWords = (overrides: Partial<typeof range>) =>
      Object.fromEntries(
        Object.entries(
          summaryDeltas({ ...range, ...overrides }, range, noSpeed, noSpeed)
        ).map(([name, delta]) => [name, Option.map(delta, (d) => d.word)])
      );

    test("calls jitter 0.35 ms over the previous window worse, and 0.25 ms steady", () => {
      expect(steadyWords({ avgJitter: 2.35 }).jitter).toEqual(
        Option.some("worse")
      );
      expect(steadyWords({ avgJitter: 2.25 }).jitter).toEqual(
        Option.some("steady")
      );
    });

    test("calls latency a real change at 0.5 ms and steady below it", () => {
      expect(steadyWords({ latencyP50: 14.7 }).latency).toEqual(
        Option.some("worse")
      );
      expect(steadyWords({ latencyP50: 14.6 }).latency).toEqual(
        Option.some("steady")
      );
    });

    test.each([
      ["loss", "avgPacketLoss", 0.551, 0.549, 0.449, 0.451],
      [
        "availability",
        "availabilityPercentage",
        99.749,
        99.751,
        99.851,
        99.849,
      ],
      ["uptime", "uptimePercentage", 99.349, 99.351, 99.451, 99.449],
    ] as const)(
      "calls %s worse or better from 0.051 points away and steady at 0.049",
      (name, field, worse, nearWorse, better, nearBetter) => {
        expect(steadyWords({ [field]: worse })[name]).toEqual(
          Option.some("worse")
        );
        expect(steadyWords({ [field]: nearWorse })[name]).toEqual(
          Option.some("steady")
        );
        expect(steadyWords({ [field]: better })[name]).toEqual(
          Option.some("better")
        );
        expect(steadyWords({ [field]: nearBetter })[name]).toEqual(
          Option.some("steady")
        );
      }
    );
  });

  test("has nothing to compare when the previous window held no data", () => {
    const empty = {
      ...previous,
      latencyP50: null,
      avgPacketLoss: null,
      avgJitter: null,
      uptimePercentage: null,
      availabilityPercentage: null,
    };
    const deltas = summaryDeltas(range, empty, speed, previousSpeed);

    expect(deltas.latency).toEqual(Option.none());
    expect(deltas.availability).toEqual(Option.none());
  });

  test("compares the median speeds, a faster download better and a slower upload worse", () => {
    const deltas = summaryDeltas(range, previous, speed, previousSpeed);

    expect(deltas.download).toMatchObject({
      value: { word: "better", text: "+41 Mbps", rest: "vs 900 Mbps prev." },
    });
    expect(deltas.upload).toMatchObject({
      value: {
        word: "worse",
        text: "\u221233 Mbps",
        rest: "vs 950 Mbps prev.",
      },
    });
  });

  test("reads a speed change under 2% as steady", () => {
    const deltas = summaryDeltas(range, previous, speed, {
      ...previousSpeed,
      downloadMedian: 935,
    });

    expect(deltas.download).toMatchObject({ value: { word: "steady" } });
  });

  test("keeps a decimal for speeds under 100 Mbps", () => {
    const deltas = summaryDeltas(
      range,
      previous,
      { ...speed, downloadMedian: 54.3 },
      { ...previousSpeed, downloadMedian: 50.1 }
    );

    expect(deltas.download).toMatchObject({
      value: { text: "+4.2 Mbps", rest: "vs 50.1 Mbps prev." },
    });
  });

  describe("at the speed thresholds", () => {
    const downloadChange = (previousMbps: number, currentMbps: number) =>
      summaryDeltas(
        range,
        previous,
        { ...speed, downloadMedian: currentMbps },
        { ...previousSpeed, downloadMedian: previousMbps }
      ).download;

    test("a change of more than 2% of the previous figure is a verdict", () => {
      expect(downloadChange(50, 51.01)).toMatchObject({
        value: {
          word: "better",
          text: "+1.0 Mbps",
          rest: "vs 50.0 Mbps prev.",
        },
      });
    });

    test("a change of less than 2% of the previous figure is steady", () => {
      expect(downloadChange(50, 50.99)).toMatchObject({
        value: { word: "steady", text: "+1.0 Mbps" },
      });
    });

    test("whole Mbps start at 100 and follow the current figure", () => {
      expect(downloadChange(90, 100)).toMatchObject({
        value: { text: "+10 Mbps", rest: "vs 90 Mbps prev." },
      });
      expect(downloadChange(90, 99.9)).toMatchObject({
        value: { text: "+9.9 Mbps", rest: "vs 90.0 Mbps prev." },
      });
    });
  });

  test("has no speed change when the previous window held no tests", () => {
    const deltas = summaryDeltas(range, previous, speed, {
      ...previousSpeed,
      downloadMedian: null,
      uploadMedian: null,
      count: 0,
    });

    expect(deltas.download).toEqual(Option.none());
    expect(deltas.upload).toEqual(Option.none());
  });
});
