import type { Outage } from "@shared/api/routes/connectivity-status";
import type { Granularity } from "@shared/api/routes/metrics";
import type { GetSummaryResponseType } from "@shared/api/routes/summary";
import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import { speedtestBucketOf } from "@/dashboard/dateRange";
import { type SummaryDeltas, summaryDeltas } from "@/dashboard/deltas";
import { openIncident } from "@/dashboard/incidents";
import type { RangeRequest } from "@/dashboard/message";
import {
  answersCurrentRange,
  type ConnectivityStatusData,
  type Model,
  type OutagesData,
  type RangeScope,
} from "@/dashboard/model";
import { type ConnectionState, lastSampleText } from "@/dashboard/overview";

/** The summary, once it answers the selected range: an older range's figures are not this range's. */
export const summaryOf = (
  model: Model
): Option.Option<GetSummaryResponseType> =>
  Option.map(
    Option.filter(AsyncData.getData(model.summary), ({ request }) =>
      answersCurrentRange(model, request)
    ),
    ({ summary }) => summary
  );

/** The uptime over the fixed trailing windows, which no selected range changes. */
export const trailingWindowsOf = (
  model: Model
): Option.Option<GetSummaryResponseType["windows"]> =>
  Option.map(
    AsyncData.getData(model.summary),
    ({ summary }) => summary.windows
  );

export const deltasOf = (model: Model): Option.Option<SummaryDeltas> =>
  Option.map(summaryOf(model), ({ range, previous, speed, previousSpeed }) =>
    summaryDeltas(range, previous, speed, previousSpeed)
  );

/** The connectivity window, once it answers the selected range. */
export const currentConnectivity = (
  model: Model
): Option.Option<ConnectivityStatusData> =>
  Option.filter(AsyncData.getData(model.connectivityStatus), ({ request }) =>
    answersCurrentRange(model, request)
  );

/** The outage log, once it answers `scope`: the selected range, or the window a ribbon is drawn from. */
export const outagesFor = (
  outages: Model["outages"],
  scope: RangeScope
): Option.Option<OutagesData> =>
  Option.filter(AsyncData.getData(outages), ({ request }) =>
    answersCurrentRange(scope, request)
  );

export const currentOutages = (model: Model): Option.Option<OutagesData> =>
  outagesFor(model.outages, model);

export const outagesFrom = (
  maybeOutages: Option.Option<OutagesData>
): ReadonlyArray<Outage> =>
  Option.match(maybeOutages, {
    onNone: () => [],
    onSome: ({ log }) => log.data,
  });

/** The configured targets by name, from the hosts list or else the summary's per-host rows. */
export const configuredHostsFrom = (
  pingHosts: Model["pingHosts"],
  summary: Model["summary"]
): Option.Option<ReadonlyArray<string>> =>
  Option.match(AsyncData.getData(pingHosts), {
    onSome: ({ hosts }) => Option.some(hosts),
    onNone: () =>
      Option.map(AsyncData.getData(summary), ({ summary: { hosts } }) =>
        Array_.map(hosts, ({ host }) => host)
      ),
  });

export const configuredHosts = (
  model: Model
): Option.Option<ReadonlyArray<string>> =>
  configuredHostsFrom(model.pingHosts, model.summary);

/**
 * The live status. A failed fetch says nothing about the WAN, so it reads as
 * the same grey "No data" the server reports for a silent monitor, never as an
 * outage. That holds when the failure follows a good answer too: a status the
 * latest fetch could not confirm is not shown as "Online".
 */
const connectionStateFrom = (
  live: Model["liveConnectivity"]
): ConnectionState =>
  AsyncData.match(live, {
    onIdle: () => "checking",
    onLoading: () => "checking",
    onRefreshing: ({ status }) => status,
    onFailure: () => "noInfo",
    onStale: () => "noInfo",
    onSuccess: ({ status }) => status,
  });

export const connectionOf = (model: Model): ConnectionState =>
  connectionStateFrom(model.liveConnectivity);

/** When the monitor last reported; nothing while there is no answer to read it from. */
export const lastSampleOf = (
  model: Model,
  nowMs: number
): Option.Option<string> =>
  AsyncData.match(model.liveConnectivity, {
    onIdle: () => Option.none(),
    onLoading: () => Option.none(),
    onRefreshing: ({ status, maybeLastSampleAtMs }) =>
      lastSampleText(status, maybeLastSampleAtMs, nowMs),
    onFailure: () => Option.none(),
    onStale: () => Option.none(),
    onSuccess: ({ status, maybeLastSampleAtMs }) =>
      lastSampleText(status, maybeLastSampleAtMs, nowMs),
  });

/** The ping interval the host list reports, which sets how stale a running incident's last cycle may be. */
const pingIntervalOf = (pingHosts: Model["pingHosts"]): Option.Option<number> =>
  Option.map(
    AsyncData.getData(pingHosts),
    ({ pingIntervalSeconds }) => pingIntervalSeconds
  );

/** The incident still running, once the log has loaded and the connection has not recovered. */
export const openIncidentFrom = (
  maybeOutages: Option.Option<OutagesData>,
  live: Model["liveConnectivity"],
  pingHosts: Model["pingHosts"]
): Option.Option<Outage> =>
  Option.flatMap(maybeOutages, (data) =>
    openIncident(data, connectionStateFrom(live), pingIntervalOf(pingHosts))
  );

export const openIncidentOf = (model: Model): Option.Option<Outage> =>
  openIncidentFrom(
    currentOutages(model),
    model.liveConnectivity,
    model.pingHosts
  );

/**
 * Data fetched for the selected range. While a newer range loads, or after its
 * fetch failed, what the model still holds belongs to an older range: it reads
 * as loading, or as failed once the fetch for the selected range has failed.
 */
const answeringRange = <A>(
  scope: RangeScope,
  data: AsyncData.AsyncData<A, string>,
  maybeAnswered: Option.Option<RangeRequest>
): AsyncData.AsyncData<A, string> =>
  Option.exists(maybeAnswered, (request) => answersCurrentRange(scope, request))
    ? data
    : AsyncData.match(data, {
        onIdle: () => data,
        onLoading: () => data,
        onFailure: () => data,
        onRefreshing: () => AsyncData.Loading(),
        onSuccess: () => AsyncData.Loading(),
        onStale: ({ error }) => AsyncData.Failure({ error }),
      });

export const metricsFor = (model: Model): Model["metrics"] =>
  answeringRange(
    model,
    model.metrics,
    Option.map(model.maybeMetricsWindow, ({ request }) => request)
  );

export const speedtestHistoryFor = (model: Model): Model["speedtestHistory"] =>
  answeringRange(
    model,
    model.speedtestHistory,
    Option.map(model.maybeSpeedtestWindow, ({ request }) => request)
  );

/** The bucket size the speed history came in; none when it holds raw tests. */
export const speedtestBucketFor = (model: Model): Option.Option<Granularity> =>
  Option.flatMap(model.maybeSpeedtestWindow, speedtestBucketOf);

export const hostLatencyFor = (model: Model): Model["hostLatency"] =>
  answeringRange(
    model,
    model.hostLatency,
    Option.map(
      AsyncData.getData(model.hostLatency),
      ({ window }) => window.request
    )
  );
