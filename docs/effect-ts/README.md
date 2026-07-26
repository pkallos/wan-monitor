# Effect-TS Patterns & Best Practices (v4)

Reference library for how **WAN Monitor** uses [Effect](https://effect.website) v4. Every pattern here
is grounded in code that already exists in this repo — the citations point at real files so you can
copy the established shape instead of inventing a new one.

Read the topic that matches your task before writing new Effect code. When a pattern here disagrees
with what you find in the codebase, the **codebase wins** — update these docs in the same PR.

## Version and source

Effect v4 is a beta major release. **effect.website's public docs describe v3 only** — the site's own
source (`Effect-TS/website`, `src/content/docs/`) has a `v3/` directory and no `v4/` directory, because
the docs site hasn't been rebuilt for the beta yet. There is no v4 tutorial site, no `llms.txt`, no
`llms-full.txt` to mirror. The only authoritative v4 reference is the JSDoc embedded directly in
[`Effect-TS/effect`](https://github.com/Effect-TS/effect)'s source (`packages/effect/src/**/*.ts`) —
every export carries a `**When to use**` / `**Details**` / `**Example**` doc block, and that's what
this library is built from. When something here looks wrong, re-read the source file directly; don't
trust a cached copy or a blog post, since the beta API can move between releases.

## Libraries in use

Versions are pinned exactly in the workspace `package.json` files (not caret ranges) because v4 is
beta and pins peer versions across the ecosystem in lockstep. Verify with `pnpm view <pkg> version`
before bumping (see the "Verify dependency versions" rule in `AGENTS.md`) — check the [v4 beta
release notes](https://effect.website/blog/releases/effect/40-beta) for what changed first.

| Package | Version | Where | What we use it for |
| --- | --- | --- | --- |
| `effect` | `4.0.0-beta.101` | server, web, shared | Core: `Effect`, `Layer`, `Context`, `Data`, `Config`, `Schema`, `Option`, `Result`, `Cause`, `Fiber`, `Logger`. Also `effect/unstable/http` and `effect/unstable/httpapi` (see below) |
| `@effect/platform-node` | `4.0.0-beta.101` | server | `NodeHttpServer` — binds the HTTP API to a Node `http` server. The one platform package still separate from core in v4 |
| `@effect/vitest` | `4.0.0-beta.101` | root (dev), server (dev) | `it.effect` / `it.live` Vitest integration |

`@effect/platform` and `@effect/schema` do not appear above on purpose. In v4, `@effect/platform`'s
HTTP and HttpApi modules folded into core under `effect/unstable/http` and `effect/unstable/httpapi`;
`Schema` has been part of the `effect` barrel since 3.10 and there was never a reason to install
`@effect/schema` separately. `@effect/language-service` (a v3-only TS plugin) is also gone — it has no
v4 release, and its diagnostics escalated to hard type errors against v4 types rather than merely
being stale, so it was removed rather than pinned back.

> **`Schema` comes from the `effect` barrel:** `import { Schema } from "effect"`. There is no separate
> schema package. See `packages/shared/src/api/routes/metrics.ts`.

## Topic index

| Doc | Read it when you are... |
| --- | --- |
| [`services-and-layers.md`](./services-and-layers.md) | Defining a service, wiring dependencies, building the app layer graph |
| [`error-handling.md`](./error-handling.md) | Modelling failures, wrapping Promises, recovering from errors, inspecting a `Cause` |
| [`effect-gen-and-composition.md`](./effect-gen-and-composition.md) | Writing effectful logic with `Effect.gen`, `pipe`, forking fibers, and running effects |
| [`schema.md`](./schema.md) | Defining request/response/DTO shapes and deriving types |
| [`configuration.md`](./configuration.md) | Reading env config with `Config` and injecting it in tests |
| [`http-api.md`](./http-api.md) | Adding/serving HTTP endpoints, middleware, typed errors |
| [`testing.md`](./testing.md) | Writing unit tests for Effect code with `@effect/vitest` and mock layers |

## Non-negotiable house rules (summary)

- **Services are `Context.Service` classes**, never a hand-rolled interface plus a manually-managed
  singleton. See `services-and-layers.md`.
- **Side effects only inside `Effect`**, composed with `Effect.gen` or `pipe`. No bare `async`/`await`
  outside an `Effect.tryPromise`/`Effect.promise` boundary.
- **Errors are typed and tagged** — `Data.TaggedError` for in-process errors, `Schema.TaggedErrorClass`
  for anything that crosses the HTTP boundary. Never a hand-rolled class with a manual `_tag` field.
  Never a bare `Error`/`string` thrown or rejected across an Effect boundary.
- **Discriminate errors with Effect's own tools** (`Cause.isFailReason`, `catchTag`, `Result.isFailure`,
  `Option.isSome`), never with a direct `._tag === "..."` string comparison.
- **`Schema` defines the wire contract once**, in `packages/shared`, and both server and client import
  it — never redeclare the same shape as a hand-written `interface`.
- **Tests use `@effect/vitest`'s `it.effect`/`it.live`**, not raw `async` tests reaching into internals.
  See `testing.md`.

The rules above are the quick summary; the topic docs are authoritative. Keep them in sync — if you
change an Effect pattern in the codebase, update the matching doc in the same PR.
