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

# Cascade/Devin hooks run in a minimal non-interactive shell whose PATH often
# omits the locations where node, pnpm, and corepack were installed (nvm,
# Homebrew, the pnpm home). Augment PATH with the usual suspects so tool
# resolution below does not silently fail. Only existing directories are added.
for dir in \
  "${PNPM_HOME:-}" \
  "$HOME/Library/pnpm" \
  "$HOME/.local/share/pnpm" \
  "/opt/homebrew/bin" \
  "/usr/local/bin"; do
  if [ -n "$dir" ] && [ -d "$dir" ]; then
    case ":$PATH:" in
      *":$dir:"*) ;;
      *) PATH="$dir:$PATH" ;;
    esac
  fi
done
# Prefer the currently-active nvm node, else the newest installed one.
for node_bin in "${NVM_BIN:-}" "$HOME"/.nvm/versions/node/*/bin; do
  if [ -n "$node_bin" ] && [ -d "$node_bin" ]; then
    case ":$PATH:" in
      *":$node_bin:"*) ;;
      *) PATH="$node_bin:$PATH" ;;
    esac
  fi
done
export PATH

# The hook runs inside the new worktree, so the working directory is the target
# repo. Fall back to $PWD if git is unavailable rather than exiting silently.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || REPO_ROOT="$PWD"
[ -n "$REPO_ROOT" ] || REPO_ROOT="$PWD"

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
  # Resolve a pnpm runner. Prefer a pnpm already on PATH, then well-known
  # install locations, then corepack (bundled with node), which also honors the
  # packageManager version pinned in package.json.
  PNPM_RUN=""
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_RUN="pnpm"
  elif [ -n "${PNPM_HOME:-}" ] && [ -x "$PNPM_HOME/pnpm" ]; then
    PNPM_RUN="$PNPM_HOME/pnpm"
  elif [ -x "$HOME/Library/pnpm/pnpm" ]; then
    PNPM_RUN="$HOME/Library/pnpm/pnpm"
  elif command -v corepack >/dev/null 2>&1; then
    corepack enable pnpm >/dev/null 2>&1 || true
    PNPM_RUN="corepack pnpm"
  fi

  if [ -n "$PNPM_RUN" ]; then
    echo "📦 bootstrap: installing dependencies ($PNPM_RUN install)..."
    if ! (CDPATH= cd -- "$REPO_ROOT" && $PNPM_RUN install); then
      echo "⚠️  bootstrap: dependency install failed — run 'pnpm install' manually." >&2
    fi
  else
    echo "⚠️  bootstrap: could not locate pnpm or corepack — install dependencies manually." >&2
  fi
fi

exit 0
