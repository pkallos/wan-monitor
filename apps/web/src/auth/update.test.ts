import { Option } from "effect";
import { Story } from "foldkit";
import { describe, expect, test } from "vitest";
import {
  ClearSession,
  FetchMe,
  Login,
  Logout,
  SaveSession,
} from "@/auth/command";
import {
  ChangedPassword,
  ChangedUsername,
  ClickedLogout,
  CompletedClearSession,
  CompletedLogout,
  CompletedSaveSession,
  FailedFetchMe,
  FailedLogin,
  GotDashboardMessage,
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
} from "@/auth/model";
import { update } from "@/auth/update";
import {
  FetchConnectivityStatus,
  FetchEarliestData,
  FetchMetrics,
  FetchSpeedtestHistory,
  initModel as initDashboardModel,
  LoadedTheme,
  LoadTheme,
  Preset,
  SpeedtestTriggerAsyncData,
  SucceededFetchConnectivityStatus,
  SucceededFetchEarliestData,
  SucceededFetchMetrics,
  SucceededFetchSpeedtestHistory,
  SucceededTriggerSpeedtest,
} from "@/dashboard";
import { ToastTest } from "@/dashboard/toast";

const DEFAULT_DATE_RANGE = Preset({ preset: "last30d" });

function assertLoggedIn(model: Model): LoggedIn {
  if (model._tag !== "LoggedIn") {
    throw new Error(`expected LoggedIn, got ${model._tag}`);
  }
  return model;
}

function assertLoggedOut(model: Model): LoggedOut {
  if (model._tag !== "LoggedOut") {
    throw new Error(`expected LoggedOut, got ${model._tag}`);
  }
  return model;
}

const resolveDashboardEntry = (token: string) =>
  Story.Command.resolveAll(
    [
      FetchMetrics({
        token,
        dateRange: DEFAULT_DATE_RANGE,
        maybeEarliestDataMs: Option.none(),
      }),
      SucceededFetchMetrics({ metrics: [], nowMs: 0 }),
    ],
    [
      FetchSpeedtestHistory({
        token,
        dateRange: DEFAULT_DATE_RANGE,
        maybeEarliestDataMs: Option.none(),
      }),
      SucceededFetchSpeedtestHistory({ history: [] }),
    ],
    [
      FetchConnectivityStatus({
        token,
        dateRange: DEFAULT_DATE_RANGE,
        maybeEarliestDataMs: Option.none(),
      }),
      SucceededFetchConnectivityStatus({
        points: [],
        uptimePercentage: 100,
        startTimeMs: 0,
        endTimeMs: 3_600_000,
        granularity: "1m",
      }),
    ],
    [LoadTheme, LoadedTheme({ theme: "light" })],
    [
      FetchEarliestData({ token }),
      SucceededFetchEarliestData({ earliestMs: Option.none() }),
    ]
  );

