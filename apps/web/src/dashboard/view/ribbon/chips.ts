import { Array as Array_, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { CELL_LABELS } from "@/dashboard/connectivity";
import { formatDateTime, formatDuration } from "@/dashboard/format";
import { affectedHostsText, lossText } from "@/dashboard/incidents";
import { type Message, ToggledConnectivitySegment } from "@/dashboard/message";
import {
  CHIP_OVERHANG_PX,
  type ChipPlacement,
  type IncidentChip,
  layoutChips,
} from "@/dashboard/ribbon";
import {
  derive,
  type SelectedArgs,
  splitSelected,
} from "@/dashboard/view/ribbon/source";
import { refBadge } from "@/ui/refBadge";

const TOUCH_BADGE_PX = 26;
const CHIP_BADGE_INSET_PX = 8;
const LEADER_PX = 8;
const LANE_PX = 38;
const FIRST_LANE_PX = 50;

const CHIP_BORDERS = {
  down: "border-down",
  degraded: "border-deg",
} as const;

const chipAria = (
  chip: IncidentChip,
  hosts: Option.Option<ReadonlyArray<string>>
): string => {
  const { outage } = chip;
  const when = chip.isOngoing
    ? `${formatDateTime(outage.start)}, ongoing`
    : `${formatDateTime(outage.start)} to ${formatDateTime(outage.end)}, ${formatDuration(outage.durationSeconds)}`;
  const hostsClause =
    outage.affectedHosts.length === 0
      ? ""
      : ` Hosts: ${affectedHostsText(outage.affectedHosts, hosts)}.`;
  return `Incident ${chip.ref}: ${CELL_LABELS[chip.status]}, ${when}.${hostsClause} Max loss ${lossText(outage.maxPacketLoss)}. Show on ribbon`;
};

/** One incident's chip: sized by its duration beside the ribbon, a 44px touch target below it. */
export const chipButton = (
  h: HtmlBuilder<Message>,
  chip: IncidentChip,
  isSelected: boolean,
  hosts: Option.Option<ReadonlyArray<string>>,
  size: "sized" | "touch"
): Html => {
  const isTouch = size === "touch";
  return h.button(
    [
      h.Type("button"),
      h.DataAttribute(
        "testid",
        `${isTouch ? "incident-chip-touch" : "incident-chip"}-${chip.ref}`
      ),
      h.AriaLabel(chipAria(chip, hosts)),
      h.AriaPressed(String(isSelected)),
      h.OnClick(ToggledConnectivitySegment({ startMs: chip.bucketStartMs })),
      h.Class(
        `inline-flex cursor-pointer items-center whitespace-nowrap rounded-full bg-card font-semibold text-ink ${
          isSelected
            ? "border-2 border-ink"
            : `border-[1.5px] ${CHIP_BORDERS[chip.status]}`
        } ${isTouch ? "h-11 gap-1.5 pl-2 pr-3 text-sm" : "gap-1.5 pl-[3px] pr-[9px]"}`
      ),
      ...(isTouch
        ? []
        : [
            h.Style({
              height: `${chip.heightPx}px`,
              fontSize: `${12 + Math.round((chip.heightPx - 22) / 6)}px`,
            }),
          ]),
    ],
    [
      refBadge(
        h,
        chip.ref,
        chip.status,
        isTouch ? TOUCH_BADGE_PX : chip.heightPx - CHIP_BADGE_INSET_PX
      ),
      h.span([], [chip.label]),
    ]
  );
};

const anchorStyle = ({
  anchor,
  centerFraction,
}: ChipPlacement): Record<string, string> => {
  const left = `${centerFraction * 100}%`;
  switch (anchor) {
    case "right":
      return { right: "0" };
    case "end":
      return {
        left,
        transform: `translateX(calc(-100% + ${CHIP_OVERHANG_PX}px))`,
      };
    case "start":
      return { left, transform: `translateX(-${CHIP_OVERHANG_PX}px)` };
    case "center":
      return { left, transform: "translateX(-50%)" };
  }
};

/** One line per incident a cluster chip stands for. */
const clusterLines = (
  members: ReadonlyArray<IncidentChip>
): ReadonlyArray<string> =>
  Array_.map(
    members,
    (chip) => `${chip.ref}: ${CELL_LABELS[chip.status]}, ${chip.label}`
  );

const clusterButton = (
  h: HtmlBuilder<Message>,
  placement: ChipPlacement,
  isSelected: boolean
): Html => {
  const first = placement.chips[0];
  const last = placement.chips[placement.chips.length - 1];
  return h.button(
    [
      h.Type("button"),
      h.DataAttribute("testid", `incident-chip-cluster-${first.ref}`),
      h.AriaLabel(
        `Incidents ${first.ref} to ${last.ref}: ${placement.chips.length} incidents starting ${formatDateTime(first.outage.start)}. ${clusterLines(placement.chips).join("; ")}. Show the first on ribbon`
      ),
      h.AriaPressed(String(isSelected)),
      h.OnClick(ToggledConnectivitySegment({ startMs: placement.pinStartMs })),
      h.Class(
        `inline-flex h-[26px] cursor-pointer items-center whitespace-nowrap rounded-full bg-card px-2.5 text-xs font-bold text-ink ${
          isSelected ? "border-2 border-ink" : "border-[1.5px] border-ink-2"
        }`
      ),
    ],
    [placement.label]
  );
};

const leaderColor = (chip: IncidentChip, isSelected: boolean): string =>
  isSelected ? "bg-ink" : chip.status === "down" ? "bg-down" : "bg-deg";

/** The chips above the ribbon, each tied to its cell by a leader line. */
export const chipLane = (h: HtmlBuilder<Message>, ...args: SelectedArgs) => {
  const { source, selectedIndex } = splitSelected(args);
  const { chips, hosts } = derive(source);
  const placements = layoutChips(chips, source.ribbonWidthPx);
  const hasSecondLane = Array_.some(placements, ({ lane }) => lane === 1);
  return h.div(
    [
      h.Class("relative"),
      h.Style({
        height: `${FIRST_LANE_PX + (hasSecondLane ? LANE_PX : 0)}px`,
      }),
    ],
    Array_.flatMap(placements, (placement) => {
      const laneOffsetPx = placement.lane * LANE_PX;
      const isSelected = Array_.some(
        placement.chips,
        (chip) => chip.cellIndex === selectedIndex
      );
      const [only] = placement.chips;
      return [
        h.div(
          [
            h.Class("absolute z-10"),
            h.Style({
              bottom: `${LEADER_PX + laneOffsetPx}px`,
              ...anchorStyle(placement),
            }),
          ],
          [
            placement.chips.length === 1
              ? chipButton(h, only, isSelected, hosts, "sized")
              : clusterButton(
                  h,
                  placement,
                  placement.pinIndex === selectedIndex
                ),
          ]
        ),
        ...Array_.map(placement.chips, (chip) =>
          h.span(
            [
              h.AriaHidden(true),
              h.Class(
                `absolute bottom-0 w-[1.5px] ${leaderColor(chip, chip.cellIndex === selectedIndex)}`
              ),
              h.Style({
                height: `${LEADER_PX + laneOffsetPx}px`,
                left: `calc(${chip.centerFraction * 100}% - 0.75px)`,
              }),
            ],
            []
          )
        ),
      ];
    })
  );
};

/** What a cluster chip stands for, one line per incident, when its first one is the cell shown. */
export const clusterLinesFor = (
  chips: ReadonlyArray<IncidentChip>,
  index: number,
  ribbonWidth: number
): ReadonlyArray<string> =>
  Option.match(
    Array_.findFirst(
      layoutChips(chips, ribbonWidth),
      (placement) => placement.chips.length > 1 && placement.pinIndex === index
    ),
    {
      onNone: () => [],
      onSome: ({ chips: members }) => clusterLines(members),
    }
  );
