#!/usr/bin/env bash
# The shared e2e stack: compose project console-e2e, Emulator on 19297, Console on 19298, Gateway port 19300.
#   up    take the lock, build and start the stack
#   down  stop the stack and release the lock (only if this run's `up` took it)
#   run   up, run the e2e tests (vitest, then Playwright UI tests), then down. On first use it downloads
#         Chromium (about 150 MB) for the UI tests. (also on failure or interrupt)
# The script takes and releases the lock itself (mkdir/rmdir on E2E_LOCK_DIR). Do not mkdir it by hand.
set -euo pipefail
cd "$(dirname "$0")/.."

# The e2e values win over anything exported in the caller's shell (PORT, EMULATOR_HOME, ...).
set -a
. ./.env.e2e
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
set +a

LOCK="${E2E_LOCK_DIR:-${TMPDIR:-/tmp}/console-e2e.lock}"
MARK=".aws/e2e/.started-here"
WAIT_SECONDS=1800
TOKEN="$PWD pid=$$ at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMPOSE=(docker compose --env-file .env.e2e -p console-e2e)

take_lock() {
  local waited=0
  until mkdir "$LOCK" 2>/dev/null; do
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      echo "gave up waiting for the e2e lock $LOCK; held by: $(cat "$LOCK/owner" 2>/dev/null || echo unknown)" >&2
      exit 1
    fi
    echo "e2e stack is locked by: $(cat "$LOCK/owner" 2>/dev/null || echo unknown); waiting" >&2
    sleep 5
    waited=$((waited + 5))
  done
  echo "$TOKEN" > "$LOCK/owner"
  mkdir -p .aws/e2e
  echo "$TOKEN" > "$MARK"
}

# Acts only when the marker (written by this checkout's `up`) and the lock's owner file carry the same token.
down() {
  local mine
  mine="$(cat "$MARK" 2>/dev/null || true)"
  if [ -z "$mine" ] || [ "$mine" != "$(cat "$LOCK/owner" 2>/dev/null || true)" ]; then
    echo "this checkout did not start the e2e stack, or its lock is gone; leaving it alone" >&2
    return 0
  fi
  "${COMPOSE[@]}" down --remove-orphans --volumes || true
  rm -f "$MARK" "$LOCK/owner"
  rmdir "$LOCK" 2>/dev/null || true
}

up() {
  take_lock
  trap 'down' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! "${COMPOSE[@]}" up -d --build --wait; then
    "${COMPOSE[@]}" logs >&2 || true
    ls -la .aws/e2e .aws/e2e/* >&2 || true
    exit 1
  fi
  # The Emulator publishes ca.pem a moment after it starts answering.
  for _ in $(seq 1 30); do
    if ls .aws/e2e/*/ca.pem >/dev/null 2>&1; then
      # The Console's first health check may have run before ca.pem existed; have it look again now.
      curl -fsS -X POST -H "Origin: http://127.0.0.1:${CONSOLE_PORT}" -H "X-Console: 1" "http://127.0.0.1:${CONSOLE_PORT}/api/health/check" >/dev/null || true
      return 0
    fi
    sleep 1
  done
  echo "ca.pem never appeared; ownership of the run folder:" >&2
  ls -la .aws/e2e .aws/e2e/* >&2 || true
  exit 1
}

case "${1:-}" in
  up)
    up
    trap - EXIT INT TERM # the stack stays up for the caller; `down` removes it
    ;;
  down) down ;;
  run)
    up # leaves the EXIT trap set, so the stack comes down whatever happens next
    npx vitest run --config vitest.e2e.config.ts
    # The UI tests need Chromium; this is a no-op once it is installed (CI installs it with its system packages).
    npx playwright install chromium
    npx playwright test
    ;;
  *) echo "usage: $0 up|down|run" >&2; exit 2 ;;
esac
