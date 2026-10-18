import { Match as M, Option } from "effect";
import { Command, type Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import {
  ClearSession,
  FetchAuthStatus,
  FetchMe,
  Login,
  Logout,
  SaveSession,
} from "@/auth/command";
import { GotDashboardMessage, type Message } from "@/auth/message";
import {
  currentSettings,
  initLoggedOut,
  LoggedIn,
  type Model,
  Session,
  Unreachable,
} from "@/auth/model";
import * as Dashboard from "@/dashboard";
import type { Settings } from "@/storage";

type UpdateReturn = Update.Return<Model, Message>;
const withUpdateReturn = M.withReturnType<UpdateReturn>();

// A newly LoggedIn Model always starts its dashboard the same way regardless
// of how it got here (auth disabled, a validated stored token, or a fresh
// login), so this seeds Dashboard.initModel() and immediately runs it
// through EnteredDashboard rather than requiring a separate message
// round-trip.
const enterLoggedIn = (
  maybeSession: Option.Option<Session>,
  token: string,
  settings: Settings
): UpdateReturn => {
  const { model: dashboardModel, commands: dashboardCommands } =
    Dashboard.update(
      Dashboard.initModel(settings),
      Dashboard.EnteredDashboard(),
      { token, now: Date.now }
    );

  return {
    model: LoggedIn({ maybeSession, dashboard: dashboardModel }),
    commands: Command.mapMessages(dashboardCommands ?? [], (message) =>
      GotDashboardMessage({ message })
    ),
  };
};

const unreachable = (
  token: string,
  settings: Settings,
  retry: Unreachable["retry"]
): Model => Unreachable({ token, settings, retry });

type PendingCheck = {
  readonly maybeToken: Option.Option<string>;
  readonly settings: Settings;
  readonly retryAfterFailure: Unreachable["retry"];
};

// Runs only while an auth check is in flight (`Checking`, or `Unreachable` with
// a Retry running); a late answer in any other state is ignored.
const whileChecking = (
  model: Model,
  run: (check: PendingCheck) => UpdateReturn
): UpdateReturn => {
  if (model._tag === "Checking") {
    return run({
      maybeToken: model.maybeToken,
      settings: model.settings,
      retryAfterFailure: "Idle",
    });
  }
  if (model._tag === "Unreachable" && model.retry === "Running") {
    return run({
      maybeToken: Option.some(model.token),
      settings: model.settings,
      retryAfterFailure: "Failed",
    });
  }
  return { model };
};

// Only the OS theme subscription runs outside the dashboard. It repaints
// `<html>` so Checking and the login screen follow a `system` preference.
const outsideDashboard = (
  model: Model,
  message: Dashboard.Message
): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tag("ChangedSystemTheme", () => {
      const { theme } = currentSettings(model);
      return theme === "system"
        ? {
            model,
            commands: Command.mapMessages(
              [Dashboard.ApplyTheme({ theme })],
              (message) => GotDashboardMessage({ message })
            ),
          }
        : { model };
    }),
    M.orElse(() => ({ model }))
  );

