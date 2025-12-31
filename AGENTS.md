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
