import { Match as M, Option } from "effect";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import {
  ChangedPassword,
  ChangedUsername,
  ClickedLogout,
  GotDashboardMessage,
  type Message,
  SubmittedLogin,
} from "@/auth/message";
import type { LoggedOut, Model } from "@/auth/model";
import { view as dashboardView } from "@/dashboard/view";

const INPUT_CLASS =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

const LABEL_CLASS =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

const loginView = (model: LoggedOut, h: HtmlBuilder<Message>): Html => {
  return h.div(
    [
      h.Class(
        "flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900"
      ),
    ],
    [
      h.form(
        [
          h.OnSubmit(SubmittedLogin()),
          h.Class(
            "w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          ),
        ],
        [
          h.div(
            [h.Class("mb-6 text-center")],
            [
              h.h1([h.Class("text-3xl font-bold")], ["WAN Monitor"]),
              h.p(
                [h.Class("mt-1 text-sm text-gray-500 dark:text-gray-400")],
                ["Sign in to access the dashboard"]
              ),
            ]
          ),
          Option.match(model.maybeError, {
            onNone: () => h.empty,
            onSome: (error) =>
              h.div(
                [
                  h.Role("alert"),
                  h.Class(
                    "mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
                  ),
                ],
                [error]
              ),
          }),
          h.div(
            [h.Class("mb-4")],
            [
              h.label([h.For("username"), h.Class(LABEL_CLASS)], ["Username"]),
              h.input([
                h.Id("username"),
                h.Type("text"),
                h.Value(model.username),
                h.OnInput((value) => ChangedUsername({ value })),
                h.Class(INPUT_CLASS),
              ]),
            ]
          ),
          h.div(
            [h.Class("mb-6")],
            [
              h.label([h.For("password"), h.Class(LABEL_CLASS)], ["Password"]),
              h.input([
                h.Id("password"),
                h.Type("password"),
                h.Value(model.password),
                h.OnInput((value) => ChangedPassword({ value })),
                h.Class(INPUT_CLASS),
              ]),
            ]
          ),
          h.button(
            [
              h.Type("submit"),
              h.Disabled(model.isSubmitting),
              h.Class(
                "w-full cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              ),
            ],
            [model.isSubmitting ? "Signing in…" : "Sign In"]
          ),
        ]
      ),
    ]
  );
};

const dashboardShellView = (
  model: Extract<Model, { _tag: "LoggedIn" }>,
  h: HtmlBuilder<Message>
): Html => {
  // A pre-built Html node can't cross into viewInputs (its embedded OnClick
  // handler is a nested function, and only top-level viewInputs functions
  // get auto-scoped to this boundary), so the button is built lazily by a
  // top-level callback the dashboard view calls instead.
  const renderLogoutButton = (): Html =>
    h.button(
      [
        h.Type("button"),
        h.OnClick(ClickedLogout()),
        h.Class(
          "cursor-pointer rounded-md px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        ),
      ],
      [
        Option.match(model.maybeSession, {
          onNone: () => "Logout",
          onSome: (session) => `Logout (${session.username})`,
        }),
      ]
    );

  return h.submodel({
    slotId: "dashboard",
    model: model.dashboard,
    view: dashboardView,
    viewInputs: { renderLogoutButton },
    toParentMessage: (message) => GotDashboardMessage({ message }),
  });
};

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "WAN Monitor",
  body: M.value(model).pipe(
    M.tagsExhaustive({
      Checking: () =>
        h.div(
          [
            h.Role("status"),
            h.Class(
              "flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400"
            ),
          ],
          ["Loading…"]
        ),
      LoggedOut: (loggedOut) => loginView(loggedOut, h),
      LoggedIn: (loggedIn) => dashboardShellView(loggedIn, h),
    })
  ),
});
