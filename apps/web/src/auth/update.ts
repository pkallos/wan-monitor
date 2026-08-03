import { Match as M, Option } from "effect";
import { Command } from "foldkit";
import { evo } from "foldkit/struct";
import {
  ClearSession,
  FetchMe,
  Login,
  Logout,
  SaveSession,
} from "@/auth/command";
import { GotDashboardMessage, type Message } from "@/auth/message";
import { initLoggedOut, LoggedIn, type Model, Session } from "@/auth/model";
import * as Dashboard from "@/dashboard";

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];
const withUpdateReturn = M.withReturnType<UpdateReturn>();

// A newly LoggedIn Model always starts its dashboard the same way regardless
// of how it got here (auth disabled, a validated stored token, or a fresh
// login), so this seeds Dashboard.initModel() and immediately runs it
// through EnteredDashboard rather than requiring a separate message
// round-trip.
const enterLoggedIn = (
  maybeSession: Option.Option<Session>,
  token: string
): UpdateReturn => {
  const [dashboardModel, dashboardCommands] = Dashboard.update(
    Dashboard.initModel(),
    Dashboard.EnteredDashboard(),
    { token, now: Date.now }
  );

  return [
    LoggedIn({ maybeSession, dashboard: dashboardModel }),
    Command.mapMessages(dashboardCommands, (message) =>
      GotDashboardMessage({ message })
    ),
  ];
};

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tags({
      SucceededFetchAuthStatus: ({ authRequired }) => {
        if (model._tag !== "Checking") return [model, []];
        if (!authRequired) {
          return enterLoggedIn(Option.none(), "");
        }
        return Option.match(model.maybeToken, {
          onNone: () => [initLoggedOut(), []],
          onSome: (token) => [model, [FetchMe({ token })]],
        });
      },
      FailedFetchAuthStatus: () => [initLoggedOut(), []],

      SucceededFetchMe: ({ username }) => {
        if (model._tag !== "Checking") return [model, []];
        const token = Option.getOrThrow(model.maybeToken);
        return enterLoggedIn(
          Option.some(Session.make({ token, username })),
          token
        );
      },
      FailedFetchMe: () => [initLoggedOut(), [ClearSession()]],

      ChangedUsername: ({ value }) => {
        if (model._tag !== "LoggedOut") return [model, []];
        return [evo(model, { username: () => value }), []];
      },
      ChangedPassword: ({ value }) => {
        if (model._tag !== "LoggedOut") return [model, []];
        return [evo(model, { password: () => value }), []];
      },
      SubmittedLogin: () => {
        if (model._tag !== "LoggedOut") return [model, []];
        return [
          evo(model, {
            isSubmitting: () => true,
            maybeError: () => Option.none(),
          }),
          [Login({ username: model.username, password: model.password })],
        ];
      },
      SucceededLogin: ({ token, username }) => {
        const [loggedInModel, commands] = enterLoggedIn(
          Option.some(Session.make({ token, username })),
          token
        );
        return [loggedInModel, [...commands, SaveSession({ token, username })]];
      },
      FailedLogin: ({ error }) => {
        if (model._tag !== "LoggedOut") return [model, []];
        return [
          evo(model, {
            isSubmitting: () => false,
            maybeError: () => Option.some(error),
          }),
          [],
        ];
      },

      ClickedLogout: () => [initLoggedOut(), [ClearSession(), Logout()]],

      GotDashboardMessage: ({ message }) => {
        if (model._tag !== "LoggedIn") return [model, []];
        const token = Option.match(model.maybeSession, {
          onNone: () => "",
          onSome: (session) => session.token,
        });
        const [dashboardModel, dashboardCommands] = Dashboard.update(
          model.dashboard,
          message,
          { token, now: Date.now }
        );
        return [
          evo(model, { dashboard: () => dashboardModel }),
          Command.mapMessages(dashboardCommands, (message) =>
            GotDashboardMessage({ message })
          ),
        ];
      },
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
      () => [model, []]
    ),
    M.exhaustive
  );
