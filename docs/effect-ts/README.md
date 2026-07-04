# Effect-TS Patterns & Best Practices

Reference library for how **WAN Monitor** uses [Effect-TS](https://effect.website). Every pattern
here is grounded in code that already exists in this repo — the citations point at real files so you
can copy the established shape instead of inventing a new one.

Read the topic that matches your task before writing new Effect code. When a pattern here disagrees
with what you find in the codebase, the **codebase wins** — update these docs in the same PR.

## Libraries in use

Versions are pinned in the workspace `package.json` files. Verify with `pnpm view <pkg> version`
before bumping (see the "Verify dependency versions" rule in `AGENTS.md`).

| Package | Version | Where | What we use it for |
| --- | --- | --- | --- |
| `effect` | `^3.21.4` | server, web, shared | Core: `Effect`, `Layer`, `Context`, `Data`, `Config`, `Schema`, `Option`, `Either`, `Fiber`, `Logger` |
| `@effect/platform` | `^0.96.2` | server, web, shared | `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, `HttpMiddleware`, `HttpServerRequest` |
| `@effect/platform-node` | `^0.107.0` | server | `NodeHttpServer` (binds the HTTP API to a Node `http` server) |
| `@effect/schema` | `^0.75.5` | server, web, shared | Declared, **but our code imports `Schema` from `effect`** (see below) |
| `@effect/vitest` | `^0.29.0` | server (dev) | `it.effect` / `it.scoped` Vitest integration |
| `@effect/language-service` | `^0.86.3` | root (dev) | TS language-service plugin, patched in via `effect-language-service patch` |

> **`Schema` import note:** although `@effect/schema` is a dependency, the current code imports
> `Schema` **from the `effect` barrel** (`import { Schema } from "effect"`). Effect 3.10+ re-exports
> `Schema` from core. Stay consistent with the codebase and import from `effect` unless you have a
> specific reason not to. See `@shared/api/routes/metrics.ts`.

## Topic index

| Doc | Read it when you are... |
| --- | --- |
| [`services-and-layers.md`](./services-and-layers.md) | Defining a service, wiring dependencies, building the app layer graph |
| [`error-handling.md`](./error-handling.md) | Modelling failures, wrapping Promises, recovering from errors |
| [`effect-gen-and-composition.md`](./effect-gen-and-composition.md) | Writing effectful logic with `Effect.gen`, `pipe`, and combinators |
| [`schema.md`](./schema.md) | Defining request/response/DTO shapes and deriving types |
| [`configuration.md`](./configuration.md) | Reading env config with `Config` and injecting it in tests |
| [`http-api.md`](./http-api.md) | Adding/serving HTTP endpoints, middleware, typed errors |
| [`testing.md`](./testing.md) | Writing unit tests for Effect code with `@effect/vitest` and mock layers |

## Non-negotiable house rules (summary)

These are enforced by Biome/CI and by `AGENTS.md`. The topic docs expand on each.

- **Never compare `_tag` directly.** Use `catchTag`/`catchTags` or the module type guards
  (`Option.isSome`, `Either.isLeft`, `Exit.isFailure`, ...). See [`error-handling.md`](./error-handling.md).
- **Never hand-roll error classes.** Use `Data.TaggedError` (in-process) or `Schema.TaggedError`
  (crosses a serialization boundary).
- **No `as unknown as` double casts and no `biome-ignore`.** Fix the type, add a guard, or decode
  through a schema.
- **Services are interfaces behind a `Context.Tag`.** Implementations live in a `*Live` layer; the
  interface never leaks its own dependencies.
- **Provide dependencies through layers**, and build the graph explicitly (see `apps/server/src/index.ts`).

## Canonical example files

When in doubt, open one of these — they are the reference implementations for their pattern:

- Service + layer: `apps/server/src/infrastructure/auth/jwt.ts`
- Scoped/resourceful service: `apps/server/src/infrastructure/database/questdb/service.ts`
- Layer graph wiring: `apps/server/src/index.ts`
- Tagged errors (in-process): `apps/server/src/infrastructure/auth/jwt.ts`
- Tagged errors (API boundary): `packages/shared/src/api/middlewares/authorization.ts`
- HTTP API definition: `packages/shared/src/api/index.ts` + `packages/shared/src/api/routes/*.ts`
- HTTP handler group: `apps/server/src/core/api/handlers/metrics.ts`
- Config service: `apps/server/src/infrastructure/config/config.ts`
- Effect test with mock layers: `apps/server/src/core/monitoring/network-monitor.test.ts`
- Effect test with `it.effect`: `apps/server/src/infrastructure/auth/jwt.test.ts`
