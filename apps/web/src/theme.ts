import { extendTheme, type ThemeConfig } from "@chakra-ui/react";

const config: ThemeConfig = {
  // Default to the OS preference on first visit, but once the user picks a mode
  // via the toggle, honour that choice on reload. With useSystemColorMode:true
  // Chakra re-syncs to the OS preference on every load and discards the stored
  // selection, so it must stay false for the preference to persist.
  initialColorMode: "system",
  useSystemColorMode: false,
};

export const theme = extendTheme({ config });
