---
trigger: always_on
---

# PR Preparation & Workflow Rules

## Branch Workflow

**This project uses a two-branch workflow:**
- `development` - Default branch for all feature work. PRs target this branch.
- `main` - Release branch. Only @pkallos merges from development to main.

**Always branch from and PR to `development`, NOT `main`.**

## SECTION 1: Before Committing & Pushing - Run ALL CI Checks Locally (MANDATORY)

Execute these commands IN ORDER and ensure ALL pass:

### 1. Lint Check
```bash
pnpm run lint
```
✅ Must pass with zero errors (warnings are acceptable)

### 2. Format Check
```bash
pnpm run format
```
✅ Must pass - all files properly formatted

### 3. Unit Tests
```bash
pnpm test
```
✅ Must pass - all tests passing, no skipped tests added

### 4. Build
```bash
pnpm run build
```
✅ Must pass - production build succeeds

### 5. E2E Tests (if you modified UI or added E2E tests)
```bash
# Start dev server in separate terminal
pnpm run dev

# Run E2E tests
pnpm test:e2e
```
✅ Must pass - all E2E tests passing, no new failures

**CRITICAL:** If ANY step fails, fix it before pushing. Do NOT push with failing checks.

---

## SECTION 2: Review Your Changeset Before Committing (MANDATORY)

Run `git status` and `git diff` to review ALL changes:

### Files to REMOVE (never commit these):
- ❌ Markdown files you created for context (e.g., `notes.md`, `progress.md`, `temp.md`)
- ❌ Debug files (e.g., `debug.log`, `test-output.txt`)
- ❌ IDE-specific files (e.g., `.vscode/`, `.idea/`)
- ❌ Temporary test files (e.g., `temp.test.ts`, `scratch.tsx`)

### Files to VERIFY:
- ✅ Only production code changes
- ✅ Only relevant test files
- ✅ No commented-out code blocks
- ✅ No `console.log()` or debug statements
- ✅ No `TODO` or `FIXME` comments without corresponding issues

### Commands to check:
```bash
git status
git diff --cached  # Review staged changes
```

### Code Review Standards:

Review the entire changeset against the original goal, and give yourself a constructive code review as if you were a Principle Engineer reviewing the code. Implement feedback that is inline with the original goal, and aligned with the goals of the project.

---

## SECTION 3: Commit Requirements (MANDATORY)

### Single Commit Rule
- ✅ All changes MUST be in ONE commit before pushing
- ✅ Use conventional commit format: `feat:`, `fix:`, `test:`, etc.
- ✅ Commit message should be descriptive (50-72 chars)

### How to Squash Commits
If you have multiple commits:
```bash
# Interactive rebase to squash
git rebase -i HEAD~N  # N = number of commits to squash

# Or reset and recommit
git reset --soft HEAD~N
git commit -m "feat: descriptive message"
```

### Commit Message Format
```
<type>: <short description>

<optional longer description>
<optional breaking changes>
```

**Examples:**
- ✅ `feat: add visual feedback for unsaved changes with E2E tests`
- ✅ `fix: resolve dark mode styling issue in transaction editor`
- ❌ `WIP: testing stuff` (too vague)
- ❌ `feat: add feature` (not descriptive)

---

## SECTION 4: Test Requirements (MANDATORY - NO EXCEPTIONS)

### When Adding Features
- ✅ MUST include E2E tests that validate the feature works end-to-end
- ✅ MUST include unit tests for all new functions/components
- ✅ Tests must cover edge cases, not just happy paths
- ✅ Tests must actually RUN and PASS before pushing

### When Modifying Features
- ✅ Update existing tests to match new behavior
- ✅ Add new tests for new edge cases
- ✅ Ensure ALL tests still pass

### Test Quality Standards
- ❌ NEVER skip tests (`test.skip`, `it.skip`, `describe.skip`)
- ❌ NEVER commit `.only` tests (`test.only`, `it.only`)
- ❌ NEVER create tests that don't assert anything meaningful
- ❌ NEVER compromise functionality to make tests pass (unless fixing a real bug)
- ✅ Tests should fail if the feature breaks
- ✅ Tests should be maintainable and readable

### Verification Commands
```bash
# Run specific test file
pnpm test path/to/file.test.tsx

# Run E2E tests for specific feature
pnpm exec playwright test feature-name.spec.ts

# Check test coverage
pnpm test -- --coverage
```

