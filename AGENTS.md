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

When working on this project, agents should:

1. **Understand Requirements**: Thoroughly read and understand the task requirements before starting work
2. **Write Quality Code**: Follow project conventions, write clean, maintainable, tested code
3. **Test Everything**: Ensure all code is properly tested with unit and integration tests
4. **Document Changes**: Update documentation when adding features or changing behavior
5. **Follow Standards**: Adhere to TypeScript, React, and project-specific best practices

## UI/Styling Standards

- **Tailwind CSS**: Lean on Tailwind CSS styles for all styling (check documentation online if necessary) and keep it coherent
- **Chakra UI**: Lean on Chakra UI components (check documentation online if necessary); only use `sx={{}}` on components as a last resort

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

- All changes for a task should be in **ONE commit** before pushing
- If multiple commits were made during development, **squash them** before opening the PR
- The commit message should clearly describe what was accomplished

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
   - Ensure CI checks pass

4. **Review and Iterate:**
   - @pkallos will review the PR and provide feedback
   - Make requested changes in the same branch
   - Squash all commits into one before re-requesting review
   - Once approved, the PR will be merged

5. **Making Changes to an Existing PR:**

   If you need to make changes after the initial push:
   1. Make the changes
   2. Run ALL CI checks again (lint, format, test, typecheck, build)
   3. Review the changeset (remove temp files)
   4. Squash all commits into one (see **Non-Interactive Commands** section for how)
   5. Force push: `git push -f origin branch-name`

   **If CI fails after pushing:**
   1. Check the CI logs - identify the exact failure
   2. Reproduce locally - run the failing command
   3. Fix the issue
   4. Run ALL checks again - not just the one that failed
   5. Squash and force push

   **NEVER push multiple "fix CI" commits. Always squash.**

6. **After Merge:**
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

**Examples:**

- Backend API endpoint: `["Feature", "backend"]`
- UI bug fix: `["Bug", "frontend"]`
- Docker documentation: `["Improvement", "devops", "documentation", "quick-win"]`
- Database reliability feature: `["Feature", "backend", "reliability"]`
- CI/CD breaking change: `["Improvement", "devops", "breaking-change"]`
- Frontend performance optimization: `["Improvement", "frontend", "performance"]`

#### Agent Responsibilities

When working on Linear tasks, agents should:

- **Verify tags before starting work** - Ensure all issues have appropriate tags
- **Add missing tags** - If an issue is untagged or under-tagged, add appropriate labels
- **Update tags if scope changes** - Adjust labels if the work evolves during implementation
- **Use tags for prioritization** - Consider tags when selecting which tasks to work on

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

**Functionality:**
- [ ] Does the code accomplish the original goal/issue?
- [ ] Does it work in both light AND dark mode?
- [ ] Does it work on different screen sizes?
- [ ] Are there any edge cases not handled?

**Code Quality:**
- [ ] Is the code readable and well-organized?
- [ ] Are variable/function names descriptive?
- [ ] Is there any duplicated code that should be extracted?
- [ ] Are there any overly complex functions that should be simplified?
- [ ] Does it follow existing patterns in the codebase?

**Performance:**
- [ ] Are there any unnecessary re-renders?
- [ ] Are there any memory leaks (event listeners, timers)?
- [ ] Are expensive operations memoized/cached?

**Security:**
- [ ] Is user input validated?
- [ ] Are there any XSS vulnerabilities?
- [ ] Are API keys/secrets properly handled?

**If you answer NO to any question, fix it before pushing.**

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

### Documentation

- Update README.md when adding new features
- Add JSDoc comments for complex functions
- Update API documentation if backend changes are made

## Non-Interactive Commands (CRITICAL)

**AI agents cannot interact with terminal prompts or editors.** Commands that open vim, nano, or wait for user input will hang indefinitely.

All commands should be non-interactive. This is especially important for git operations like rebasing and squashing branches. Avoid interactive rebasing (`git rebase -i`), editors (`vim`, `nano`), and pagers (`less`, `more`). Always use flags like `--no-edit`, `-m`, or non-interactive alternatives.

## Effect-TS Best Practices

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
