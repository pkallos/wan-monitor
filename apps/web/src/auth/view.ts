import { Button } from "@foldkit/ui";
import { Match as M, Option } from "effect";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { TriangleAlert } from "lucide";
import {
  ChangedPassword,
  ChangedUsername,
  ClickedRetryConnection,
  ClickedSignOut,
  GotDashboardMessage,
  type Message,
  SubmittedLogin,
} from "@/auth/message";
import type { LoggedIn, LoggedOut, Model, Unreachable } from "@/auth/model";
import { view as dashboardView } from "@/dashboard/view";
import { card } from "@/ui/card";
import {
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/ui/controls";
import { icon } from "@/ui/icon";

const LABEL_CLASS = "mb-1 block text-sm font-medium text-ink-2";

const errorAlert = (h: HtmlBuilder<Message>, error: string): Html =>
  h.div(
    [
      h.Role("alert"),
      h.Class(
        "mb-4 flex items-center gap-2 rounded-xl border border-down px-4 py-3 text-sm text-down"
      ),
    ],
    [icon(h, TriangleAlert, { size: 16 }), h.span([], [error])]
  );

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
              onSome: (error) => errorAlert(h, error),
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

// The pending Retry is `aria-disabled` rather than `disabled`, so it keeps
// keyboard focus; the update ignores a Retry that arrives while one is running.
const PENDING_BUTTON_CLASS =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-accent";

const unreachableAnnouncement: Record<Unreachable["retry"], string> = {
  Idle: "",
  Running: "Retrying…",
  Failed: "Still cannot reach the server.",
};

const unreachableView = (model: Unreachable, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex min-h-screen items-center justify-center bg-bg px-4")],
    [
      card(h, { className: "w-full max-w-sm" }, [
        h.h1(
          [h.Class("mb-6 text-center text-3xl font-semibold tracking-tight")],
          ["WAN Monitor"]
        ),
        errorAlert(h, "Cannot reach the server."),
        h.div(
          [
            h.Role("status"),
            h.DataAttribute("testid", "unreachable-announcement"),
            h.Class("sr-only"),
          ],
          [unreachableAnnouncement[model.retry]]
        ),
        h.div(
          [h.Class("flex gap-3")],
          [
            Button.view(
              {
                onClick: ClickedRetryConnection(),
                isDisabled: model.retry === "Running",
                toView: (attributes) =>
                  h.button(
                    [
                      ...attributes.button,
                      h.Class(
                        `flex-1 ${PRIMARY_BUTTON_CLASS} ${PENDING_BUTTON_CLASS}`
                      ),
                    ],
                    [model.retry === "Running" ? "Retrying…" : "Retry"]
                  ),
              },
              h
            ),
            h.button(
              [
                h.Type("button"),
                h.OnClick(ClickedSignOut()),
                h.Class(`flex-1 ${SECONDARY_BUTTON_CLASS}`),
              ],
              ["Sign out"]
            ),
          ]
        ),
      ]),
    ]
  );

const loadingView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Role("status"),
      h.Class(
        "flex min-h-screen items-center justify-center bg-bg text-sm text-ink-2"
      ),
    ],
    ["Loading…"]
  );

const dashboardShellView = (model: LoggedIn, h: HtmlBuilder<Message>): Html =>
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
      Checking: () => loadingView(h),
      ValidatingToken: () => loadingView(h),
      LoggedOut: (loggedOut) => loginView(loggedOut, h),
      Unreachable: (unreachable) => unreachableView(unreachable, h),
      LoggedIn: (loggedIn) => dashboardShellView(loggedIn, h),
    })
  ),
});
