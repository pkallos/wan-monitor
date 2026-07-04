# HTTP API (`@effect/platform`)

WAN Monitor's HTTP layer is built with the `HttpApi*` modules. The API is **defined once** in
`packages/shared` as a typed contract, then reused to (a) implement the server and (b) derive a
fully-typed client for the web app. This keeps server, client, and docs aligned.

```
HttpApi ("WanMonitorAPI")
├── HttpApiGroup ("metrics")
│   └── HttpApiEndpoint ("getMetrics")
├── HttpApiGroup ("auth")
└── ... (health, ping, speedtest, connectivity-status)
```

## Layer 1 — Define the contract (shared)

### Endpoints + groups

Reference: `packages/shared/src/api/routes/metrics.ts`.

```typescript
import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

export const MetricsApiGroup = HttpApiGroup.make("metrics")
  .prefix("/metrics")
  .add(
    HttpApiEndpoint.get("getMetrics", "/")
      .setUrlParams(GetMetricsQueryParams)     // decoded into the handler
      .addSuccess(GetMetricsResponse)          // encoded response schema
      .addError(DbUnavailableErrorSchema, { status: 503 })
      .addError(Schema.String)
  )
  .middleware(Authorization);                  // require auth for the group
```

Endpoint builders: `HttpApiEndpoint.get/post/put/del(name, path)`, then chain
`.setUrlParams`, `.setPayload`, `.setPath`, `.addSuccess`, `.addError`. All schemas come from
[`schema.md`](./schema.md).

### Assembling the API

Reference: `packages/shared/src/api/index.ts`.

```typescript
import { HttpApi } from "@effect/platform";

export const WanMonitorApi = HttpApi.make("WanMonitorAPI")
  .add(AuthApiGroup.prefix("/auth"))
  .add(MetricsApiGroup.prefix("/metrics"))
  .add(HealthApiGroup.prefix("/health"))
  // ... ping, speedtest, connectivity-status
  .prefix("/api");
```

## Layer 2 — Implement the handlers (server)

Each endpoint is implemented in a handler `Effect`, then wired into a group `Live` layer with
`HttpApiBuilder.group`. Reference: `apps/server/src/core/api/handlers/metrics.ts`.

```typescript
import { HttpApiBuilder } from "@effect/platform";

// Handler: receives already-decoded params, returns the success schema shape
const getMetricsHandler = ({ urlParams }: { urlParams: /* Schema.Type of GetMetricsQueryParams */ }) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const rawData = yield* db.queryMetrics({ /* ...from urlParams... */ });
    return { data: rawData.map(/* ... */), meta: { /* ... */ } };
  }).pipe(Effect.catchAll(mapQueryError("Failed to query metrics")));

// Group Live: bind endpoint names to handlers
export const MetricsGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "metrics",
  (handlers) => handlers.handle("getMetrics", getMetricsHandler)
);
```

- The handler **returns the decoded success shape**; the platform encodes it via the response schema.
- Errors declared with `.addError(...)` can be returned via the error channel and are serialized with
  their status code. Map internal errors to declared ones at the handler edge (see
  [error-handling](./error-handling.md)).

## Layer 3 — Compose + serve

The API layer merges all group implementations. Reference: `apps/server/src/core/api/service.ts`.

```typescript
import { HttpApiBuilder } from "@effect/platform";

export const ApiServiceLayer = HttpApiBuilder.api(WanMonitorApi).pipe(
  Layer.provide([
    AuthGroupLive,
    MetricsGroupLive,
    HealthGroupLive,
    /* ...other groups... */
  ]),
  Layer.provide(AuthServiceLive),
  Layer.provide(AuthorizationLive)
);
```

Serving binds the API to a Node HTTP server. Reference: `apps/server/src/core/api/server.ts` +
`apps/server/src/index.ts`.

```typescript
import { HttpApiBuilder, HttpMiddleware } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";

export const ApiServerLive = HttpApiBuilder.serve(HttpMiddleware.logger);

export const NodeHttpServerLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return NodeHttpServer.layer(createServer, { port: config.server.port });
  })
);
```

`index.ts` then provides `ApiServiceLayer` + `NodeHttpServerLayer` + the service deps into
`ApiServerLive` (see [`services-and-layers.md`](./services-and-layers.md) for the full graph).

## Middleware & auth

Auth is an `HttpApiMiddleware` defined in shared and implemented on the server.

Definition — Reference: `packages/shared/src/api/middlewares/authorization.ts`.

```typescript
import { HttpApiMiddleware, HttpApiSchema } from "@effect/platform";
import { Context, Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized", {}, HttpApiSchema.annotations({ status: 401 })
) {}

export class AuthenticatedUser extends Context.Tag("AuthenticatedUser")<
  AuthenticatedUser, AuthenticatedUserValue
>() {}

export class Authorization extends HttpApiMiddleware.Tag<Authorization>()(
  "Http/Authorization",
  { failure: Unauthorized, provides: AuthenticatedUser }
) {}
```

- `failure` — the typed error the middleware can produce (serialized with its status).
- `provides` — the service the middleware injects into downstream handlers (the authenticated user).
- Apply it per group with `.middleware(Authorization)` (see the metrics group above).

Implementation — Reference: `apps/server/src/infrastructure/auth/middleware.ts` (`AuthorizationLive`),
which reads `HttpServerRequest`, verifies the token via `AuthService`, and maps failures to
`Unauthorized`.

## Deriving a client (web)

Because the contract lives in shared, the web app derives a typed client from `WanMonitorApi` with
`HttpApiClient.make(WanMonitorApi, { baseUrl })` — no hand-written fetch calls, and response/error
types come straight from the schemas.

## Anti-patterns

- ❌ Defining request/response shapes on the server. Define them in `packages/shared` so the client
  shares them.
- ❌ Returning raw strings/status codes from handlers. Return the success schema shape; declare and
  return typed errors.
- ❌ Hand-rolling `fetch` in the web app. Derive the client from `WanMonitorApi`.
- ❌ Ad-hoc auth checks inside handlers. Use the `Authorization` middleware on the group.
