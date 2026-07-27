import { Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, test } from "vitest";
import {
  clearSession,
  fetchAuthStatus,
  fetchMe,
  login,
  logout,
  saveSession,
} from "@/auth/command";

const failingKeyValueStore = Layer.succeed(
  KeyValueStore.KeyValueStore,
  KeyValueStore.make({
    get: () => Effect.succeed(undefined),
    getUint8Array: () => Effect.succeed(undefined),
    set: () =>
      Effect.fail(
        new KeyValueStore.KeyValueStoreError({
          message: "storage is full",
          method: "set",
        })
      ),
    remove: () =>
      Effect.fail(
        new KeyValueStore.KeyValueStoreError({
          message: "storage is unavailable",
          method: "remove",
        })
      ),
    clear: Effect.succeed(undefined),
    size: Effect.succeed(0),
  })
);

const mockHttpClient = (status: number, body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          })
        )
      )
    )
  );

const transportFailureHttpClient = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          description: "network unreachable",
        }),
      })
    )
  )
);

describe("login", () => {
  test("decodes a successful login response into SucceededLogin", async () => {
    const result = await login({
      username: "phil",
      password: "hunter2",
    }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          token: "abc123",
          expiresAt: "2026-08-01T00:00:00.000Z",
          username: "phil",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "SucceededLogin",
      token: "abc123",
      username: "phil",
    });
  });

  test("maps a rejected login into FailedLogin with the same copy as the current UI", async () => {
    const result = await login({
      username: "phil",
      password: "wrong",
    }).pipe(
      Effect.provide(
        mockHttpClient(401, {
          _tag: "InvalidCredentials",
          message: "Invalid username or password",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedLogin",
      error: "Incorrect username or password. Please try again.",
    });
  });

  test("maps AuthNotConfigured into the admin-contact message", async () => {
    const result = await login({ username: "phil", password: "hunter2" }).pipe(
      Effect.provide(
        mockHttpClient(503, {
          _tag: "AuthNotConfigured",
          message: "Auth is not configured",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedLogin",
      error:
        "Authentication is not configured on the server. Contact your administrator.",
    });
  });

  test("maps MissingCredentials into the required-fields message", async () => {
    const result = await login({ username: "", password: "" }).pipe(
      Effect.provide(
        mockHttpClient(400, {
          _tag: "MissingCredentials",
          message: "Username and password are required",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedLogin",
      error: "Username and password are required.",
    });
  });

  test("maps a transport failure into the connection message", async () => {
    const result = await login({ username: "phil", password: "hunter2" }).pipe(
      Effect.provide(transportFailureHttpClient),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedLogin",
      error: "Unable to connect to server. Please check your connection.",
    });
  });

  test("falls back to a generic message for anything else", async () => {
    const result = await login({ username: "phil", password: "hunter2" }).pipe(
      Effect.provide(mockHttpClient(500, "Internal error")),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedLogin",
      error: "Something went wrong. Please try again.",
    });
  });
});

describe("fetchAuthStatus", () => {
  test("decodes a successful response into SucceededFetchAuthStatus", async () => {
    const result = await fetchAuthStatus.pipe(
      Effect.provide(mockHttpClient(200, { authRequired: true })),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "SucceededFetchAuthStatus",
      authRequired: true,
    });
  });

  test("maps a transport failure into FailedFetchAuthStatus", async () => {
    const result = await fetchAuthStatus.pipe(
      Effect.provide(transportFailureHttpClient),
      Effect.runPromise
    );

    expect(result._tag).toBe("FailedFetchAuthStatus");
  });
});

describe("fetchMe", () => {
  test("decodes a successful response into SucceededFetchMe", async () => {
    const result = await fetchMe({ token: "abc123" }).pipe(
      Effect.provide(
        mockHttpClient(200, { username: "phil", authenticated: true })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ _tag: "SucceededFetchMe", username: "phil" });
  });

  test("maps a rejected token into FailedFetchMe", async () => {
    const result = await fetchMe({ token: "stale-token" }).pipe(
      Effect.provide(mockHttpClient(401, "Unauthorized")),
      Effect.runPromise
    );

    expect(result._tag).toBe("FailedFetchMe");
  });
});

describe("logout", () => {
  test("acknowledges completion on a successful server response", async () => {
    const result = await logout.pipe(
      Effect.provide(
        mockHttpClient(200, { success: true, message: "Logged out" })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ _tag: "CompletedLogout" });
  });

  test("still acknowledges completion when the server request fails", async () => {
    const result = await logout.pipe(
      Effect.provide(mockHttpClient(500, "Internal error")),
      Effect.runPromise
    );

    expect(result).toEqual({ _tag: "CompletedLogout" });
  });
});

describe("saveSession", () => {
  test("stores the token and succeeds", async () => {
    const result = await Effect.gen(function* () {
      const settled = yield* saveSession({ token: "abc123" });
      const store = yield* KeyValueStore.KeyValueStore;
      const stored = yield* store.get("wan_monitor_token");
      return { settled, stored };
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result.settled).toEqual({ _tag: "CompletedSaveSession" });
    expect(result.stored).toBe("abc123");
  });

  test("maps a storage failure into FailedSaveSession", async () => {
    const result = await saveSession({ token: "abc123" }).pipe(
      Effect.provide(failingKeyValueStore),
      Effect.runPromise
    );

    expect(result._tag).toBe("FailedSaveSession");
  });
});

describe("clearSession", () => {
  test("removes the token and succeeds", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set("wan_monitor_token", "abc123");
      const settled = yield* clearSession;
      const stored = yield* store.get("wan_monitor_token");
      return { settled, stored };
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result.settled).toEqual({ _tag: "CompletedClearSession" });
    expect(result.stored).toBeUndefined();
  });

  test("maps a storage failure into FailedClearSession", async () => {
    const result = await clearSession.pipe(
      Effect.provide(failingKeyValueStore),
      Effect.runPromise
    );

    expect(result._tag).toBe("FailedClearSession");
  });
});
