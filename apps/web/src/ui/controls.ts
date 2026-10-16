// Touch targets are 44px on small screens and tighten to 40px on desktop.
const TARGET = "min-h-11 lg:min-h-10";

export const PRIMARY_BUTTON_CLASS = `cursor-pointer rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${TARGET}`;

export const SECONDARY_BUTTON_CLASS = `cursor-pointer rounded-xl border border-rule bg-card px-4 text-sm font-semibold text-ink transition-colors hover:bg-field disabled:cursor-not-allowed disabled:opacity-50 ${TARGET}`;

// A white button on the tinted status field, outlined in the field's own rule.
export const FIELD_ICON_BUTTON_CLASS =
  "inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-xl border border-field-rule bg-card text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50 lg:size-10";

export const INPUT_CLASS = `w-full rounded-xl border border-rule bg-card px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${TARGET}`;