---

## SECTION 5: Self Code Review Checklist (MANDATORY)

Before pushing, review your code and answer YES to ALL:

### Functionality
- [ ] Does the code accomplish the original goal/issue?
- [ ] Does it work in both light AND dark mode?
- [ ] Does it work on different screen sizes?
- [ ] Are there any edge cases not handled?

### Code Quality
- [ ] Is the code readable and well-organized?
- [ ] Are variable/function names descriptive?
- [ ] Is there any duplicated code that should be extracted?
- [ ] Are there any overly complex functions that should be simplified?
- [ ] Does it follow existing patterns in the codebase?

### Performance
- [ ] Are there any unnecessary re-renders?
- [ ] Are there any memory leaks (event listeners, timers)?
- [ ] Are expensive operations memoized/cached?

### Security
- [ ] Is user input validated?
- [ ] Are there any XSS vulnerabilities?
- [ ] Are API keys/secrets properly handled?

### Documentation
- [ ] Are complex functions commented?
- [ ] Is the PR description clear and complete?
- [ ] Are breaking changes documented?

**If you answer NO to any question, fix it before pushing.**

---

## SECTION 6: Making Changes to an Existing PR (MANDATORY)

### After Pushing
If you need to make changes after the initial push:

1. **Make the changes**
2. **Run ALL CI checks again** (lint, format, test, build, e2e)
3. **Review the changeset** (remove temp files)
4. **Squash all commits** into one
5. **Force push** (since you're rewriting history)

```bash
# After making changes
git add -A
git commit --amend --no-edit  # Add to existing commit

# OR if you made multiple commits
git rebase -i HEAD~N
# Squash all into one

# Force push (required after rebase/amend)
git push -f origin branch-name
```

### CI Failures
If CI fails after pushing:

1. **Check the CI logs** - identify the exact failure
2. **Reproduce locally** - run the failing command
3. **Fix the issue**
4. **Run ALL checks again** - not just the one that failed
5. **Squash and force push**

**NEVER push multiple "fix CI" commits. Always squash.**

---

## SECTION 7: Complete PR Workflow - Step by Step (REFERENCE)

Follow this EXACT sequence:

### Phase 1: Development
1. Create feature branch from development: `git checkout -b feature/name origin/development`
2. Implement the feature
3. Write unit tests
4. Write E2E tests (if UI changes)

### Phase 2: Local Verification (CRITICAL - DO NOT SKIP)
5. Run `pnpm run lint` → must pass
6. Run `pnpm run format` → must pass
7. Run `pnpm test` → must pass
8. Run `pnpm run build` → must pass
9. Run `pnpm test:e2e` → must pass (with dev server running)

### Phase 3: Changeset Review
10. Run `git status` and `git diff`
11. Remove temporary/debug files
12. Remove console.logs and debug code
13. Verify no `.windsurf/rules/` files included
14. Self code review (answer all checklist questions)

### Phase 4: Commit
15. Stage changes: `git add -A`
16. Commit: `git commit -m "feat: descriptive message"`
17. Verify single commit: `git log --oneline -5`
18. If multiple commits, squash them

### Phase 5: Push & PR
19. Push: `git push -u origin feature/name`
20. Create PR with detailed description
21. Wait for CI to complete
22. If CI fails, go back to Phase 2

### Phase 6: PR Updates (if needed)
23. Make changes
24. Repeat Phase 2 (all checks)
25. Repeat Phase 3 (review)
26. Amend commit: `git commit --amend --no-edit`
27. Force push: `git push -f origin feature/name`

**NEVER skip steps. NEVER push without completing Phase 2.**

---

## Test-Specific Rules

### Regarding ALL Tests:
- Never create happy-path tests: the tests should provide meaningful value
- Never mark tests as skipped instead of fixing them: the job isn't done until the tests pass and are useful
- Never decrease or compromise on functionality, or rewrite real code, in order to make the tests pass, UNLESS the tests have identified a meaningful, real bug.
- Never delete tests in order to get tests to pass, unless the corresponding code has been removed. Always aim to keep tests in sync with the code.
- It should be extremely rare to remove code in order to get tests to pass, unless the corresponding tests have been removed. Always aim to keep code in sync with the tests. Same for linting, keep the linting rules with few ignores.
