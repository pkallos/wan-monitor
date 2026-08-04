// Ambient types for a deep import into ECharts' internals
// (`echarts/lib/scale/Time.js`), used only by options.test.ts to generate
// real tick data for regression tests. Not part of the package's public
// type exports, so it isn't declared anywhere the package itself ships.
declare module "echarts/lib/scale/Time.js" {
  type PrimaryTimeUnit =
    | "year"
    | "month"
    | "day"
    | "hour"
    | "minute"
    | "second"
    | "millisecond";

  interface TimeScaleTick {
    value: number;
    time?: {
      level: number;
      lowerTimeUnit: PrimaryTimeUnit;
      upperTimeUnit: PrimaryTimeUnit;
    };
  }

  export default class TimeScale {
    constructor(setting: { locale: unknown; useUTC: boolean });
    setExtent(start: number, end: number): void;
    getTicks(): TimeScaleTick[];
  }

  export function calcNiceForTimeScale(
    scale: TimeScale,
    opt: { splitNumber: number }
  ): void;
}
