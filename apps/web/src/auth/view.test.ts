import { Menu } from "@foldkit/ui";
import { Option } from "effect";
import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { ClearSession, FetchAuthStatus, Logout } from "@/auth/command";
import {
  CompletedClearSession,
  CompletedLogout,
  FailedFetchAuthStatus,
} from "@/auth/message";
import {
  Checking,
  initLoggedOut,
  LoggedIn,
  Session,
  Unreachable,
  ValidatingToken,
} from "@/auth/model";
import { update } from "@/auth/update";
import { view } from "@/auth/view";
import {
  initModel as realInitDashboardModel,
  SucceededMountJitterChart,
  SucceededMountLatencyChart,
  SucceededMountPacketLossChart,
  SucceededMountSpeedChart,
} from "@/dashboard";
import {
  JITTER_CHART_HOST_ID,
  LATENCY_CHART_HOST_ID,
  MountJitterChart,
  MountLatencyChart,
  MountPacketLossChart,
  MountSpeedChart,
  PACKET_LOSS_CHART_HOST_ID,
  SPEED_CHART_HOST_ID,
} from "@/dashboard/charts/command";
import { defaultSettings } from "@/storage";

const acknowledgeAllChartMounts = () =>
  Scene.Mount.resolveAll(
    [
      MountLatencyChart,
      SucceededMountLatencyChart({ hostId: LATENCY_CHART_HOST_ID }),
    ],
    [
      MountPacketLossChart,
      SucceededMountPacketLossChart({ hostId: PACKET_LOSS_CHART_HOST_ID }),
    ],
    [
      MountJitterChart,
      SucceededMountJitterChart({ hostId: JITTER_CHART_HOST_ID }),
    ],
    [MountSpeedChart, SucceededMountSpeedChart({ hostId: SPEED_CHART_HOST_ID })]
  );

const resolveMenuMounts = () => [
  Scene.Mount.resolveAll(
    [Menu.AnchorMenu, Menu.Message.CompletedAnchorMenu()],
    [Menu.PortalMenuBackdrop, Menu.Message.CompletedPortalMenuBackdrop()]
  ),
  Scene.Command.resolveAll([
    Menu.FocusItems,
    Menu.Message.CompletedFocusItems(),
  ]),
];

const unreachable = (retry: Unreachable["retry"]) =>
  Unreachable({
    token: "stored-token",
    settings: defaultSettings(),
    retry,
  });

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");

const initDashboardModel = (
  settings: Parameters<typeof realInitDashboardModel>[0]
) => realInitDashboardModel(settings, NOW_MS);

const ANNOUNCEMENT = Scene.testId("unreachable-announcement");

