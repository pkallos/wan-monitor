import { RadioGroup } from "@foldkit/ui";
import { LatencyView } from "@/dashboard/latencyView";

export const LatencyViewRadioGroup = RadioGroup.create<LatencyView>();

/** Display order of the latency view toggle. */
export const LATENCY_VIEWS: ReadonlyArray<LatencyView> = LatencyView.literals;
