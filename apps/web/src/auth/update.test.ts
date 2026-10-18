import { Menu } from "@foldkit/ui";
import { Match as M, Option } from "effect";
import { Story } from "foldkit";
import { describe, expect, test, vi } from "vitest";
import {
  ClearSession,
  FetchAuthStatus,
  FetchMe,
  Login,
  Logout,
  SaveSession,
} from "@/auth/command";
import {
  ChangedPassword,
  ChangedUsername,
  ClickedRetryConnection,
  ClickedSignOut,
  CompletedClearSession,
  CompletedLogout,
  CompletedSaveSession,
  FailedFetchAuthStatus,
  FailedFetchMe,
  FailedLogin,
  GotDashboardMessage,
  RejectedToken,
  SubmittedLogin,
  SucceededFetchAuthStatus,
  SucceededFetchMe,
  SucceededLogin,
} from "@/auth/message";
import {
  Checking,
  initLoggedOut,
  LoggedIn,
  LoggedOut,
  type Model,
  Session,
  Unreachable,
  ValidatingToken,
} from "@/auth/model";
import { update } from "@/auth/update";
import {
  ApplyTheme,
  ChangedSystemTheme,
  CompletedApplyTheme,
  type DateRangeSelection,
  FailedFetchOutages,
  FailedFetchPingHosts,
  FailedFetchSummary,
  FetchConnectivityStatus,
  FetchEarliestData,
  FetchLiveConnectivity,
  FetchMetrics,
  FetchOutages,
  FetchPingHosts,
  FetchSpeedtestHistory,
  FetchSummary,
  GotMenuMessage,
  Interacted,
  Preset,
  initModel as realInitDashboardModel,
  SpeedtestTriggerAsyncData,
  SucceededFetchConnectivityStatus,
  SucceededFetchEarliestData,
  SucceededFetchLiveConnectivity,
  SucceededFetchMetrics,
  SucceededFetchSpeedtestHistory,
  SucceededTriggerSpeedtest,
  settingsFromModel,
} from "@/dashboard";
import { MENU_ITEMS } from "@/dashboard/menu";
import { DEFAULT_REQUEST } from "@/dashboard/testFixtures";
import { ToastTest } from "@/dashboard/toast";
import { defaultSettings, type Settings } from "@/storage";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");

const initDashboardModel = (
  settings: Parameters<typeof realInitDashboardModel>[0]
) => realInitDashboardModel(settings, NOW_MS);

const DEFAULT_DATE_RANGE = Preset({ preset: "last30d" });
const maybeToken = Option.some("abc123");

// Each fetch resolves its window once and reports it back, so the dashboard's
// charts paint the range that was actually requested.
const METRICS_WINDOW = {
  startTimeMs: 0,
  endTimeMs: 30 * 24 * 60 * 60 * 1000,
  granularity: "1h" as const,
};
const SPEEDTEST_WINDOW = {
  startTimeMs: METRICS_WINDOW.startTimeMs,
  endTimeMs: METRICS_WINDOW.endTimeMs,
};

const assertLoggedIn = (model: Model): LoggedIn =>
  M.value(model).pipe(
    M.tag("LoggedIn", (loggedIn) => loggedIn),
    M.orElse((other) => {
      throw new Error(`expected LoggedIn, got ${other._tag}`);
    })
  );

const assertLoggedOut = (model: Model): LoggedOut =>
  M.value(model).pipe(
    M.tag("LoggedOut", (loggedOut) => loggedOut),
    M.orElse((other) => {
      throw new Error(`expected LoggedOut, got ${other._tag}`);
    })
  );

