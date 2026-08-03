import { BrowserKeyValueStore } from "@effect/platform-browser";
import { Effect, Option, Schema as S } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { Command } from "foldkit";
import { makeClient } from "@/api/client";
import {
  CompletedClearSession,
  CompletedLogout,
  CompletedSaveSession,
  FailedClearSession,
  FailedFetchAuthStatus,
  FailedFetchMe,
  FailedLogin,
  FailedSaveSession,
  SucceededFetchAuthStatus,
  SucceededFetchMe,
  SucceededLogin,
} from "@/auth/message";

export const SESSION_STORAGE_KEY = "wan_monitor_token";

const loginErrorMessage = (error: {
  readonly _tag: string;
  readonly reason?: { readonly _tag: string };
}): string => {
  if (error._tag === "AuthNotConfigured") {
    return "Authentication is not configured on the server. Contact your administrator.";
  }
  if (error._tag === "InvalidCredentials") {
    return "Incorrect username or password. Please try again.";
  }
  if (error._tag === "MissingCredentials") {
    return "Username and password are required.";
  }
  if (
    error._tag === "HttpClientError" &&
    error.reason?._tag === "TransportError"
  ) {
    return "Unable to connect to server. Please check your connection.";
  }
  return "Something went wrong. Please try again.";
};

// Each fetch*/save/clear function still requires its service (HttpClient or
// KeyValueStore) from context, so it can be tested directly against a mock.
// Effect.provide is only applied where each Command wraps it below, which is
// the one place the real transport/storage belongs.

export const fetchAuthStatus = Effect.gen(function* () {
  const client = yield* makeClient(Option.none());
  const status = yield* client.auth.status();
  return SucceededFetchAuthStatus({ authRequired: status.authRequired });
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(FailedFetchAuthStatus({ error: String(error) }))
  )
);

export const fetchMe = ({ token }: { token: string }) =>
  Effect.gen(function* () {
    const client = yield* makeClient(Option.some(token));
    const me = yield* client.auth.me();
    return SucceededFetchMe({ username: me.username });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(FailedFetchMe({ error: String(error) }))
    )
  );

export const login = ({
  username,
  password,
}: {
  username: string;
  password: string;
}) =>
  Effect.gen(function* () {
    const client = yield* makeClient(Option.none());
    const response = yield* client.auth.login({
      payload: { username, password },
    });
    return SucceededLogin({
      token: response.token,
      username: response.username,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(FailedLogin({ error: loginErrorMessage(error) }))
    )
  );

export const logout = Effect.gen(function* () {
  const client = yield* makeClient(Option.none());
  yield* client.auth.logout();
  return CompletedLogout();
}).pipe(Effect.catch(() => Effect.succeed(CompletedLogout())));

export const saveSession = ({ token }: { token: string }) =>
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;
    yield* store.set(SESSION_STORAGE_KEY, token);
    return CompletedSaveSession();
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(FailedSaveSession({ error: String(error) }))
    )
  );

export const clearSession = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  yield* store.remove(SESSION_STORAGE_KEY);
  return CompletedClearSession();
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(FailedClearSession({ error: String(error) }))
  )
);

export const FetchAuthStatus = Command.define("FetchAuthStatus", {
  messages: [SucceededFetchAuthStatus, FailedFetchAuthStatus],
  execute: fetchAuthStatus.pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchMe = Command.define("FetchMe", {
  args: { token: S.String },
  messages: [SucceededFetchMe, FailedFetchMe],
  execute: (args) => fetchMe(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const Login = Command.define("Login", {
  args: { username: S.String, password: S.String },
  messages: [SucceededLogin, FailedLogin],
  execute: (args) => login(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const Logout = Command.define("Logout", {
  messages: [CompletedLogout],
  execute: logout.pipe(Effect.provide(FetchHttpClient.layer)),
});

export const SaveSession = Command.define("SaveSession", {
  args: { token: S.String, username: S.String },
  messages: [CompletedSaveSession, FailedSaveSession],
  execute: (args) =>
    saveSession(args).pipe(
      Effect.provide(BrowserKeyValueStore.layerLocalStorage)
    ),
});

export const ClearSession = Command.define("ClearSession", {
  messages: [CompletedClearSession, FailedClearSession],
  execute: clearSession.pipe(
    Effect.provide(BrowserKeyValueStore.layerLocalStorage)
  ),
});
