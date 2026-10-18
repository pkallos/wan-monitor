import { Logger } from "effect";

export const captureLogs = () => {
  const entries: { level: string; text: string }[] = [];
  const layer = Logger.layer([
    Logger.make<unknown, void>(({ logLevel, message }) => {
      entries.push({ level: logLevel, text: String(message) });
    }),
  ]);
  return { entries, layer };
};