const resolveDashboardEntry = (
  maybeToken: Option.Option<string>,
  dateRange: DateRangeSelection = DEFAULT_DATE_RANGE
) =>
  Story.Command.resolveAll(
    [
      FetchMetrics({
        maybeToken,
        dateRange,
        maybeEarliestDataMs: Option.none(),
      }),
      SucceededFetchMetrics({
        metrics: [],
        nowMs: 0,
        ...METRICS_WINDOW,
        request: DEFAULT_REQUEST,
      }),
    ],
    [
      FetchSpeedtestHistory({
        maybeToken,
        dateRange,
        maybeEarliestDataMs: Option.none(),
      }),
      SucceededFetchSpeedtestHistory({
        history: [],
        ...SPEEDTEST_WINDOW,
        request: DEFAULT_REQUEST,
      }),
    ],
    [
      FetchConnectivityStatus({
        maybeToken,
        dateRange,
        maybeEarliestDataMs: Option.none(),
      }),
      SucceededFetchConnectivityStatus({
        request: DEFAULT_REQUEST,
        points: [],
        maybeUptimePercentage: Option.some(100),
        maybeAvailabilityPercentage: Option.some(100),
        coveragePercentage: 100,
        startTimeMs: 0,
        endTimeMs: 3_600_000,
        granularity: "1m",
      }),
    ],
    [
      FetchLiveConnectivity({ maybeToken }),
      SucceededFetchLiveConnectivity({
        status: "up",
        maybeLastSampleAtMs: Option.none(),
      }),
    ],
    [ApplyTheme, CompletedApplyTheme()],
    [
      FetchEarliestData({ maybeToken }),
      SucceededFetchEarliestData({ earliestMs: Option.none() }),
    ],
    [
      FetchSummary({
        maybeToken,
        dateRange,
        maybeEarliestDataMs: Option.none(),
      }),
      FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
    ],
    [
      FetchOutages({
        maybeToken,
        dateRange,
        maybeEarliestDataMs: Option.none(),
      }),
      FailedFetchOutages({ error: "skip", request: DEFAULT_REQUEST }),
    ],
    [FetchPingHosts({ maybeToken }), FailedFetchPingHosts({ error: "skip" })]
  );

const chooseLogoutFromMenu = () =>
  GotDashboardMessage({
    message: GotMenuMessage({
      message: Menu.Message.SelectedItem({
        index: MENU_ITEMS.indexOf("Logout"),
        item: "Logout",
      }),
    }),
  });

