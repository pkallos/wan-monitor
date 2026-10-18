import { Match as M, Option, Schema as S } from "effect";
import { taggedStruct as ts } from "foldkit/schema";
import * as Dashboard from "@/dashboard";
import { Settings } from "@/storage";

export const Session = S.Struct({
  token: S.String,
  username: S.String,
});
export type Session = typeof Session.Type;

export const Checking = ts("Checking", {
  maybeToken: S.Option(S.String),
  settings: Settings,
});
export type Checking = typeof Checking.Type;

export const ValidatingToken = ts("ValidatingToken", {
  token: S.String,
  settings: Settings,
});
export type ValidatingToken = typeof ValidatingToken.Type;

export const LoggedOut = ts("LoggedOut", {
  username: S.String,
  password: S.String,
  isSubmitting: S.Boolean,
  maybeError: S.Option(S.String),
  settings: Settings,
});
export type LoggedOut = typeof LoggedOut.Type;

export const Unreachable = ts("Unreachable", {
  token: S.String,
  settings: Settings,
  retry: S.Literals(["Idle", "Running", "Failed"]),
});
export type Unreachable = typeof Unreachable.Type;

export const LoggedIn = ts("LoggedIn", {
  maybeSession: S.Option(Session),
  dashboard: Dashboard.Model,
});
export type LoggedIn = typeof LoggedIn.Type;

export const Model = S.Union([
  Checking,
  ValidatingToken,
  LoggedOut,
  Unreachable,
  LoggedIn,
]);
export type Model = typeof Model.Type;

export const initLoggedOut = (
  settings: Settings,
  maybeError: Option.Option<string> = Option.none()
): LoggedOut =>
  LoggedOut({
    username: "",
    password: "",
    isSubmitting: false,
    maybeError,
    settings,
  });

// Every state carries (or can derive) the chrome settings that survive a
// reload. `LoggedIn` holds no separate copy, so its settings come from the
// live dashboard via `settingsFromModel`.
export const currentSettings = (model: Model): Settings =>
  M.value(model).pipe(
    M.withReturnType<Settings>(),
    M.tagsExhaustive({
      Checking: (checking) => checking.settings,
      ValidatingToken: (validating) => validating.settings,
      LoggedOut: (loggedOut) => loggedOut.settings,
      Unreachable: (unreachable) => unreachable.settings,
      LoggedIn: (loggedIn) => Dashboard.settingsFromModel(loggedIn.dashboard),
    })
  );
