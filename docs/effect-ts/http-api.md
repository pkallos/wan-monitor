# HttpApi

Schema-first HTTP API definition and serving. In v4 this all lives in core, under two subpath
modules — `effect/unstable/http` (transport primitives: request, response, client, router,
middleware plumbing) and `effect/unstable/httpapi` (the schema-driven API layer: `HttpApi`,
`HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, `HttpApiMiddleware`, `HttpApiClient`). Neither
lives in `@effect/platform` anymore — that package folded entirely into `effect` for v4. The `unstable`
prefix means these modules can get breaking changes in minor releases, unlike the rest of the `effect`
barrel; expect some churn if you bump the beta version.

`packages/shared/src/api/` defines the whole API contract once; `apps/server` implements it;
`apps/web` consumes it through a generated client. Neither side redeclares a route or a schema by hand.

## Defining an endpoint

```ts
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

export const AuthApiGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/login", {
      payload: LoginRequest,
      success: LoginResponse,
      error: [MissingCredentials, InvalidCredentials, AuthNotConfigured],
    })
  )
  .add(
    HttpApiEndpoint.get("me", "/me", {
      success: MeResponse,
      error: HttpApiSchema.status(401)(Schema.String),
    }).middleware(Authorization)
  );
```

`HttpApiEndpoint.get`/`post`/etc. take `(id, path, options)` where `options` is a plain object:
`payload`, `query`, `success`, `error`. This is v4's endpoint shape — v3 built the same endpoint with a
builder-method chain (`.setPayload(...)`, `.addSuccess(...)`, `.addError(...)`, `.setUrlParams(...)`);
none of those methods exist anymore. `error` accepts either a single schema or an array of them (each
member of a tagged-error union), replacing v3's repeated `.addError(...)` calls. Query params are the
`query` option (v3's `setUrlParams` / `urlParams`) — this renames both the endpoint definition and the
handler's destructured parameter (see below). `HttpApiEndpoint.get("id")\`/path\`` — the v3
template-literal form for a path with no options — is also gone; always pass the path as a plain
string, the second positional argument.

See `packages/shared/src/api/routes/*.ts` for every group in this API.

## Assembling the API

```ts
import { HttpApi } from "effect/unstable/httpapi";

export const WanMonitorApi = HttpApi.make("WanMonitorAPI")
  .add(AuthApiGroup.prefix("/auth"))
  .add(MetricsApiGroup.prefix("/metrics"))
  // ...
  .prefix("/api");
```

`packages/shared/src/api/index.ts`. Unchanged shape from v3.

## Implementing handlers

```ts
import { HttpApiBuilder } from "effect/unstable/httpapi";

export const loginHandler = ({ payload }: { payload: LoginRequestType }) =>
  Effect.gen(function* () {
    // ...
    return { token, expiresAt, username: payload.username };
  });

export const AuthGroupLive = HttpApiBuilder.group(WanMonitorApi, "auth", (handlers) =>
  handlers
    .handle("login", loginHandler)
    .handle("logout", logoutHandler)
    .handle("me", meHandler)
);
```

`HttpApiBuilder.group` kept its v3 signature exactly — this is an import-only change. A handler
destructures whichever of `payload`/`query`/`params` the endpoint declared; a handler for an endpoint
with `query: GetMetricsQueryParams` receives `{ query }`, not `{ urlParams }`.

Assembling all groups into one servable layer uses `HttpApiBuilder.layer` (v3's `HttpApiBuilder.api`,
renamed, same shape):

```ts
// apps/server/src/core/api/service.ts
export const ApiServiceLayer = HttpApiBuilder.layer(WanMonitorApi).pipe(
  Layer.provide([AuthGroupLive, MetricsGroupLive, /* ... */]),
  Layer.provide(AuthServiceLive),
  Layer.provide(AuthorizationLive)
);
```

## Serving

```ts
// apps/server/src/core/api/server.ts
import { HttpRouter } from "effect/unstable/http";

export const ApiServerLive = HttpRouter.serve(ApiServiceLayer);
```

`HttpApiBuilder.serve(middleware)` is gone. v4's `HttpRouter.serve(appLayer, options?)` takes the
concrete, fully-assembled API layer as its argument (not something provided into it later downstream)
and logs every request by default (`options.disableLogger` defaults to `false`) — this replaces v3's
explicit `HttpApiBuilder.serve(HttpMiddleware.logger)`. Because `HttpRouter.serve` needs the concrete
layer up front, `ApiServiceLayer` is imported directly into `server.ts` rather than composed later in
`index.ts` the way v3 could defer it.

## Custom middleware

`HttpApiMiddleware.Tag` is gone; middleware is declared with `HttpApiMiddleware.Service`, and — this is
the one genuine behavioral change, not just a rename — **the middleware implementation itself wraps
the downstream response effect**, rather than resolving directly to the value it provides:

```ts
// packages/shared/src/api/middlewares/authorization.ts
export class AuthenticatedUser extends Context.Service<AuthenticatedUser, AuthenticatedUserValue>()(
  "AuthenticatedUser"
) {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: AuthenticatedUser }
>()("Http/Authorization", { error: Unauthorized }) {}
```

```ts
// apps/server/src/infrastructure/auth/middleware.ts
export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const authService = yield* AuthService;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const payload = yield* authService
          .verifyRequest(request.headers.authorization)
          .pipe(Effect.mapError((error) => new Unauthorized({ message: error.message ?? "Unauthorized" })));

        return yield* httpEffect.pipe(
          Effect.provideService(AuthenticatedUser, payload ?? anonymousUser)
        );
      });
  })
);
```

v3's version resolved to `AuthenticatedUserValue` directly and the framework injected it; v4's
`HttpApiMiddleware<Provides, E, Requires>` type is a function
`(httpEffect: Effect<HttpServerResponse, ...>, options) => Effect<HttpServerResponse, ...>` — the
middleware receives the downstream handler's response effect and must call `Effect.provideService`
on it itself before returning it. There's no official example of this exact shape (manual header
decode + a `provides` config, no `security` scheme) in the upstream JSDoc; this was derived from
`Effect-TS/effect`'s own httpapi test fixtures. A middleware that fails before reaching `httpEffect`
(the way this one does when `verifyRequest` fails) never invokes the downstream handler at all — the
short-circuit works the same as any other `Effect.gen`.

## Typed errors

See `error-handling.md`'s `Schema.TaggedErrorClass` + `httpApiStatus` section — that's what
`MissingCredentials`, `InvalidCredentials`, `Unauthorized`, and the rest are built from.

## Testing a full app instance

```ts
import { HttpRouter, HttpServer } from "effect/unstable/http";

const MockServicesLayer = Layer.mergeAll(ConfigLayer, JwtLayer, /* mocks */);

const ProvidedApiLayer = ApiServiceLayer.pipe(
  Layer.provide(Layer.mergeAll(MockServicesLayer, AuthLayer)),
  Layer.provide(HttpServer.layerServices), // FileSystem, Path, Etag.Generator
  Layer.provide(HttpRouter.layer)          // an HttpRouter instance
);

// Every group handler's own leftover requirement is tracked internally as
// `HttpRouter.Request.From<"Requires", R>` (see HttpApiBuilder's
// `HandlerRequirements` type) — a per-request channel, not an ordinary Layer
// dependency, so Layer.provide above can never discharge it. Build a Context
// from the same mock/config/jwt layers and pass it as toWebHandler's second
// argument on every call instead.
const requestContext = MockServicesLayer.pipe(
  Layer.build,
  Effect.scoped,
  Effect.runSync
);

const { handler: rawHandler, dispose } = HttpRouter.toWebHandler(ProvidedApiLayer);
const handler = (request: Request) => rawHandler(request, requestContext);
```

`HttpApiBuilder.toWebHandler` is gone; `HttpRouter.toWebHandler(appLayer, options?)` replaces it with
the same `{ handler, dispose }` return shape. It needs the platform-default-services layer
(`HttpServer.layerServices`, v3's `HttpServer.layerContext`) **provided into** the api layer, not
merged alongside it as a sibling — `Layer.provide`, not `Layer.mergeAll` — plus an `HttpRouter`
instance (`HttpRouter.layer`), which `toWebHandler` needs but `HttpServer.layerServices` doesn't supply.
See `apps/server/src/core/api/handlers/auth.http.test.ts` for the full working composition, including
mocked `QuestDB`/`PingExecutor`/`SpeedTestService` dependencies alongside a real `JwtService` and
`AuthService`.

`HttpRouter.serve` (what `apps/server/src/core/api/server.ts` uses in production) unwraps every
`Request.From<"Requires", _>`/`Request.From<"GlobalRequires", _>` marker back to its plain service type
in its own return type, so `index.ts`'s ordinary `Layer.provide(Layer.mergeAll(...))` closes it there.
`toWebHandler` doesn't do that unwrapping — it exposes the raw requirement as the handler's second
argument on purpose, so a caller can supply different per-request context on each call. A test with a
fixed set of mocks just builds that context once, as above, instead of threading it through every call
site.

## Anti-patterns

- ❌ `HttpApiEndpoint.get("id").setPayload(...).addSuccess(...)` builder-chain calls — that's the v3
  shape. Use the options object: `HttpApiEndpoint.get("id", "/path", { success, error })`.
- ❌ Destructuring `{ urlParams }` in a handler for an endpoint declared with `query`.
- ❌ A middleware that resolves directly to the value it provides instead of wrapping `httpEffect` and
  calling `Effect.provideService` on it.
- ❌ `Layer.mergeAll(apiLayer, HttpServer.layerServices)` instead of `apiLayer.pipe(Layer.provide(HttpServer.layerServices))`
  when building a `toWebHandler` test — merge treats them as independent siblings; provide wires one's
  output into the other's remaining requirements.