describe("auth update", () => {
  test("auth not required transitions Checking to LoggedIn with no session", () => {
    Story.story(
      update,
      Story.given(
        Checking({ maybeToken: Option.none(), settings: defaultSettings() })
      ),
      Story.message(SucceededFetchAuthStatus({ authRequired: false })),
      Story.model((model) => {
        expect(Option.isNone(assertLoggedIn(model).maybeSession)).toBe(true);
      }),
      resolveDashboardEntry(Option.none())
    );
  });

  test("a Checking model seeded with non-default settings produces a dashboard that matches them", () => {
    const settings: Settings = {
      theme: "dark",
      dateRange: Preset({ preset: "last7d" }),
      isPaused: true,
      latencyView: "all",
    };

    Story.story(
      update,
      Story.given(Checking({ maybeToken: Option.none(), settings })),
      Story.message(SucceededFetchAuthStatus({ authRequired: false })),
      Story.model((model) => {
        expect(settingsFromModel(assertLoggedIn(model).dashboard)).toEqual(
          settings
        );
      }),
      resolveDashboardEntry(Option.none(), settings.dateRange)
    );
  });

  test("auth required with no stored token transitions Checking to LoggedOut", () => {
    Story.story(
      update,
      Story.given(
        Checking({ maybeToken: Option.none(), settings: defaultSettings() })
      ),
      Story.message(SucceededFetchAuthStatus({ authRequired: true })),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("auth required with a stored token moves to ValidatingToken and asks /me", () => {
    const settings = defaultSettings();

    Story.story(
      update,
      Story.given(
        Checking({ maybeToken: Option.some("stored-token"), settings })
      ),
      Story.message(SucceededFetchAuthStatus({ authRequired: true })),
      Story.Command.expectExact(FetchMe({ token: "stored-token" })),
      Story.model((model) => {
        expect(model).toEqual(
          ValidatingToken({ token: "stored-token", settings })
        );
      }),
      Story.Command.resolve(FetchMe, SucceededFetchMe({ username: "phil" })),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedIn");
      }),
      resolveDashboardEntry(Option.some("stored-token"))
    );
  });

  test("a validated stored token transitions ValidatingToken to LoggedIn with its session", () => {
    Story.story(
      update,
      Story.given(
        ValidatingToken({
          token: "stored-token",
          settings: defaultSettings(),
        })
      ),
      Story.message(SucceededFetchMe({ username: "phil" })),
      Story.model((model) => {
        expect(assertLoggedIn(model).maybeSession).toEqual(
          Option.some(Session.make({ token: "stored-token", username: "phil" }))
        );
      }),
      resolveDashboardEntry(Option.some("stored-token"))
    );
  });

  test("a rejected stored token transitions ValidatingToken to LoggedOut and clears the session", () => {
    Story.story(
      update,
      Story.given(
        ValidatingToken({
          token: "stale-token",
          settings: defaultSettings(),
        })
      ),
      Story.message(RejectedToken()),
      Story.Command.expectExact(ClearSession),
      Story.Command.resolve(ClearSession, CompletedClearSession()),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("a stored token the server could not check is kept, with the session left in storage", () => {
    const settings = defaultSettings();

    Story.story(
      update,
      Story.given(ValidatingToken({ token: "stored-token", settings })),
      Story.message(FailedFetchMe({ error: "TransportError" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toEqual(
          Unreachable({ token: "stored-token", settings, retry: "Idle" })
        );
      })
    );
  });

  describe.each([
    ["with no stored token", Option.none<string>()],
    ["with a stored token", Option.some("stored-token")],
  ] as const)("Checking the status %s", (_name, maybeStoredToken) => {
    test.each([
      ["SucceededFetchMe", SucceededFetchMe({ username: "phil" })],
      ["RejectedToken", RejectedToken()],
      ["FailedFetchMe", FailedFetchMe({ error: "TransportError" })],
    ] as const)("ignores a late %s", (_messageName, message) => {
      const checking = Checking({
        maybeToken: maybeStoredToken,
        settings: defaultSettings(),
      });

      Story.story(
        update,
        Story.given(checking),
        Story.message(message),
        Story.Command.expectNone(),
        Story.model((model) => {
          expect(model).toEqual(checking);
        })
      );
    });
  });

  test.each([
    [
      "SucceededFetchAuthStatus",
      SucceededFetchAuthStatus({ authRequired: true }),
    ],
    ["FailedFetchAuthStatus", FailedFetchAuthStatus({ error: "boom" })],
  ] as const)(
    "a %s that arrives while ValidatingToken is ignored",
    (_name, message) => {
      const validating = ValidatingToken({
        token: "stored-token",
        settings: defaultSettings(),
      });

      Story.story(
        update,
        Story.given(validating),
        Story.message(message),
        Story.Command.expectNone(),
        Story.model((model) => {
          expect(model).toEqual(validating);
        })
      );
    }
  );

  test("an unreachable server on the status check keeps a stored token", () => {
    const settings = defaultSettings();

    Story.story(
      update,
      Story.given(
        Checking({ maybeToken: Option.some("stored-token"), settings })
      ),
      Story.message(FailedFetchAuthStatus({ error: "TransportError" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toEqual(
          Unreachable({ token: "stored-token", settings, retry: "Idle" })
        );
      })
    );
  });

  test("an unreachable server on the status check with no stored token shows the login form", () => {
    Story.story(
      update,
      Story.given(
        Checking({ maybeToken: Option.none(), settings: defaultSettings() })
      ),
      Story.message(FailedFetchAuthStatus({ error: "TransportError" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("retrying from Unreachable stays on that screen, checks the status again and then the token", () => {
    const settings = defaultSettings();

    Story.story(
      update,
      Story.given(
        Unreachable({ token: "stored-token", settings, retry: "Idle" })
      ),
      Story.message(ClickedRetryConnection()),
      Story.Command.expectExact(FetchAuthStatus()),
      Story.model((model) => {
        expect(model).toEqual(
          Unreachable({ token: "stored-token", settings, retry: "Running" })
        );
      }),
      Story.Command.resolve(
        FetchAuthStatus,
        SucceededFetchAuthStatus({ authRequired: true })
      ),
      Story.Command.expectExact(FetchMe({ token: "stored-token" })),
      Story.model((model) => {
        expect(model).toEqual(
          Unreachable({ token: "stored-token", settings, retry: "Running" })
        );
      }),
      Story.Command.resolve(FetchMe, SucceededFetchMe({ username: "phil" })),
      Story.model((model) => {
        expect(assertLoggedIn(model).maybeSession).toEqual(
          Option.some(Session.make({ token: "stored-token", username: "phil" }))
        );
      }),
      resolveDashboardEntry(Option.some("stored-token"))
    );
  });

  test("a retry accepts a token answer at any point while it runs", () => {
    Story.story(
      update,
      Story.given(
        Unreachable({
          token: "stored-token",
          settings: defaultSettings(),
          retry: "Running",
        })
      ),
      Story.message(SucceededFetchMe({ username: "phil" })),
      Story.model((model) => {
        expect(assertLoggedIn(model).maybeSession).toEqual(
          Option.some(Session.make({ token: "stored-token", username: "phil" }))
        );
      }),
      resolveDashboardEntry(Option.some("stored-token"))
    );
  });

  test("a second Retry while one is running does nothing", () => {
    const retrying = Unreachable({
      token: "stored-token",
      settings: defaultSettings(),
      retry: "Running",
    });

    Story.story(
      update,
      Story.given(retrying),
      Story.message(ClickedRetryConnection()),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toEqual(retrying);
      })
    );
  });

  test("a retry that still cannot reach the server stays Unreachable and records the failure", () => {
    const settings = defaultSettings();

    Story.story(
      update,
      Story.given(
        Unreachable({ token: "stored-token", settings, retry: "Idle" })
      ),
      Story.message(ClickedRetryConnection()),
      Story.Command.resolve(
        FetchAuthStatus,
        FailedFetchAuthStatus({ error: "TransportError" })
      ),
      Story.model((model) => {
        expect(model).toEqual(
          Unreachable({ token: "stored-token", settings, retry: "Failed" })
        );
      })
    );
  });

  test("a retry whose token check fails stays Unreachable and records the failure", () => {
    const settings = defaultSettings();

    Story.story(
      update,
      Story.given(
        Unreachable({ token: "stored-token", settings, retry: "Idle" })
      ),
      Story.message(ClickedRetryConnection()),
      Story.Command.resolve(
        FetchAuthStatus,
        SucceededFetchAuthStatus({ authRequired: true })
      ),
      Story.Command.resolve(
        FetchMe,
        FailedFetchMe({ error: "TransportError" })
      ),
      Story.model((model) => {
        expect(model).toEqual(
          Unreachable({ token: "stored-token", settings, retry: "Failed" })
        );
      })
    );
  });

  test("a retry that finds the token rejected clears the session", () => {
    Story.story(
      update,
      Story.given(
        Unreachable({
          token: "stale-token",
          settings: defaultSettings(),
          retry: "Idle",
        })
      ),
      Story.message(ClickedRetryConnection()),
      Story.Command.resolve(
        FetchAuthStatus,
        SucceededFetchAuthStatus({ authRequired: true })
      ),
      Story.Command.resolve(FetchMe, RejectedToken()),
      Story.Command.expectExact(ClearSession),
      Story.Command.resolve(ClearSession, CompletedClearSession()),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("a retry that finds auth switched off enters the dashboard", () => {
    Story.story(
      update,
      Story.given(
        Unreachable({
          token: "stored-token",
          settings: defaultSettings(),
          retry: "Idle",
        })
      ),
      Story.message(ClickedRetryConnection()),
      Story.Command.resolve(
        FetchAuthStatus,
        SucceededFetchAuthStatus({ authRequired: false })
      ),
      Story.model((model) => {
        expect(Option.isNone(assertLoggedIn(model).maybeSession)).toBe(true);
      }),
      resolveDashboardEntry(Option.none())
    );
  });

  describe.each(["Idle", "Failed"] as const)(
    "an Unreachable screen with retry %s",
    (retry) => {
      test.each([
        ["FailedFetchMe", FailedFetchMe({ error: "TransportError" })],
        ["FailedFetchAuthStatus", FailedFetchAuthStatus({ error: "boom" })],
        ["RejectedToken", RejectedToken()],
        ["SucceededFetchMe", SucceededFetchMe({ username: "phil" })],
        [
          "SucceededFetchAuthStatus",
          SucceededFetchAuthStatus({ authRequired: true }),
        ],
      ] as const)("ignores a late %s", (_name, message) => {
        const screen = Unreachable({
          token: "stored-token",
          settings: defaultSettings(),
          retry,
        });

        Story.story(
          update,
          Story.given(screen),
          Story.message(message),
          Story.Command.expectNone(),
          Story.model((model) => {
            expect(model).toEqual(screen);
          })
        );
      });

      test("starts another retry when Retry is clicked", () => {
        const settings = defaultSettings();

        Story.story(
          update,
          Story.given(Unreachable({ token: "stored-token", settings, retry })),
          Story.message(ClickedRetryConnection()),
          Story.Command.expectExact(FetchAuthStatus()),
          Story.model((model) => {
            expect(model).toEqual(
              Unreachable({ token: "stored-token", settings, retry: "Running" })
            );
          }),
          Story.Command.resolve(
            FetchAuthStatus,
            FailedFetchAuthStatus({ error: "TransportError" })
          )
        );
      });
    }
  );

  test("an answer that arrives after Sign out leaves the login form alone", () => {
    Story.story(
      update,
      Story.given(
        Unreachable({
          token: "stored-token",
          settings: defaultSettings(),
          retry: "Running",
        })
      ),
      Story.message(ClickedSignOut()),
      Story.Command.expectExact(ClearSession),
      Story.Command.resolve(ClearSession, CompletedClearSession()),
      Story.message(SucceededFetchMe({ username: "phil" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      }),
      Story.message(RejectedToken()),
      Story.Command.expectNone(),
      Story.message(FailedFetchMe({ error: "TransportError" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("signing out from Unreachable clears the stored session and shows the login form", () => {
    Story.story(
      update,
      Story.given(
        Unreachable({
          token: "stored-token",
          settings: defaultSettings(),
          retry: "Idle",
        })
      ),
      Story.message(ClickedSignOut()),
      Story.Command.expectExact(ClearSession),
      Story.Command.resolve(ClearSession, CompletedClearSession()),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test.each([
    ["FailedFetchMe", FailedFetchMe({ error: "TransportError" })],
    ["RejectedToken", RejectedToken()],
    ["FailedFetchAuthStatus", FailedFetchAuthStatus({ error: "boom" })],
    ["ClickedRetryConnection", ClickedRetryConnection()],
    ["ClickedSignOut", ClickedSignOut()],
  ] as const)(
    "a late %s does not end a signed-in session",
    (_name, message) => {
      const model = LoggedIn({
        maybeSession: Option.some(
          Session.make({ token: "abc123", username: "phil" })
        ),
        dashboard: initDashboardModel(defaultSettings()),
      });

      Story.story(
        update,
        Story.given(model),
        Story.message(message),
        Story.Command.expectNone(),
        Story.model((next) => {
          expect(next).toEqual(model);
        })
      );
    }
  );

  test("changing the username field updates LoggedOut", () => {
    Story.story(
      update,
      Story.given(initLoggedOut(defaultSettings())),
      Story.message(ChangedUsername({ value: "phil" })),
      Story.model((model) => {
        expect(assertLoggedOut(model).username).toBe("phil");
      })
    );
  });

  test("changing the password field updates LoggedOut", () => {
    Story.story(
      update,
      Story.given(initLoggedOut(defaultSettings())),
      Story.message(ChangedPassword({ value: "hunter2" })),
      Story.model((model) => {
        expect(assertLoggedOut(model).password).toBe("hunter2");
      })
    );
  });

  test("submitting the login form dispatches Login with the entered credentials", () => {
    Story.story(
      update,
      Story.given(
        LoggedOut({
          username: "phil",
          password: "hunter2",
          isSubmitting: false,
          maybeError: Option.none(),
          settings: defaultSettings(),
        })
      ),
      Story.message(SubmittedLogin()),
      Story.Command.expectExact(
        Login({ username: "phil", password: "hunter2" })
      ),
      Story.model((model) => {
        expect(assertLoggedOut(model).isSubmitting).toBe(true);
      }),
      Story.Command.resolve(
        Login,
        SucceededLogin({ token: "abc123", username: "phil" })
      ),
      Story.Command.expectHas(SaveSession({ token: "abc123" })),
      Story.Command.resolve(SaveSession, CompletedSaveSession()),
      resolveDashboardEntry(Option.some("abc123"))
    );
  });

  test("a successful login transitions LoggedOut to LoggedIn and saves the session", () => {
    Story.story(
      update,
      Story.given(
        LoggedOut({
          username: "phil",
          password: "hunter2",
          isSubmitting: true,
          maybeError: Option.none(),
          settings: defaultSettings(),
        })
      ),
      Story.message(SucceededLogin({ token: "abc123", username: "phil" })),
      Story.Command.expectHas(SaveSession({ token: "abc123" })),
      Story.Command.resolve(SaveSession, CompletedSaveSession()),
      Story.model((model) => {
        expect(assertLoggedIn(model).maybeSession).toEqual(
          Option.some(Session.make({ token: "abc123", username: "phil" }))
        );
      }),
      resolveDashboardEntry(Option.some("abc123"))
    );
  });

  test("a failed login stays LoggedOut, surfaces the error, and clears isSubmitting", () => {
    Story.story(
      update,
      Story.given(
        LoggedOut({
          username: "phil",
          password: "wrong",
          isSubmitting: true,
          maybeError: Option.none(),
          settings: defaultSettings(),
        })
      ),
      Story.message(
        FailedLogin({
          error: "Incorrect username or password.",
        })
      ),
      Story.model((model) => {
        const loggedOut = assertLoggedOut(model);
        expect(loggedOut.isSubmitting).toBe(false);
        expect(loggedOut.maybeError).toEqual(
          Option.some("Incorrect username or password.")
        );
      })
    );
  });

  test("logging out transitions LoggedIn to LoggedOut and clears the session", () => {
    Story.story(
      update,
      Story.given(
        LoggedIn({
          maybeSession: Option.some(
            Session.make({ token: "abc123", username: "phil" })
          ),
          dashboard: initDashboardModel(defaultSettings()),
        })
      ),
      Story.message(chooseLogoutFromMenu()),
      Story.Command.expectHas(ClearSession),
      Story.Command.expectHas(Logout),
      Story.Command.resolveAll(
        [ClearSession, CompletedClearSession()],
        [Logout, CompletedLogout()]
      ),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("logging out carries the dashboard's live theme and pause state into LoggedOut", () => {
    const settings: Settings = {
      theme: "dark",
      dateRange: DEFAULT_DATE_RANGE,
      isPaused: true,
      latencyView: "all",
    };
    const dashboard = {
      ...initDashboardModel(defaultSettings()),
      theme: settings.theme,
      isPaused: settings.isPaused,
    };

    Story.story(
      update,
      Story.given(
        LoggedIn({
          maybeSession: Option.some(
            Session.make({ token: "abc123", username: "phil" })
          ),
          dashboard,
        })
      ),
      Story.message(chooseLogoutFromMenu()),
      Story.Command.resolveAll(
        [ClearSession, CompletedClearSession()],
        [Logout, CompletedLogout()]
      ),
      Story.model((model) => {
        expect(assertLoggedOut(model).settings).toEqual(
          settingsFromModel(dashboard)
        );
      })
    );
  });

  test("CompletedClearSession is a no-op acknowledgment", () => {
    Story.story(
      update,
      Story.given(initLoggedOut(defaultSettings())),
      Story.message(CompletedClearSession()),
      Story.Command.expectNone()
    );
  });

  test("a dashboard message that itself dispatches Commands wraps and forwards them", () => {
    const loggedIn = LoggedIn({
      maybeSession: Option.some(
        Session.make({ token: "abc123", username: "phil" })
      ),
      dashboard: {
        ...initDashboardModel(defaultSettings()),
        speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
      },
    });

    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(
        GotDashboardMessage({
          message: SucceededTriggerSpeedtest({
            downloadMbps: 500,
            uploadMbps: 50,
            pingMs: 8,
          }),
        })
      ),
      Story.Command.expectHas(
        FetchMetrics({
          maybeToken,
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          maybeToken,
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.model((model) => {
        expect(assertLoggedIn(model).dashboard.speedtestTrigger).toEqual(
          SpeedtestTriggerAsyncData.Success({
            data: { downloadMbps: 500, uploadMbps: 50, pingMs: 8 },
          })
        );
      }),
      Story.Command.resolveAll(
        [
          FetchMetrics({
            maybeToken,
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          SucceededFetchMetrics({
            metrics: [],
            nowMs: 0,
            ...METRICS_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchSpeedtestHistory({
            maybeToken,
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          SucceededFetchSpeedtestHistory({
            history: [],
            ...SPEEDTEST_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchSummary({
            maybeToken,
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
        ]
      ),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });
});

describe("auth update: the dashboard's token", () => {
  test("a LoggedIn model with no session fetches without a token", () => {
    const loggedIn = LoggedIn({
      maybeSession: Option.none(),
      dashboard: {
        ...initDashboardModel(defaultSettings()),
        speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
      },
    });

    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(
        GotDashboardMessage({
          message: SucceededTriggerSpeedtest({
            downloadMbps: 500,
            uploadMbps: 50,
            pingMs: 8,
          }),
        })
      ),
      Story.Command.expectHas(
        FetchMetrics({
          maybeToken: Option.none(),
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.resolveAll(
        [
          FetchMetrics({
            maybeToken: Option.none(),
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          SucceededFetchMetrics({
            metrics: [],
            nowMs: 0,
            ...METRICS_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchSpeedtestHistory({
            maybeToken: Option.none(),
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          SucceededFetchSpeedtestHistory({
            history: [],
            ...SPEEDTEST_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchSummary({
            maybeToken: Option.none(),
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
        ]
      ),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });
});

describe("auth update — stale messages arriving in the wrong state", () => {
  const loggedIn = LoggedIn({
    maybeSession: Option.some(
      Session.make({ token: "abc123", username: "phil" })
    ),
    dashboard: initDashboardModel(defaultSettings()),
  });

  test("SucceededFetchAuthStatus is ignored once past Checking", () => {
    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(SucceededFetchAuthStatus({ authRequired: true })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toBe(loggedIn);
      })
    );
  });

  test("SucceededFetchMe is ignored once past Checking", () => {
    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(SucceededFetchMe({ username: "phil" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toBe(loggedIn);
      })
    );
  });

  test("ChangedUsername is ignored while not on the login form", () => {
    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(ChangedUsername({ value: "someone-else" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toBe(loggedIn);
      })
    );
  });

  test("ChangedPassword is ignored while not on the login form", () => {
    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(ChangedPassword({ value: "hunter2" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toBe(loggedIn);
      })
    );
  });

  test("SubmittedLogin is ignored while not on the login form", () => {
    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(SubmittedLogin()),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toBe(loggedIn);
      })
    );
  });

  test("FailedLogin is ignored while not on the login form", () => {
    Story.story(
      update,
      Story.given(loggedIn),
      Story.message(FailedLogin({ error: "stale" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toBe(loggedIn);
      })
    );
  });

  test.each([
    [
      "Checking",
      Checking({
        maybeToken: Option.none(),
        settings: { ...defaultSettings(), theme: "system" },
      }),
    ],
    [
      "ValidatingToken",
      ValidatingToken({
        token: "stored-token",
        settings: { ...defaultSettings(), theme: "system" },
      }),
    ],
    ["LoggedOut", initLoggedOut({ ...defaultSettings(), theme: "system" })],
  ])(
    "an OS theme change repaints the %s screen on the system preference",
    (_state, model) => {
      Story.story(
        update,
        Story.given(model),
        Story.message(GotDashboardMessage({ message: ChangedSystemTheme() })),
        Story.Command.expectExact(ApplyTheme({ theme: "system" })),
        Story.Command.resolve(ApplyTheme, CompletedApplyTheme()),
        Story.model((next) => {
          expect(next).toBe(model);
        })
      );
    }
  );

  test("an OS theme change leaves the login screen alone under an explicit theme", () => {
    Story.story(
      update,
      Story.given(initLoggedOut({ ...defaultSettings(), theme: "dark" })),
      Story.message(GotDashboardMessage({ message: ChangedSystemTheme() })),
      Story.Command.expectNone()
    );
  });

  test("a dashboard message is dropped once logged out", () => {
    Story.story(
      update,
      Story.given(initLoggedOut(defaultSettings())),
      Story.message(
        GotDashboardMessage({
          message: SucceededFetchMetrics({
            metrics: [],
            nowMs: 0,
            ...METRICS_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        })
      ),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });
});

describe("auth update: a dashboard message that changes nothing", () => {
  const loggedIn = (isIdle: boolean) =>
    LoggedIn({
      maybeSession: Option.none(),
      dashboard: { ...initDashboardModel(defaultSettings()), isIdle },
    });

  test("keeps the same LoggedIn model when the dashboard returns its own", () => {
    const model = loggedIn(false);

    expect(
      update(model, GotDashboardMessage({ message: Interacted() })).model
    ).toBe(model);
  });

  test("replaces the LoggedIn model when the dashboard changes", () => {
    const model = loggedIn(true);
    const { model: next } = update(
      model,
      GotDashboardMessage({ message: Interacted() })
    );

    expect(next).not.toBe(model);
    expect(assertLoggedIn(next).dashboard.isIdle).toBe(false);
  });
});

describe("auth update: the dashboard's clock", () => {
  test("starts holding the wall clock at the moment of login", () => {
    const LOGIN_MS = Date.parse("2026-07-28T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(LOGIN_MS);
    try {
      const { model } = update(
        Checking({ maybeToken: Option.none(), settings: defaultSettings() }),
        SucceededFetchAuthStatus({ authRequired: false })
      );

      expect(assertLoggedIn(model).dashboard.nowMs).toBe(LOGIN_MS);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
