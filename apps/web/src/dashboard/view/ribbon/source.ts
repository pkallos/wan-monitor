import { Option } from "effect";
import { bucketIndexOf, buildCells, type Cell } from "@/dashboard/connectivity";
import type { ConnectivityStatusData, Model } from "@/dashboard/model";
import { type IncidentChip, incidentChips } from "@/dashboard/ribbon";
import {
  configuredHostsFrom,
  openIncidentFrom,
  outagesFor,
  outagesFrom,
} from "@/dashboard/view/derived";

/** What the ribbon is drawn from: the model fields it reads. */
export type Source = Readonly<{
  status: ConnectivityStatusData;
  maybeEarliestDataMs: Model["maybeEarliestDataMs"];
  outages: Model["outages"];
  summary: Model["summary"];
  pingHosts: Model["pingHosts"];
  live: Model["liveConnectivity"];
  nowBucketMs: number;
  ribbonWidthPx: number;
}>;

/**
 * A source as a flat list. A memoized section compares its arguments one by
 * one, so it takes the fields apart rather than one object that is new on
 * every render.
 */
export type SourceArgs = readonly [
  status: Source["status"],
  maybeEarliestDataMs: Source["maybeEarliestDataMs"],
  outages: Source["outages"],
  summary: Source["summary"],
  pingHosts: Source["pingHosts"],
  live: Source["live"],
  nowBucketMs: Source["nowBucketMs"],
  ribbonWidthPx: Source["ribbonWidthPx"],
];

export const sourceArgs = (source: Source): SourceArgs => [
  source.status,
  source.maybeEarliestDataMs,
  source.outages,
  source.summary,
  source.pingHosts,
  source.live,
  source.nowBucketMs,
  source.ribbonWidthPx,
];

export const sourceOf = ([
  status,
  maybeEarliestDataMs,
  outages,
  summary,
  pingHosts,
  live,
  nowBucketMs,
  ribbonWidthPx,
]: SourceArgs): Source => ({
  status,
  maybeEarliestDataMs,
  outages,
  summary,
  pingHosts,
  live,
  nowBucketMs,
  ribbonWidthPx,
});

/** A source followed by the selected cell's index, or -1. */
export type SelectedArgs = readonly [...SourceArgs, selectedIndex: number];

export const selectedArgs = (
  source: Source,
  selectedIndex: number
): SelectedArgs => [...sourceArgs(source), selectedIndex];

export const splitSelected = ([
  status,
  maybeEarliestDataMs,
  outages,
  summary,
  pingHosts,
  live,
  nowBucketMs,
  ribbonWidthPx,
  selectedIndex,
]: SelectedArgs): Readonly<{ source: Source; selectedIndex: number }> => ({
  source: sourceOf([
    status,
    maybeEarliestDataMs,
    outages,
    summary,
    pingHosts,
    live,
    nowBucketMs,
    ribbonWidthPx,
  ]),
  selectedIndex,
});

export type Derived = Readonly<{
  cells: ReadonlyArray<Cell>;
  hosts: Option.Option<ReadonlyArray<string>>;
  chips: ReadonlyArray<IncidentChip>;
}>;

export const derive = (source: Source): Derived => {
  const { status, maybeEarliestDataMs, summary, pingHosts, live } = source;
  const maybeOutages = outagesFor(source.outages, status.request);
  const cells = buildCells(
    status.points,
    status.startTimeMs,
    status.endTimeMs,
    status.granularity,
    maybeEarliestDataMs,
    source.nowBucketMs
  );
  return {
    cells,
    hosts: configuredHostsFrom(pingHosts, summary),
    chips: incidentChips(
      cells,
      outagesFrom(maybeOutages),
      openIncidentFrom(maybeOutages, live, pingHosts)
    ),
  };
};

/** The pinned cell's index, or -1 when none is pinned or it has left the window. */
export const selectedIndexOf = (
  model: Model,
  status: ConnectivityStatusData
): number =>
  Option.getOrElse(
    Option.flatMap(model.maybeSelectedBucketStartMs, (startMs) =>
      bucketIndexOf(status, startMs)
    ),
    () => -1
  );