describe("auth update", () => {
  test("auth not required transitions Checking to LoggedIn with no session", () => {
    Story.story(
      update,
      Story.with(Checking({ maybeToken: Option.none() })),
      Story.message(SucceededFetchAuthStatus({ authRequired: false })),
      Story.model((model) => {
        expect(Option.isNone(assertLoggedIn(model).maybeSession)).toBe(true);
      }),
      resolveDashboardEntry("")
    );
  });

  test("auth required with no stored token transitions Checking to LoggedOut", () => {
    Story.story(
      update,
      Story.with(Checking({ maybeToken: Option.none() })),
      Story.message(SucceededFetchAuthStatus({ authRequired: true })),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("auth required with a stored token dispatches FetchMe and stays in Checking", () => {
    Story.story(
      update,
      Story.with(Checking({ maybeToken: Option.some("stored-token") })),
      Story.message(SucceededFetchAuthStatus({ authRequired: true })),
      Story.Command.expectExact(FetchMe({ token: "stored-token" })),
      Story.model((model) => {
        expect(model._tag).toBe("Checking");
      }),
      Story.Command.resolve(FetchMe, SucceededFetchMe({ username: "phil" })),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedIn");
      }),
      resolveDashboardEntry("stored-token")
    );
  });

  test("a validated stored token transitions Checking to LoggedIn", () => {
    Story.story(
      update,
      Story.with(Checking({ maybeToken: Option.some("stored-token") })),
      Story.message(SucceededFetchMe({ username: "phil" })),
      Story.model((model) => {
        expect(Option.getOrThrow(assertLoggedIn(model).maybeSession)).toEqual(
          Session.make({ token: "stored-token", username: "phil" })
        );
      }),
      resolveDashboardEntry("stored-token")
    );
  });

  test("a rejected stored token transitions Checking to LoggedOut and clears the session", () => {
    Story.story(
      update,
      Story.with(Checking({ maybeToken: Option.some("stale-token") })),
      Story.message(FailedFetchMe({ error: "unauthorized" })),
      Story.Command.expectExact(ClearSession),
      Story.Command.resolve(ClearSession, CompletedClearSession()),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });

  test("changing the username field updates LoggedOut", () => {
    Story.story(
      update,
      Story.with(initLoggedOut()),
      Story.message(ChangedUsername({ value: "phil" })),
      Story.model((model) => {
        expect(assertLoggedOut(model).username).toBe("phil");
      })
    );
  });

  test("changing the password field updates LoggedOut", () => {
    Story.story(
      update,
      Story.with(initLoggedOut()),
      Story.message(ChangedPassword({ value: "hunter2" })),
      Story.model((model) => {
        expect(assertLoggedOut(model).password).toBe("hunter2");
      })
    );
  });

  test("submitting the login form dispatches Login with the entered credentials", () => {
    Story.story(
      update,
      Story.with(
        LoggedOut({
          username: "phil",
          password: "hunter2",
          isSubmitting: false,
          maybeError: Option.none(),
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
      Story.Command.expectHas(
        SaveSession({ token: "abc123", username: "phil" })
      ),
      Story.Command.resolve(SaveSession, CompletedSaveSession()),
      resolveDashboardEntry("abc123")
    );
  });

  test("a successful login transitions LoggedOut to LoggedIn and saves the session", () => {
    Story.story(
      update,
      Story.with(
        LoggedOut({
          username: "phil",
          password: "hunter2",
          isSubmitting: true,
          maybeError: Option.none(),
        })
      ),
      Story.message(SucceededLogin({ token: "abc123", username: "phil" })),
      Story.Command.expectHas(
        SaveSession({ token: "abc123", username: "phil" })
      ),
      Story.Command.resolve(SaveSession, CompletedSaveSession()),
      Story.model((model) => {
        expect(Option.getOrThrow(assertLoggedIn(model).maybeSession)).toEqual(
          Session.make({ token: "abc123", username: "phil" })
        );
      }),
      resolveDashboardEntry("abc123")
    );
  });

  test("a failed login stays LoggedOut, surfaces the error, and clears isSubmitting", () => {
    Story.story(
      update,
      Story.with(
        LoggedOut({
          username: "phil",
          password: "wrong",
          isSubmitting: true,
          maybeError: Option.none(),
        })
      ),
      Story.message(
        FailedLogin({
          error: "Incorrect username or password. Please try again.",
        })
      ),
      Story.model((model) => {
        const loggedOut = assertLoggedOut(model);
        expect(loggedOut.isSubmitting).toBe(false);
        expect(Option.getOrThrow(loggedOut.maybeError)).toBe(
          "Incorrect username or password. Please try again."
        );
      })
    );
  });

  test("logging out transitions LoggedIn to LoggedOut and clears the session", () => {
    Story.story(
      update,
      Story.with(
        LoggedIn({
          maybeSession: Option.some(
            Session.make({ token: "abc123", username: "phil" })
          ),
          dashboard: initDashboardModel(),
        })
      ),
      Story.message(ClickedLogout()),
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

  test("CompletedClearSession is a no-op acknowledgment", () => {
    Story.story(
      update,
      Story.with(initLoggedOut()),
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
        ...initDashboardModel(),
        speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
      },
    });

    Story.story(
      update,
      Story.with(loggedIn),
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
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
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
            token: "abc123",
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          SucceededFetchMetrics({ metrics: [], nowMs: 0 }),
        ],
        [
          FetchSpeedtestHistory({
            token: "abc123",
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          }),
          SucceededFetchSpeedtestHistory({ history: [] }),
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
    dashboard: initDashboardModel(),
  });

  test("SucceededFetchAuthStatus is ignored once past Checking", () => {
    Story.story(
      update,
      Story.with(loggedIn),
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
      Story.with(loggedIn),
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
      Story.with(loggedIn),
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
      Story.with(loggedIn),
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
      Story.with(loggedIn),
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
      Story.with(loggedIn),
      Story.message(FailedLogin({ error: "stale" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model).toBe(loggedIn);
      })
    );
  });

  test("a dashboard message is dropped once logged out", () => {
    Story.story(
      update,
      Story.with(initLoggedOut()),
      Story.message(
        GotDashboardMessage({
          message: SucceededFetchMetrics({ metrics: [], nowMs: 0 }),
        })
      ),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model._tag).toBe("LoggedOut");
      })
    );
  });
});
