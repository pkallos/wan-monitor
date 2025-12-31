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

## Development Workflow

### 1. Task Planning

Before working on any feature:
- A Linear task MUST be created in the **PHI project**
- The task should include a **full detailed description** of what needs to be done
- Tasks should be scoped to be completable in **one PR with a simple changeset**
- Break down large features into multiple smaller, incremental tasks
- **When you start working on a task, immediately update its Linear status to "In Progress"**

### 2. Branch Management

For each task:
- **Always create feature branches from the tip of `origin/main`** (not a potentially stale local `main`):
  ```bash
  git fetch origin
  git checkout -b feat/feature-name origin/main
  ```
  Or if already on main, pull first:
  ```bash
  git checkout main
  git pull origin main
  git checkout -b feat/feature-name
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

**Examples:**
```
feat: add real-time latency monitoring with WebSocket updates

fix: resolve dark mode styling issue in metrics dashboard

test: add E2E tests for speed test scheduling

chore: update dependencies to latest stable versions
```

### 4. Single Commit Per Feature

- All changes for a task should be in **ONE commit** before pushing
- If multiple commits were made during development, **squash them** before opening the PR
- The commit message should clearly describe what was accomplished

### 5. Pull Request Process

When the feature is complete:

1. **Verify locally:**
   - Run `pnpm lint` - must pass
   - Run `pnpm format` - must pass
   - Run `pnpm test` - all tests must pass
   - Run `pnpm build` - must build successfully

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

## Code Quality Standards

### Testing Requirements

- **New features** must include tests
- **Bug fixes** must include regression tests
- Aim for high test coverage on critical paths
- Use Vitest for unit tests
- Consider E2E tests for user-facing features

### Code Style

- Use Biome.js for linting and formatting (`pnpm check`)
- Follow TypeScript best practices
- Prefer functional components and hooks in React
- Keep components small and focused
- Use descriptive variable and function names

### Documentation

- Update README.md when adding new features
- Add JSDoc comments for complex functions
- Update API documentation if backend changes are made
- Keep REQUIREMENTS.md in sync with implemented features

## CI/CD Pipeline

Before pushing code, ensure all checks pass locally:

```bash
# Run all checks
pnpm lint
pnpm format
pnpm test
pnpm build
```

## Git Best Practices

1. **Keep commits atomic** - one logical change per commit
2. **Write clear commit messages** - follow conventional commits
3. **Rebase before merging** - keep history clean
4. **Squash feature commits** - one commit per PR
5. **Never commit sensitive data** - use environment variables

## Non-Interactive Commands (CRITICAL)

**AI agents cannot interact with terminal prompts or editors.** Commands that open vim, nano, or wait for user input will hang indefinitely in Windsurf.

### Commands to AVOID

| ❌ Avoid | Why |
|----------|-----|
| `git rebase -i` | Opens editor for interactive rebase |
| `git commit` (without `-m`) | Opens editor for commit message |
| `vim`, `nano`, `vi` | Interactive editors |
| `less`, `more` | Interactive pagers |
| Any command prompting for input | Hangs waiting for response |

### Non-Interactive Alternatives

**Squashing commits** (instead of `git rebase -i`):
```bash
# Reset and recommit
git reset --soft HEAD~N
git commit -m "feat: combined commit message"
```

**Amending commits**:
```bash
# Always use --no-edit to skip editor
git commit --amend --no-edit

# Or with a new message
git commit --amend -m "new message"
```

**Rebasing**:
```bash
# Non-interactive rebase onto main
git rebase origin/main

# If conflicts, resolve then:
git add .
git rebase --continue
```

**Aborting operations**:
```bash
git rebase --abort
git merge --abort
git cherry-pick --abort
```

**Viewing logs** (use limits to avoid paging):
```bash
git log -n 10 --oneline
git diff HEAD~1
```

### Environment Variables

If you must use a command that normally opens an editor, override with:
```bash
GIT_EDITOR=true git rebase --continue
EDITOR=true git commit --amend
```

**Remember:** If a command hangs, it's likely waiting for interactive input. Always prefer flags like `--no-edit`, `-m`, or explicit non-interactive alternatives.

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

### Error Handling

**❌ DON'T** use `Effect.either` and manual checks:
```typescript
// Bad - manual Either handling
const result = yield* someEffect.pipe(Effect.either);
if (result._tag === 'Left') {
  // handle error
} else {
  // handle success
}
```

**✅ DO** use `Effect.flatMap` and `Effect.catchAll`:
```typescript
// Good - idiomatic Effect error handling
someEffect.pipe(
  Effect.flatMap((value) => {
    // Success path
    return nextEffect(value);
  }),
  Effect.catchAll((error) => {
    // Error path
    return fallbackEffect(error);
  })
);

// Or use Effect.match for both paths
someEffect.pipe(
  Effect.match({
    onFailure: (error) => handleError(error),
    onSuccess: (value) => handleSuccess(value),
  })
);
```

### Why This Matters

- **Type Safety**: Type guards provide better TypeScript inference
- **Maintainability**: Idiomatic patterns are easier to understand
- **Future-Proof**: Effect-TS may change internal `_tag` implementations
- **Readability**: Pattern matching is more declarative

## Environment Setup

- Node.js 24+ (LTS)
- pnpm 8+
- Use `nvm use` to switch to the correct Node version
- Install dependencies with `pnpm install`

## Resources

- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [Linear - PHI Project](https://linear.app)
- [GitHub Repository](https://github.com/pkallos/wan-monitor)

## Questions or Issues?

If you encounter any issues or have questions about the development workflow, document them and discuss with @pkallos during PR review.
