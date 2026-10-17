import { Match as M, Option } from "effect";
import { Command, type Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import {
  ClearSession,
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
      SucceededFetchAuthStatus: ({ authRequired }) => {
        if (model._tag !== "Checking") return { model };
        if (!authRequired) {
          return enterLoggedIn(Option.none(), "", model.settings);
        }
        return Option.match(model.maybeToken, {
          onNone: () => ({ model: initLoggedOut(model.settings) }),
          onSome: (token) => ({ model, commands: [FetchMe({ token })] }),
        });
      },
      FailedFetchAuthStatus: () => ({
        model: initLoggedOut(currentSettings(model)),
      }),

      SucceededFetchMe: ({ username }) => {
        if (model._tag !== "Checking") return { model };
        const token = Option.getOrThrow(model.maybeToken);
        return enterLoggedIn(
          Option.some(Session.make({ token, username })),
          token,
          model.settings
        );
      },
      FailedFetchMe: () => ({
        model: initLoggedOut(currentSettings(model)),
        commands: [ClearSession()],
      }),

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
