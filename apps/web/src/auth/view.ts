import { Match as M, Option } from "effect";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { TriangleAlert } from "lucide";
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
import { card } from "@/ui/card";
import {
  GHOST_BUTTON_CLASS,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/ui/controls";
import { icon } from "@/ui/icon";

const LABEL_CLASS = "mb-1 block text-sm font-medium text-ink-2";

const loginView = (model: LoggedOut, h: HtmlBuilder<Message>): Html => {
  return h.div(
    [h.Class("flex min-h-screen items-center justify-center bg-bg px-4")],
    [
      card(h, { className: "w-full max-w-sm" }, [
        h.form(
          [h.OnSubmit(SubmittedLogin())],
          [
            h.div(
              [h.Class("mb-6 text-center")],
              [
                h.h1(
                  [h.Class("text-3xl font-semibold tracking-tight")],
                  ["WAN Monitor"]
                ),
                h.p(
                  [h.Class("mt-1 text-sm text-ink-2")],
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
                      "mb-4 flex items-center gap-2 rounded-xl border border-down px-4 py-3 text-sm text-down"
                    ),
                  ],
                  [icon(h, TriangleAlert, { size: 16 }), h.span([], [error])]
                ),
            }),
            h.div(
              [h.Class("mb-4")],
              [
                h.label(
                  [h.For("username"), h.Class(LABEL_CLASS)],
                  ["Username"]
                ),
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
                h.label(
                  [h.For("password"), h.Class(LABEL_CLASS)],
                  ["Password"]
                ),
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
                h.Class(`w-full ${PRIMARY_BUTTON_CLASS}`),
              ],
              [model.isSubmitting ? "Signing in…" : "Sign In"]
            ),
          ]
        ),
      ]),
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
        h.Class(GHOST_BUTTON_CLASS),
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
              "flex min-h-screen items-center justify-center bg-bg text-sm text-ink-2"
            ),
          ],
          ["Loading…"]
        ),
      LoggedOut: (loggedOut) => loginView(loggedOut, h),
      LoggedIn: (loggedIn) => dashboardShellView(loggedIn, h),
    })
  ),
});
