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
  type LoggedOut,
  type Model,
  Session,
  Unreachable,
  ValidatingToken,
} from "@/auth/model";
import * as Dashboard from "@/dashboard";
import type { Settings } from "@/storage";

type UpdateReturn = Update.Return<Model, Message>;
const withUpdateReturn = M.withReturnType<UpdateReturn>();

// No session (auth disabled) means no token, so no Authorization header.
const dashboardContext = (
  maybeSession: Option.Option<Session>
): Dashboard.Context => ({
  maybeToken: Option.map(maybeSession, (session) => session.token),
  now: Date.now,
});

// A newly LoggedIn Model always starts its dashboard the same way regardless
// of how it got here (auth disabled, a validated stored token, or a fresh
// login), so this seeds Dashboard.initModel() and immediately runs it
// through EnteredDashboard rather than requiring a separate message
// round-trip.
const enterLoggedIn = (
  maybeSession: Option.Option<Session>,
  settings: Settings
): UpdateReturn => {
  const { model: dashboardModel, commands: dashboardCommands } =
    Dashboard.update(
      Dashboard.initModel(settings, Date.now()),
      Dashboard.EnteredDashboard(),
      dashboardContext(maybeSession)
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

type PendingStatusCheck = {
  readonly maybeToken: Option.Option<string>;
  readonly settings: Settings;
  readonly retryAfterFailure: Unreachable["retry"];
  readonly validateToken: (token: string) => Model;
};

// Runs only while `/status` is in flight (`Checking`, or `Unreachable` with a
// Retry running); a late answer in any other state is ignored.
const whileCheckingStatus = (
  model: Model,
  run: (check: PendingStatusCheck) => UpdateReturn
): UpdateReturn =>
  M.value(model).pipe(
    withUpdateReturn,
    M.tag("Checking", ({ maybeToken, settings }) =>
      run({
        maybeToken,
        settings,
        retryAfterFailure: "Idle",
        validateToken: (token) => ValidatingToken({ token, settings }),
      })
    ),
    // A Retry stays on Unreachable for its /me check too, so no ValidatingToken.
    M.tag("Unreachable", (screen) =>
      screen.retry === "Running"
        ? run({
            maybeToken: Option.some(screen.token),
            settings: screen.settings,
            retryAfterFailure: "Failed",
            validateToken: () => screen,
          })
        : { model }
    ),
    M.orElse(() => ({ model }))
  );

type PendingTokenCheck = {
  readonly token: string;
  readonly settings: Settings;
  readonly retryAfterFailure: Unreachable["retry"];
};

// Runs only while `/me` is in flight (`ValidatingToken`, or `Unreachable` with
// a Retry running, which covers both of a retry's requests); a late answer in
// any other state is ignored.
const whileValidatingToken = (
  model: Model,
  run: (check: PendingTokenCheck) => UpdateReturn
): UpdateReturn =>
  M.value(model).pipe(
    withUpdateReturn,
    M.tag("ValidatingToken", ({ token, settings }) =>
      run({ token, settings, retryAfterFailure: "Idle" })
    ),
    M.tag("Unreachable", ({ token, settings, retry }) =>
      retry === "Running"
        ? run({ token, settings, retryAfterFailure: "Failed" })
        : { model }
    ),
    M.orElse(() => ({ model }))
  );

const whileUnreachable = (
  model: Model,
  run: (screen: Unreachable) => UpdateReturn
): UpdateReturn =>
  M.value(model).pipe(
    withUpdateReturn,
    M.tag("Unreachable", run),
    M.orElse(() => ({ model }))
  );

const whileLoggedOut = (
  model: Model,
  run: (loggedOut: LoggedOut) => UpdateReturn
): UpdateReturn =>
  M.value(model).pipe(
    withUpdateReturn,
    M.tag("LoggedOut", run),
    M.orElse(() => ({ model }))
  );

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
  const {
    model: dashboardModel,
    commands: dashboardCommands,
    outMessage,
  } = Dashboard.update(
    model.dashboard,
    message,
    dashboardContext(model.maybeSession)
  );
  const nextModel =
    dashboardModel === model.dashboard
      ? model
      : modifyFields(model, { dashboard: () => dashboardModel });
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
        whileCheckingStatus(
          model,
          ({ maybeToken, settings, validateToken }) => {
            if (!authRequired) return enterLoggedIn(Option.none(), settings);
            return Option.match(maybeToken, {
              onNone: () => ({ model: initLoggedOut(settings) }),
              onSome: (token) => ({
                model: validateToken(token),
                commands: [FetchMe({ token })],
              }),
            });
          }
        ),
      // A stored token stays in storage while the server cannot be reached:
      // only a 401 (`RejectedToken`) or Sign out may clear it.
      FailedFetchAuthStatus: () =>
        whileCheckingStatus(
          model,
          ({ maybeToken, settings, retryAfterFailure }) =>
            Option.match(maybeToken, {
              onNone: () => ({ model: initLoggedOut(settings) }),
              onSome: (token) => ({
                model: unreachable(token, settings, retryAfterFailure),
              }),
            })
        ),

      SucceededFetchMe: ({ username }) =>
        whileValidatingToken(model, ({ token, settings }) =>
          enterLoggedIn(
            Option.some(Session.make({ token, username })),
            settings
          )
        ),
      RejectedToken: () =>
        whileValidatingToken(model, ({ settings }) => ({
          model: initLoggedOut(settings),
          commands: [ClearSession()],
        })),
      FailedFetchMe: () =>
        whileValidatingToken(
          model,
          ({ token, settings, retryAfterFailure }) => ({
            model: unreachable(token, settings, retryAfterFailure),
          })
        ),
      ClickedRetryConnection: () =>
        whileUnreachable(model, (screen) =>
          screen.retry === "Running"
            ? { model }
            : {
                model: modifyFields(screen, {
                  retry: () => "Running" as const,
                }),
                commands: [FetchAuthStatus()],
              }
        ),
      ClickedSignOut: () =>
        whileUnreachable(model, ({ settings }) => ({
          model: initLoggedOut(settings),
          commands: [ClearSession()],
        })),

      ChangedUsername: ({ value }) =>
        whileLoggedOut(model, (loggedOut) => ({
          model: modifyFields(loggedOut, { username: () => value }),
        })),
      ChangedPassword: ({ value }) =>
        whileLoggedOut(model, (loggedOut) => ({
          model: modifyFields(loggedOut, { password: () => value }),
        })),
      SubmittedLogin: () =>
        whileLoggedOut(model, (loggedOut) => ({
          model: modifyFields(loggedOut, {
            isSubmitting: () => true,
            maybeError: () => Option.none(),
          }),
          commands: [
            Login({
              username: loggedOut.username,
              password: loggedOut.password,
            }),
          ],
        })),
      SucceededLogin: ({ token, username }) => {
        const { model: loggedInModel, commands } = enterLoggedIn(
          Option.some(Session.make({ token, username })),
          currentSettings(model)
        );
        return {
          model: loggedInModel,
          commands: [...(commands ?? []), SaveSession({ token })],
        };
      },
      FailedLogin: ({ error }) =>
        whileLoggedOut(model, (loggedOut) => ({
          model: modifyFields(loggedOut, {
            isSubmitting: () => false,
            maybeError: () => Option.some(error),
          }),
        })),

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
