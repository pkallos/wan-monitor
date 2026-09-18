import type { Update } from "foldkit";
import { FetchAuthStatus } from "@/auth/command";
import type { Flags } from "@/auth/flags";
import type { Message } from "@/auth/message";
import { Checking, type Model } from "@/auth/model";

export const init = (flags: Flags): Update.Return<Model, Message> => ({
  model: Checking({ maybeToken: flags.maybeToken, settings: flags.settings }),
  commands: [FetchAuthStatus()],
});
