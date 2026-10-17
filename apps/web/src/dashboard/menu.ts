import { Menu } from "@foldkit/ui";
import { Schema as S } from "effect";
import type { ThemePreference } from "@/dashboard/theme";

export const MenuItem = S.Literals([
  "ThemeLight",
  "ThemeDark",
  "ThemeSystem",
  "RunSpeedTest",
  "Logout",
]);
export type MenuItem = typeof MenuItem.Type;

/** Display order; the menu groups the three theme items under one heading. */
export const MENU_ITEMS: ReadonlyArray<MenuItem> = MenuItem.literals;

export const THEME_ITEMS = {
  ThemeLight: { label: "Light", preference: "light" },
  ThemeDark: { label: "Dark", preference: "dark" },
  ThemeSystem: { label: "System", preference: "system" },
} as const satisfies Partial<
  Record<MenuItem, { label: string; preference: ThemePreference }>
>;

export type ThemeItem = keyof typeof THEME_ITEMS;

export const isThemeItem = (item: MenuItem): item is ThemeItem =>
  item in THEME_ITEMS;

export const DashboardMenu = Menu.create<MenuItem>();
