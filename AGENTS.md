# Agent Development Guidelines

This document provides guidelines for AI agents working on the WAN Monitor project.

## Project Overview

WAN Monitor is a self-hosted network monitoring dashboard that tracks:
- Network connectivity status
- Latency (ping times)
- Packet loss and jitter
- Internet speed tests
- Historical metrics with time-series visualization

## Core Responsibilities

Understand requirements before starting, follow existing conventions, test everything, and update docs when behavior changes. The sections below define how each of these is enforced.

## Always-On Rules

These rules apply to every response and every change, regardless of task:

- **No agent attribution in commits**: Never add `Co-Authored-By` or other agent/AI attribution to commit messages.
- **No agent labels in GitHub metadata**: Never use `[cascade]`, `[codex]`, `[copilot]`, or similar agent labels in user-visible GitHub metadata (PR titles, descriptions, commit messages, comments) unless explicitly requested.
- **PRs are ready for review by default**: Open PRs as ready for review, not drafts, unless the user explicitly asks for a draft.
- **Verify dependency versions before adding them**: When adding a package dependency or framework integration, verify the current latest compatible version first with `pnpm view <pkg> version` (or current docs). Do not rely on remembered version numbers.

## Final Status Block

Every final response must end with a one-line status block using one of these indicators:

- `🟢` — the requested work unit is finished on the current branch (routine commit/PR/CI may remain).
- `🟡` — non-routine work or a manual step is still pending.
- `🔴` — blocked on user input.

Write a short, task-specific status sentence after the indicator (never the literal placeholder text).

## UI/Styling Standards

- **Tailwind CSS**: Lean on Tailwind CSS styles for all styling (check documentation online if necessary) and keep it coherent
- **Chakra UI**: Lean on Chakra UI components (check documentation online if necessary); only use `sx={{}}` on components as a last resort
- **TypeScript everywhere**: All source files are TypeScript. Do not add `.js` or `.mjs` source files.
- **No native browser dialogs**: Never use `alert()`, `confirm()`, or `prompt()`. Use Chakra UI dialog/modal components instead.
- **Optimistic UI by default**: Update local state/cache and navigate immediately, then roll back on error. Avoid click-blocking spinners except for destructive or irreversible operations.

## Development Workflow

### 1. Task Planning

Before working on any feature:
- A Linear task MUST be created in the **PHI project**
- The task should include a **full detailed description** of what needs to be done
- Tasks should be scoped to be completable in **one PR with a simple changeset**
- Break down large features into multiple smaller, incremental tasks
- Keep Linear status synchronized (see **Linear Task Status Management** section)

### 2. Branch Management

For each task:
- **Always create feature branches from the tip of `origin/main`** (not a potentially stale local branch):
  ```bash
  git fetch origin
  git checkout -b feat/feature-name origin/main
  ```

- Use conventional branch naming:
  - `feat/feature-name` - for new features
  - `fix/bug-name` - for bug fixes
  - `chore/task-name` - for maintenance tasks
  - `docs/update-name` - for documentation updates
  - `test/test-name` - for test additions/updates

### 3. Commit Conventions

**Use Conventional Commits format for all commits:**