describe("auth view", () => {
  test("shows a loading indicator while checking auth status", () => {
    Scene.scene(
      { update, view },
      Scene.given(
        Checking({ maybeToken: Option.none(), settings: defaultSettings() })
      ),
      Scene.expect(Scene.role("status")).toExist()
    );
  });

  test("shows the same loading indicator while validating a stored token", () => {
    Scene.scene(
      { update, view },
      Scene.given(
        ValidatingToken({
          token: "stored-token",
          settings: defaultSettings(),
        })
      ),
      Scene.expect(Scene.role("status")).toHaveText("Loading…")
    );
  });

  test("tells the user the server cannot be reached instead of showing the login form", () => {
    Scene.scene(
      { update, view },
      Scene.given(unreachable("Idle")),
      Scene.expect(Scene.role("alert")).toHaveText("Cannot reach the server."),
      Scene.expect(Scene.role("button", { name: "Retry" })).toBeEnabled(),
      Scene.expect(Scene.role("button", { name: "Sign out" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Sign in" })).not.toExist(),
      Scene.expect(ANNOUNCEMENT).toHaveText("")
    );
  });

  test("Retry stays focusable while the check runs and announces it", () => {
    Scene.scene(
      { update, view },
      Scene.given(unreachable("Idle")),
      Scene.click(Scene.role("button", { name: "Retry" })),
      Scene.expect(Scene.role("button", { name: "Retrying…" })).toBeDisabled(),
      Scene.expect(Scene.role("button", { name: "Retrying…" })).toHaveAttr(
        "aria-disabled",
        "true"
      ),
      Scene.expect(Scene.role("button", { name: "Retrying…" })).not.toHaveAttr(
        "disabled"
      ),
      Scene.expect(Scene.role("alert")).toHaveText("Cannot reach the server."),
      Scene.expect(ANNOUNCEMENT).toHaveText("Retrying…"),
      Scene.Command.resolve(
        FetchAuthStatus,
        FailedFetchAuthStatus({ error: "TransportError" })
      )
    );
  });

  test("a failed Retry announces that the server is still unreachable and re-enables Retry", () => {
    Scene.scene(
      { update, view },
      Scene.given(unreachable("Idle")),
      Scene.click(Scene.role("button", { name: "Retry" })),
      Scene.Command.resolve(
        FetchAuthStatus,
        FailedFetchAuthStatus({ error: "TransportError" })
      ),
      Scene.expect(ANNOUNCEMENT).toHaveText("Still cannot reach the server."),
      Scene.expect(Scene.role("button", { name: "Retry" })).toBeEnabled(),
      Scene.expect(Scene.role("alert")).toHaveText("Cannot reach the server.")
    );
  });

  test("the pending Retry keeps the disabled look in both themes", () => {
    Scene.scene(
      { update, view },
      Scene.given(unreachable("Running")),
      Scene.expect(Scene.role("button", { name: "Retrying…" })).toHaveClass(
        "aria-disabled:opacity-50"
      ),
      Scene.expect(Scene.role("button", { name: "Retrying…" })).toHaveClass(
        "aria-disabled:cursor-not-allowed"
      )
    );
  });

  test("Sign out from the unreachable screen shows the login form", () => {
    Scene.scene(
      { update, view },
      Scene.given(unreachable("Idle")),
      Scene.click(Scene.role("button", { name: "Sign out" })),
      Scene.Command.resolve(ClearSession, CompletedClearSession()),
      Scene.expect(Scene.role("button", { name: "Sign in" })).toExist()
    );
  });

  test("shows the login form when logged out", () => {
    Scene.scene(
      { update, view },
      Scene.given(initLoggedOut(defaultSettings())),
      Scene.expect(Scene.label("Username")).toExist(),
      Scene.expect(Scene.label("Password")).toExist(),
      Scene.expect(Scene.role("button", { name: "Sign in" })).toExist()
    );
  });

  test("typing into the username field updates its displayed value", () => {
    Scene.scene(
      { update, view },
      Scene.given(initLoggedOut(defaultSettings())),
      Scene.type(Scene.label("Username"), "phil"),
      Scene.expect(Scene.label("Username")).toHaveValue("phil")
    );
  });

  test("shows a disabled submitting state while the login request is in flight", () => {
    Scene.scene(
      { update, view },
      Scene.given({
        ...initLoggedOut(defaultSettings()),
        isSubmitting: true,
      }),
      Scene.expect(Scene.role("button", { name: "Signing in…" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Signing in…" })).toBeDisabled()
    );
  });

  test("shows the entered credentials error when login fails", () => {
    Scene.scene(
      { update, view },
      Scene.given(
        initLoggedOut(
          defaultSettings(),
          Option.some("Incorrect username or password.")
        )
      ),
      Scene.expect(Scene.role("alert")).toHaveText(
        "Incorrect username or password."
      )
    );
  });

  test("shows the dashboard shell, with Log out in the overflow menu naming the user", () => {
    Scene.scene(
      { update, view },
      Scene.given(
        LoggedIn({
          maybeSession: Option.some(
            Session.make({ token: "abc123", username: "phil" })
          ),
          dashboard: initDashboardModel(defaultSettings()),
        })
      ),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("heading", { name: "WAN Monitor" })).toExist(),
      Scene.click(Scene.role("button", { name: "Menu" })),
      ...resolveMenuMounts(),
      Scene.expect(Scene.role("menuitem", { name: "Log out (phil)" })).toExist()
    );
  });

  test("shows a plain Log out label when auth is disabled and there is no session", () => {
    Scene.scene(
      { update, view },
      Scene.given(
        LoggedIn({
          maybeSession: Option.none(),
          dashboard: initDashboardModel(defaultSettings()),
        })
      ),
      acknowledgeAllChartMounts(),
      Scene.click(Scene.role("button", { name: "Menu" })),
      ...resolveMenuMounts(),
      Scene.expect(Scene.role("menuitem", { name: "Log out" })).toExist()
    );
  });

  test("choosing Log out from the menu returns to the login form", () => {
    Scene.scene(
      { update, view },
      Scene.given(
        LoggedIn({
          maybeSession: Option.some(
            Session.make({ token: "abc123", username: "phil" })
          ),
          dashboard: initDashboardModel(defaultSettings()),
        })
      ),
      acknowledgeAllChartMounts(),
      Scene.click(Scene.role("button", { name: "Menu" })),
      ...resolveMenuMounts(),
      Scene.click(Scene.role("menuitem", { name: "Log out (phil)" })),
      Scene.Command.resolveAll(
        [ClearSession, CompletedClearSession()],
        [Logout, CompletedLogout()],
        [Menu.FocusButton, Menu.Message.CompletedFocusButton()]
      ),
      Scene.Mount.expectEnded(MountLatencyChart),
      Scene.Mount.expectEnded(MountPacketLossChart),
      Scene.Mount.expectEnded(MountJitterChart),
      Scene.Mount.expectEnded(MountSpeedChart),
      Scene.Mount.expectEnded(Menu.AnchorMenu),
      Scene.Mount.expectEnded(Menu.PortalMenuBackdrop),
      Scene.expect(Scene.role("button", { name: "Sign in" })).toExist()
    );
  });
});
