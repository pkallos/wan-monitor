import { Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { type Cell, cellBody, cellTitle } from "@/dashboard/connectivity";
import { type Message, PressedRibbonKey } from "@/dashboard/message";
import type { ConnectivityStatusData } from "@/dashboard/model";

export const CURRENT_OUTLINE =
  "relative z-10 outline outline-[1.5px] outline-dashed outline-offset-1 outline-ink";

export const SELECTED_OUTLINE =
  "relative z-10 outline outline-2 outline-offset-1 outline-ink";

/** A cell in one phrase, for a screen reader: when, then its status and shares. */
export const describeCell = (
  cell: Cell,
  granularity: ConnectivityStatusData["granularity"]
): string => `${cellTitle(cell, granularity)}, ${cellBody(cell)}`;

const HANDLED_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Escape",
]);

/** Arrow keys, Home and End move the pinned cell and Escape clears it. */
export const ribbonKeys = (h: HtmlBuilder<Message>) =>
  h.OnKeyDownPreventDefault((key) =>
    HANDLED_KEYS.has(key)
      ? Option.some(PressedRibbonKey({ key }))
      : Option.none()
  );
