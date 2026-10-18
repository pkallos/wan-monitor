# Agent Development Guidelines

This file sets the rules for coding agents working in this repository. For what the product does and how to run it, see [README.md](./README.md).

## Always-On Rules

These rules apply to every response and every change.

- **No agent attribution in commits**: Never add `Co-Authored-By` or other agent or AI attribution to commit messages.
- **No agent labels in GitHub metadata**: Never use `[cascade]`, `[codex]`, `[copilot]` or similar agent labels in user-visible GitHub metadata (PR titles, descriptions, commit messages, comments), unless the user explicitly asks for one.
- **PRs are ready for review by default**: Open PRs as ready for review, not as drafts, unless the user explicitly asks for a draft.
- **Verify dependency versions before adding them**: Before adding a package dependency or framework integration, check the current latest compatible version with `pnpm view <pkg> version` or the current docs. Do not rely on a remembered version.

## Final Status Block

End every final response with one status line: an indicator, then a short sentence about this task (never placeholder text).

- `🟢` The requested work unit is finished on the current branch. A routine commit, PR or CI run may remain.
- `🟡` Non-routine work or a manual step is still pending.
- `🔴` The task is blocked on user input.

## UI/Styling Standards

- **Tailwind CSS**: Style with Tailwind utility classes, consistent with the existing views.
- **Foldkit UI**: Use a `@foldkit/ui` component ([catalog](https://foldkit.dev/ui/overview)) before hand-rolling a widget.
- **TypeScript**: Write new source files in TypeScript. Do not add `.js` or `.mjs` source files.
- **No native browser dialogs**: Never use `alert()`, `confirm()` or `prompt()`. Use `@foldkit/ui`'s `Dialog` component.
- **Optimistic UI by default**: Update local state or cache and navigate immediately, then roll back on error. Reserve click-blocking spinners for destructive or irreversible operations.

## Development Workflow

Scope each task to one PR, and break large work into PR-sized pieces. If the user names an issue (GitHub or Linear), reference it in the PR.

### Branches

Branch from the tip of `origin/main`, not from a possibly stale local branch. Name the branch `<type>/<slug>`, where the type is `feat`, `fix`, `chore`, `docs` or `test`:

```bash
git fetch origin
git checkout -b feat/feature-name origin/main
```

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>: <short description>`, with an optional body and an optional footer for breaking changes. The types are `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf` and `ci`. Changesets, not commit types, produce release notes; see [Releasing](./README.md#releasing).

A task lands as one commit. Squash intermediate commits before every push, including pushes to an open PR, and write a descriptive message.

Run `pnpm format` before every commit, so that `pnpm format:check` passes. The pre-commit hook runs lint-staged, which uses Biome to format only the staged `.ts`, `.tsx`, `.json` and `.jsonc` files. The hook does not replace `pnpm format`.

### Pull Requests

1. Verify locally. Run these in order and fix any failure before pushing. CI (`.github/workflows/ci.yml`) runs these gates and more. When a command here differs from the one CI runs, follow CI.

   ```bash
   pnpm lint
   pnpm format:check
   pnpm test
   pnpm typecheck
   pnpm typecheck:e2e
   pnpm build
   pnpm docker:build
   pnpm docker:smoke
   ```

   `pnpm lint` must report no errors and no warnings. All tests must pass, and none may be marked `.skip` or `.only`. `pnpm test` skips the QuestDB integration suites by design, so when you change the database layer, queries or migrations, also run `pnpm test:integration`, which starts its own QuestDB test container. `pnpm docker:smoke` boots the image and waits for `/api/health/ready`, which fails until QuestDB is connected and migrations have finished.

2. Add a changeset (`pnpm changeset`) and commit the generated `.changeset/*.md` file, or label the PR `no-changeset` when it has no release-worthy effect.

3. Push the branch with `git push -u origin <branch>`.

4. Open the PR. Its title matches the commit message, and its description covers the changes in detail.

5. Make review changes on the same branch. Before every re-push, whether for review feedback or a CI failure, re-run every check in step 1 (not only the check that failed), review the diff and the changeset file, then squash into one commit and force-push with `git push -f origin <branch>`. For a CI failure, read the logs and reproduce it locally first. Never push separate "fix CI" commits.

6. After the merge, delete the feature branch.

## Pre-Push Review

Before committing, run `git status` and `git diff` and review the whole change against the original goal, as a principal engineer would. Apply the feedback that fits the goal and the project standards.

A commit holds only the production code and tests the task needs. Keep these out of it:

- Markdown files created for context (`notes.md`, `progress.md`), debug files and temporary test files.
- IDE files that are not already tracked, such as `.idea/`.
- Commented-out code.
- `console.log()` and other debug statements.
- A `TODO` or `FIXME` with no corresponding issue.

Before pushing, confirm that each item below holds, and fix any that does not.

- **Functionality**: The change accomplishes the original goal, works in light and dark mode and across screen sizes, and handles edge cases.
- **Code quality**: The code is readable, well named, consistent with existing patterns and free of avoidable duplication and needless complexity.
- **Performance**: There are no unnecessary re-renders, no leaked listeners or timers and no expensive work left unmemoized.
- **Security**: All user input is validated, and there are no XSS vectors.

## Data & Migration Safety

- **Every schema change is a new versioned migration**: Append it to `apps/server/src/infrastructure/database/questdb/migrations/registry.ts`. Never edit a shipped migration or the column list it freezes, such as `NETWORK_METRICS_V2_COLUMNS`. Changing `NETWORK_METRICS_COLUMNS` (in `packages/shared/src/db-schema.ts`) needs a new migration that brings existing tables to the new shape. Until there is one, the integration test "creates exactly the declared schema on an empty database" (`schema-migrator.integration.test.ts`) fails under `pnpm test:integration`.
- **Migrations are idempotent**: Each `up` must be safe to run again after a partial or repeated run.
- **Prefer additive schema changes**: Add new columns or tables and backfill them. Never drop a column or table that still holds data. The only exceptions are a rebuild's original table once the rebuild is verified, and the rebuild's own copy while it is unverified.
- **Rewrite a table only through the verified rebuild**: Use `rebuildTable`, which copies the table, proves the copy complete, swaps it in, proves it again, then drops the original. No production code outside `rebuildTable` and `recoverTableState` in `rebuild.ts` drops, renames or truncates a table.
- **Verify in-place value corrections with a digest**: A migration that `UPDATE`s stored values calls `readDigest` before and after. The migration fails with a sticky terminal `MigrationError` unless `digestMismatches` finds only the changes the correction predicts. The runner records the error, so the failure survives a retry.
- **No destructive operations against production data**: Never run ad hoc schema changes or destructive SQL against a live or production database. Only registered migrations run there.
- **Never hardcode secrets**: Do not commit API keys, tokens, webhook URLs or credential-looking literals in source, docs, tests, fixtures or generated content. Use environment variables and obviously fake placeholders in examples.

## Code Quality Standards

### Testing

- A new feature ships with Vitest unit tests for all its new functions and components, and a bug fix ships with a regression test.
- Tests cover edge cases, not only the happy path, and fail if the feature they cover breaks.
- Never skip a test (`test.skip`, `it.skip`, `describe.skip`) or commit an `.only` test (`test.only`, `it.only`).
- Never create a test that asserts nothing meaningful or covers only the happy path.
- Never compromise functionality to make a test pass, unless you are fixing a real bug.
- Never delete a test to make the suite pass, unless the code it covered was removed.
- Never rewrite real code just to make a test pass, unless the test identified a real bug.
- Keep tests and code in sync with each other.

### Linting

- Never add `biome-ignore` comments. Fix the underlying lint violation.
- If a rule genuinely needs to be relaxed, change the Biome configuration (`biome.json`) explicitly rather than scattering inline suppressions.
- Never use `as unknown as` double casts, which defeat type safety. Fix the type, add a type guard, decode through a schema or use `@ts-expect-error` in a test that passes invalid input on purpose.

### Documentation

- Update `README.md` in the same PR when you add a feature or change the configuration, the API or the user-visible behavior.
- Add JSDoc comments to complex functions.
- Docs describe current behavior. Change history goes in commits and changesets.

## Non-Interactive Commands

Run every command non-interactively. Agents cannot answer prompts, so a command that opens an editor, a pager or a prompt hangs forever. Avoid `git rebase -i`, `vim`, `nano`, `less` and `more`. When rebasing or squashing, pass non-interactive flags such as `--no-edit`.

### Commit Messages

Never pass a multi-line commit message as a quoted `-m` string or a heredoc; quoting breaks in the agent shell. Use your file-writing tool (not `echo` or a heredoc) to write the message to a file outside the repo, so it is never staged. Then commit with `-F`:

```bash
git commit -F /tmp/commit-msg.txt
git commit --amend -F /tmp/commit-msg.txt   # when amending
```

A one-line message may use `-m "..."`. A message with a body must use `-F <file>`.

## Effect-TS Best Practices

Before writing or reviewing Effect code, read the matching topic in [`docs/effect-ts/`](./docs/effect-ts/README.md). Those docs are authoritative. When you change an Effect pattern in the code, update its doc in the same PR. Three rules apply everywhere:

- Never compare `_tag` on a `Result`, `Exit`, `Option` or error. Use `Result.isFailure` and `isSuccess`, `Exit.isFailure` and `isSuccess`, `Option.isSome` and `isNone`, the `match` function of each, or `Effect.catchTag`.
- Errors that stay in-process extend `Data.TaggedError`. Errors that cross the HTTP boundary extend `Schema.TaggedError` with an `httpApiStatus` annotation. Never hand-roll a plain class with a manual `_tag` field.
- Effect v4 has no `Either`. `Effect.result` returns a `Result`; narrow it with `Result.isFailure` or `Result.isSuccess`, then read `failure` or `success`.
