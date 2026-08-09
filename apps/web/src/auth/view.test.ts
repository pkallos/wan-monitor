import { Option } from "effect";
import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { ClearSession, Logout } from "@/auth/command";
import { CompletedClearSession, CompletedLogout } from "@/auth/message";
import { Checking, initLoggedOut, LoggedIn, Session } from "@/auth/model";
import { update } from "@/auth/update";
import { view } from "@/auth/view";
import {
  initModel as initDashboardModel,
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

  test("shows the login form when logged out", () => {
    Scene.scene(
      { update, view },
      Scene.given(initLoggedOut(defaultSettings())),
      Scene.expect(Scene.label("Username")).toExist(),
      Scene.expect(Scene.label("Password")).toExist(),
      Scene.expect(Scene.role("button", { name: "Sign In" })).toExist()
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
          Option.some("Incorrect username or password. Please try again.")
        )
      ),
      Scene.expect(Scene.role("alert")).toHaveText(
        "Incorrect username or password. Please try again."
      )
    );
  });

  test("shows the dashboard shell and a logout button when logged in", () => {
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
      Scene.expect(Scene.role("button", { name: "Logout (phil)" })).toExist(),
      Scene.expect(Scene.role("heading", { name: "WAN Monitor" })).toExist()
    );
  });

  test("shows a plain Logout label when auth is disabled and there is no session", () => {
    Scene.scene(
      { update, view },
      Scene.given(
        LoggedIn({
          maybeSession: Option.none(),
          dashboard: initDashboardModel(defaultSettings()),
        })
      ),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Logout" })).toExist()
    );
  });

  test("clicking logout dispatches ClickedLogout and returns to the login form", () => {
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
      Scene.click(Scene.role("button", { name: "Logout (phil)" })),
      Scene.Command.resolveAll(
        [ClearSession, CompletedClearSession()],
        [Logout, CompletedLogout()]
      ),
      Scene.Mount.expectEnded(MountLatencyChart),
      Scene.Mount.expectEnded(MountPacketLossChart),
      Scene.Mount.expectEnded(MountJitterChart),
      Scene.Mount.expectEnded(MountSpeedChart),
      Scene.expect(Scene.role("button", { name: "Sign In" })).toExist()
    );
  });
});