```
<type>: <short description>

<optional longer description>

<optional footer with breaking changes>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code refactoring without changing functionality
- `test`: Adding or updating tests
- `chore`: Maintenance tasks, dependency updates, etc.
- `perf`: Performance improvements
- `ci`: CI/CD configuration changes

### 4. Single Commit Per Feature

All changes for a task must land as **ONE commit** before pushing. Squash any intermediate commits (see **Non-Interactive Commands** for how) and write a descriptive message. This single-commit rule applies to every push, including updates to an existing PR.

### 5. Pull Request Process

When the feature is complete:

1. **Verify locally (MANDATORY - DO NOT SKIP):**

   Execute these commands IN ORDER and ensure ALL pass:

   ```bash
   # 1. Lint Check - must pass with zero errors (warnings acceptable)
   pnpm lint

   # 2. Format Check - must pass, all files properly formatted
   pnpm format

   # 3. Unit Tests - must pass, all tests passing, no skipped tests
   pnpm test

   # 4. Type Check - must pass with zero errors
   pnpm typecheck

   # 5. Build - must succeed
   pnpm build

   # 6. Docker Build - must build successfully
   pnpm docker:build

   # 7. Test Docker Image
   docker run -d --name wan-monitor-test -p 8080:80 wan-monitor:local && sleep 15 && curl http://localhost:8080/api/health/live && docker stop wan-monitor-test && docker rm wan-monitor-test
   ```

   **CRITICAL:** If ANY step fails, fix it before pushing. Do NOT push with failing checks.

2. **Push the branch:**
   ```bash
   git push -u origin feat/your-feature-name
   ```

3. **Open a Pull Request on GitHub:**
   - Title should match the commit message
   - Include detailed description of changes
   - Reference the Linear task ID
   - Add `@pkallos` as the reviewer

4. **Review and Iterate:**
   - @pkallos reviews and provides feedback; make changes in the same branch.
   - Before every re-push (whether for review feedback or a CI failure): re-run the full verify list from step 1, review the changeset, then **squash into one commit** and force push: `git push -f origin branch-name`.
   - For CI failures, read the logs, reproduce locally, fix, then re-run **all** checks — not just the one that failed. **NEVER push multiple "fix CI" commits.**

5. **After Merge:**
   - Delete the feature branch
   - **Update the Linear task status to "Done"** (when user confirms PR is merged)
   - Move on to the next task

### 6. Linear Task Status Management

**Keep Linear task statuses synchronized with actual work progress:**

| When | Action |
|------|--------|
| Starting work on a task | Set status → **In Progress** |
| PR is merged (user confirms) | Set status → **Done** |
| Blocked on something | Update status + add comment explaining blocker |
| Pausing to work on something else | Consider updating status |

**Important:** When the user tells you a PR has been merged, immediately update the corresponding Linear task status to "Done".

### 7. Linear Issue Tagging Guidelines

**All Linear issues should be tagged consistently to enable filtering, prioritization, and organization.**

#### Tagging Convention

Use a **two-tier tagging system**:

1. **Type tag** (required, exactly one): `Feature`, `Bug`, or `Improvement`
2. **Area tags** (1-3 recommended): Component/domain-specific tags
3. **Priority/Effort tags** (optional): Special characteristics

#### Available Labels

**Type Labels (choose exactly one):**

- `Feature` - New functionality or capability
- `Bug` - Defect, error, or incorrect behavior
- `Improvement` - Enhancement to existing functionality

**Area Labels (choose 1-3 that apply):**

- `backend` - Server-side, API, database, Effect services
- `frontend` - UI, React components, charts, styling
- `devops` - Docker, CI/CD, deployment, infrastructure
- `testing` - Test infrastructure, unit tests, E2E tests
- `monitoring` - Ping, speedtest, metrics collection
- `reliability` - Error handling, retries, resilience, health checks
- `documentation` - README, guides, API docs, code comments
- `performance` - Optimization, caching, efficiency improvements

**Priority/Effort Labels (optional):**

- `quick-win` - Small, high-impact tasks (< 2 hours)
- `tech-debt` - Refactoring, cleanup, code quality
- `breaking-change` - Requires migration or version bump

#### Tagging Guidelines

**When creating a new Linear issue:**

1. Always add exactly one Type label (Feature, Bug, or Improvement)
2. Add 1-3 Area labels that best describe the work scope
3. Add Priority/Effort labels if applicable
4. Be specific but not excessive - avoid over-tagging

**Examples:** `["Feature", "backend"]` (API endpoint), `["Bug", "frontend"]` (UI fix), `["Improvement", "devops", "documentation", "quick-win"]` (docs), `["Improvement", "devops", "breaking-change"]` (CI migration).

**Agent responsibility:** Verify tags before starting; add or correct labels when an issue is untagged, under-tagged, or its scope changes.

## Pre-Push Review (MANDATORY)

Before committing, run `git status` and `git diff` to review ALL changes. Review the entire changeset against the original goal, and give yourself a constructive code review as if you were a Principal Engineer. Implement feedback that aligns with the original goal and project standards.

### Files to REMOVE (never commit these):
- ❌ Markdown files created for context (e.g., `notes.md`, `progress.md`, `temp.md`)
- ❌ Debug files (e.g., `debug.log`, `test-output.txt`)
- ❌ IDE-specific files (e.g., `.vscode/`, `.idea/`)
- ❌ Temporary test files (e.g., `temp.test.ts`, `scratch.tsx`)

### Verify in All Files in the Changeset:
- ✅ Contains only production code changes relevant to the task
- ✅ Contains only relevant test files for the changes made
- ✅ No commented-out code blocks
- ✅ No `console.log()` or debug statements
- ✅ No `TODO` or `FIXME` comments without corresponding issues

### Quality Checklist (answer YES to ALL before pushing):

- **Functionality**: Accomplishes the original goal, works in light/dark mode and across screen sizes, and handles edge cases.
- **Code quality**: Readable, well-named, follows existing patterns, and free of avoidable duplication or needless complexity.
- **Performance**: No unnecessary re-renders, no leaked listeners/timers, expensive work memoized.
- **Security**: User input validated, no XSS vectors (secrets are covered in **Data & Migration Safety**).

**If any answer is NO, fix it before pushing.**

## Data & Migration Safety

WAN Monitor persists historical time-series metrics. Losing or corrupting that data is unacceptable.

- **Schema changes must be additive**: Never drop, rename, truncate, or destructively alter existing tables or columns in migrations or startup code. Add new columns/tables instead, and backfill where needed.
- **No destructive operations against production data**: Never run destructive migrations or ad hoc schema pushes against a live/production database.
- **Never hardcode secrets**: Do not commit API keys, tokens, webhook URLs, or credential-looking literals in source, docs, tests, fixtures, or generated content. Use environment variables and obviously fake placeholders in examples.

## Code Quality Standards

### Testing Standards

**Requirements:**
- **New features** must include unit tests for all new functions/components
- **Bug fixes** must include regression tests
- Tests must cover edge cases, not just happy paths
- Aim for high test coverage on critical paths
- Use Vitest for unit tests

**Quality Standards (MANDATORY - NO EXCEPTIONS):**

- **NEVER** skip tests (`test.skip`, `it.skip`, `describe.skip`)
- **NEVER** commit `.only` tests (`test.only`, `it.only`)
- **NEVER** create tests that don't assert anything meaningful
- **NEVER** create happy-path-only tests; tests should provide meaningful value
- **NEVER** compromise functionality to make tests pass (unless fixing a real bug)
- **NEVER** delete tests to make tests pass (unless corresponding code was removed)
- **NEVER** rewrite real code just to make tests pass (unless tests identified a real bug)
- Tests should fail if the feature breaks
- Tests should be maintainable and readable
- Always keep tests in sync with code
- Always keep code in sync with tests
- Keep linting rules with minimal ignores

### Linting Standards (MANDATORY - NO EXCEPTIONS)

- **NEVER** add `biome-ignore` comments to the codebase. Fix the underlying lint violation instead of suppressing it.
- If a rule genuinely needs to be relaxed, change the Biome configuration explicitly rather than scattering inline suppressions.
- **NEVER** use `as unknown as` double casts. They defeat type safety — there is always a better way (fix the type, add a proper type guard, decode through a schema, or use `@ts-expect-error` in tests when deliberately exercising invalid input).

### Documentation

- Update README.md when adding new features
- Add JSDoc comments for complex functions
- Update API documentation if backend changes are made

## Non-Interactive Commands (CRITICAL)

**AI agents cannot interact with terminal prompts or editors.** Commands that open vim, nano, or wait for user input will hang indefinitely.

All commands should be non-interactive. This is especially important for git operations like rebasing and squashing branches. Avoid interactive rebasing (`git rebase -i`), editors (`vim`, `nano`), and pagers (`less`, `more`). Always use flags like `--no-edit`, `-m`, or non-interactive alternatives.

### Commit Messages

**NEVER pass multi-line commit messages as quoted `-m` strings.** Inline heredocs and multi-line quoted arguments are brittle in the agent shell (quoting/escaping breaks, and they can hang or corrupt the message). Instead, write the message to a temp file and use `-F`:

```bash
# Write the message with the write_to_file tool (NOT via echo/heredoc):
#   /tmp/commit-msg.txt
git commit -F /tmp/commit-msg.txt
git commit --amend -F /tmp/commit-msg.txt   # when amending
```

- A single-line message may use `-m "..."`.
- Any message with a body (multiple lines / blank lines) MUST use `-F <file>`.
- The message file is a scratch artifact — write it outside the repo (e.g. `/tmp`) so it is never staged or committed.

## Effect-TS Best Practices

**📚 Full reference library: [`docs/effect-ts/`](./docs/effect-ts/).** Before writing or reviewing
Effect code, read the topic that matches your task — every pattern there is grounded in real files in
this repo:

- [`docs/effect-ts/README.md`](./docs/effect-ts/README.md) — index, library versions, house rules
- [`services-and-layers.md`](./docs/effect-ts/services-and-layers.md) — `Context.Tag`, `Layer.*`, dependency graph
- [`error-handling.md`](./docs/effect-ts/error-handling.md) — tagged errors, `catchTag`, wrapping Promises
- [`effect-gen-and-composition.md`](./docs/effect-ts/effect-gen-and-composition.md) — `Effect.gen`, `pipe`, fibers, runners
- [`schema.md`](./docs/effect-ts/schema.md) — `Schema.Struct`, deriving types, decode/encode
- [`configuration.md`](./docs/effect-ts/configuration.md) — `Config`, `ConfigProvider`, test injection
- [`http-api.md`](./docs/effect-ts/http-api.md) — `HttpApi*`, handlers, middleware, typed errors
- [`testing.md`](./docs/effect-ts/testing.md) — `@effect/vitest`, `it.effect`, mock layers

The rules below are the quick summary; the docs above are authoritative. Keep them in sync — if you
change an Effect pattern in the codebase, update the matching doc in the same PR.

This project uses Effect-TS for functional programming. Follow these idiomatic patterns:

### Pattern Matching and Type Guards

**❌ DON'T** check `_tag` directly:
```typescript
// Bad - direct _tag checks
if (result._tag === 'Left') { ... }
if (exit._tag === 'Failure') { ... }
if (option._tag === 'Some') { ... }
```

**✅ DO** use Effect's type guards and pattern matching:

```typescript
// Either - use Either.match or type guards
import { Either } from 'effect';

