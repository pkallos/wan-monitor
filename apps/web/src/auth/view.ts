import { Match as M, Option } from "effect";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { TriangleAlert } from "lucide";
import {
  ChangedPassword,
  ChangedUsername,
  GotDashboardMessage,
  type Message,
  SubmittedLogin,
} from "@/auth/message";
import type { LoggedOut, Model } from "@/auth/model";
import { view as dashboardView } from "@/dashboard/view";
import { card } from "@/ui/card";
import { INPUT_CLASS, PRIMARY_BUTTON_CLASS } from "@/ui/controls";
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
            h.h1(
              [
                h.Class(
                  "mb-6 text-center text-3xl font-semibold tracking-tight"
                ),
              ],
              ["WAN Monitor"]
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
              [model.isSubmitting ? "Signing in…" : "Sign in"]
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
): Html =>
  h.submodel({
    slotId: "dashboard",
    model: model.dashboard,
    view: dashboardView,
    viewInputs: {
      maybeUsername: Option.map(
        model.maybeSession,
        (session) => session.username
      ),
    },
    toParentMessage: (message) => GotDashboardMessage({ message }),
  });

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
