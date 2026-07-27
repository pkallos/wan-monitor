import type { Command } from "foldkit";
import { FetchAuthStatus } from "@/auth/command";
import type { Flags } from "@/auth/flags";
import type { Message } from "@/auth/message";
import { Checking, type Model } from "@/auth/model";

export const init = (
  flags: Flags
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => [
  Checking({ maybeToken: flags.maybeToken }),
  [FetchAuthStatus()],
];