// Pattern matching
Either.match(result, {
  onLeft: (error) => { /* handle error */ },
  onRight: (value) => { /* handle success */ },
});

// Type guards
if (Either.isLeft(result)) {
  const error = result.left;
}
if (Either.isRight(result)) {
  const value = result.right;
}

// Exit - use Exit.match or type guards
import { Exit } from 'effect';

if (Exit.isFailure(exit)) {
  const cause = exit.cause;
}
if (Exit.isSuccess(exit)) {
  const value = exit.value;
}

// Option - use Option.match or type guards
import { Option } from 'effect';

if (Option.isSome(option)) {
  const value = option.value;
}
if (Option.isNone(option)) {
  // handle none
}
```

### Error Definitions

Define tagged errors with Effect's built-in constructors. **Never hand-roll a plain class with a manual `readonly _tag` field** — it doesn't extend `Error` (no stack traces, `instanceof Error` is false), has no value equality, and duplicates boilerplate.

**Domain errors (in-process only)** — use `Data.TaggedError`:

```typescript
import { Data } from 'effect';

export class PingTimeoutError extends Data.TaggedError('PingTimeoutError')<{
  readonly host: string;
  readonly timeoutMs: number;
}> {}

// Construction uses a props object:
new PingTimeoutError({ host, timeoutMs });
```

Benefits: `_tag` is set automatically, the class extends `Error` (real stack traces + `instanceof Error`), you get value equality/hashing via `Data`, and a typed props constructor.

**Serializable / API-boundary errors** — use `Schema.TaggedError` (so they encode/decode across the HTTP boundary), as in `packages/shared/src/api/middlewares/authorization.ts`:

```typescript
import { HttpApiSchema } from '@effect/platform';
import { Schema } from 'effect';

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  {},
  HttpApiSchema.annotations({ status: 401 })
) {}
```

Rule of thumb: if the error only ever flows through the Effect error channel in-process, use `Data.TaggedError`. If it crosses a serialization boundary (HTTP response, worker message), use `Schema.TaggedError`. Discriminate either kind with `catchTag` / Effect type guards — never with direct `_tag` comparisons.
