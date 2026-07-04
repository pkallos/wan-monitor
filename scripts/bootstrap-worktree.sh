#!/usr/bin/env sh
# Bootstrap a git worktree (or fresh clone) so it is ready to run.
#
# Idempotent and best-effort: safe to run repeatedly. This is the single
# entrypoint for making a freshly created worktree usable:
#
#   * Windsurf / Devin Cascade -> `.windsurf/hooks.json` `post_setup_worktree`
#     hook, which runs this script inside the new worktree with the original
#     workspace exposed as $ROOT_WORKSPACE_PATH.
#   * Manual invocation: `sh scripts/bootstrap-worktree.sh` (e.g. under
#     Conductor or plain `git worktree add`).
#
# Responsibilities:
#   1. Seed gitignored local env files (.env.local, .env) from the primary
#      worktree, since they are never checked out into a new worktree.
#   2. Install dependencies (pnpm) when node_modules is absent.
#
# This script intentionally never exits non-zero: a failing hook would leave a
# worktree in a confusing half-created state. Failures are logged loudly so
# they can be retried manually.

set -u

# Dependency install / env seeding is the pipeline's job in CI.
if [ -n "${CI:-}" ]; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Resolve the primary (original) worktree. Prefer $ROOT_WORKSPACE_PATH, which
# Windsurf/Devin Cascade sets for the post_setup_worktree hook; otherwise fall
# back to the parent of the shared (common) .git directory so the script also
# works under Conductor and plain `git worktree add`.
if [ -n "${ROOT_WORKSPACE_PATH:-}" ] && [ -d "$ROOT_WORKSPACE_PATH" ]; then
  PRIMARY_ROOT=$(CDPATH= cd -- "$ROOT_WORKSPACE_PATH" 2>/dev/null && pwd) || PRIMARY_ROOT="$REPO_ROOT"
else
  COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null) || COMMON_DIR=".git"
  case "$COMMON_DIR" in
    /*) ;;                                    # already absolute
    *) COMMON_DIR="$REPO_ROOT/$COMMON_DIR" ;; # normalize relative form
  esac
  PRIMARY_ROOT=$(CDPATH= cd -- "$COMMON_DIR/.." 2>/dev/null && pwd) || PRIMARY_ROOT="$REPO_ROOT"
fi

# --- 1. Seed gitignored local env files from the primary worktree -----------
if [ "$REPO_ROOT" != "$PRIMARY_ROOT" ]; then
  for envfile in .env.local .env; do
    if [ -f "$PRIMARY_ROOT/$envfile" ] && [ ! -f "$REPO_ROOT/$envfile" ]; then
      if cp "$PRIMARY_ROOT/$envfile" "$REPO_ROOT/$envfile"; then
        echo "🌱 bootstrap: copied $envfile from primary worktree"
      fi
    fi
  done
fi

# --- 2. Install dependencies when missing -----------------------------------
if [ ! -d "$REPO_ROOT/node_modules" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    echo "📦 bootstrap: installing dependencies (pnpm install)..."
    if ! (CDPATH= cd -- "$REPO_ROOT" && pnpm install); then
      echo "⚠️  bootstrap: pnpm install failed — run 'pnpm install' manually." >&2
    fi
  else
    echo "⚠️  bootstrap: pnpm not found on PATH — install dependencies manually." >&2
  fi
fi

exit 0