const updateDashboard = (
  model: LoggedIn,
  message: Dashboard.Message
): UpdateReturn => {
  const token = Option.match(model.maybeSession, {
    onNone: () => "",
    onSome: (session) => session.token,
  });
  const {
    model: dashboardModel,
    commands: dashboardCommands,
    outMessage,
  } = Dashboard.update(model.dashboard, message, { token, now: Date.now });
  const nextModel = modifyFields(model, { dashboard: () => dashboardModel });
  const commands = Command.mapMessages(dashboardCommands ?? [], (message) =>
    GotDashboardMessage({ message })
  );

  if (outMessage === undefined) return { model: nextModel, commands };

  return M.value(outMessage).pipe(
    withUpdateReturn,
    // The theme and range survive logout, so the login screen stays
    // themed and logging back in restores them.
    M.tag("RequestedLogout", () => ({
      model: initLoggedOut(currentSettings(nextModel)),
      commands: [...commands, ClearSession(), Logout()],
    })),
    M.exhaustive
  );
};

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tags({
      SucceededFetchAuthStatus: ({ authRequired }) =>
        whileChecking(model, ({ maybeToken, settings }) => {
          if (!authRequired) return enterLoggedIn(Option.none(), "", settings);
          return Option.match(maybeToken, {
            onNone: () => ({ model: initLoggedOut(settings) }),
            onSome: (token) => ({ model, commands: [FetchMe({ token })] }),
          });
        }),
      // A stored token stays in storage while the server cannot be reached:
      // only a 401 (`RejectedToken`) or Sign out may clear it.
      FailedFetchAuthStatus: () =>
        whileChecking(model, ({ maybeToken, settings, retryAfterFailure }) =>
          Option.match(maybeToken, {
            onNone: () => ({ model: initLoggedOut(settings) }),
            onSome: (token) => ({
              model: unreachable(token, settings, retryAfterFailure),
            }),
          })
        ),

      SucceededFetchMe: ({ username }) =>
        whileChecking(model, ({ maybeToken, settings }) => {
          const token = Option.getOrThrow(maybeToken);
          return enterLoggedIn(
            Option.some(Session.make({ token, username })),
            token,
            settings
          );
        }),
      RejectedToken: () =>
        whileChecking(model, ({ settings }) => ({
          model: initLoggedOut(settings),
          commands: [ClearSession()],
        })),
      FailedFetchMe: () =>
        whileChecking(model, ({ maybeToken, settings, retryAfterFailure }) => ({
          model: unreachable(
            Option.getOrThrow(maybeToken),
            settings,
            retryAfterFailure
          ),
        })),
      ClickedRetryConnection: () => {
        if (model._tag !== "Unreachable" || model.retry === "Running")
          return { model };
        return {
          model: modifyFields(model, { retry: () => "Running" as const }),
          commands: [FetchAuthStatus()],
        };
      },
      ClickedSignOut: () => {
        if (model._tag !== "Unreachable") return { model };
        return {
          model: initLoggedOut(model.settings),
          commands: [ClearSession()],
        };
      },

      ChangedUsername: ({ value }) => {
        if (model._tag !== "LoggedOut") return { model };
        return { model: modifyFields(model, { username: () => value }) };
      },
      ChangedPassword: ({ value }) => {
        if (model._tag !== "LoggedOut") return { model };
        return { model: modifyFields(model, { password: () => value }) };
      },
      SubmittedLogin: () => {
        if (model._tag !== "LoggedOut") return { model };
        return {
          model: modifyFields(model, {
            isSubmitting: () => true,
            maybeError: () => Option.none(),
          }),
          commands: [
            Login({ username: model.username, password: model.password }),
          ],
        };
      },
      SucceededLogin: ({ token, username }) => {
        const { model: loggedInModel, commands } = enterLoggedIn(
          Option.some(Session.make({ token, username })),
          token,
          currentSettings(model)
        );
        return {
          model: loggedInModel,
          commands: [...(commands ?? []), SaveSession({ token, username })],
        };
      },
      FailedLogin: ({ error }) => {
        if (model._tag !== "LoggedOut") return { model };
        return {
          model: modifyFields(model, {
            isSubmitting: () => false,
            maybeError: () => Option.some(error),
          }),
        };
      },

      GotDashboardMessage: ({ message }) =>
        M.value(model).pipe(
          withUpdateReturn,
          M.tag("LoggedIn", (loggedIn) => updateDashboard(loggedIn, message)),
          M.orElse((other) => outsideDashboard(other, message))
        ),
    }),
    // Fire-and-forget acknowledgments: the effect already happened (session
    // saved/cleared, logout request sent), so there's nothing left to do
    // beyond letting DevTools/Story/Scene see the Command settled.
    M.tag(
      "CompletedLogout",
      "CompletedSaveSession",
      "FailedSaveSession",
      "CompletedClearSession",
      "FailedClearSession",
      () => ({ model })
    ),
    M.exhaustive
  );
