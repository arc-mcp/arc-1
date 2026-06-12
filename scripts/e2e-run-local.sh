#!/usr/bin/env bash
# scripts/e2e-run-local.sh
# Orchestrate a full local E2E run that is ISOLATED from any other run against
# the same SAP system: it picks a free port, a per-run id, and per-run PID/log
# paths, then builds → starts the MCP server → syncs fixtures + runs vitest →
# stops the server. Two `npm run test:e2e:full` invocations on one machine no
# longer collide (the old fixed port 3000 + fixed PID file meant the second run
# killed the first).
#
# CI does NOT use this script — it runs the start/test/stop steps separately
# with the default port 3000 (one run at a time, enforced by a concurrency
# group), so that path is unchanged.
set -euo pipefail

# ── Per-run identity ─────────────────────────────────────────────────
# Short alphanumeric token; also exported as TEST_RUN_ID so the TS layer
# (tests/helpers/run-id.ts) stamps the SAME id into generated object names.
RUN_ID="${TEST_RUN_ID:-$(node scripts/e2e-local-utils.mjs run-id)}"
export TEST_RUN_ID="${RUN_ID}"

# ── Free port (unless caller pinned one) ─────────────────────────────
if [ -z "${E2E_MCP_PORT:-}" ]; then
  E2E_MCP_PORT="$(node scripts/e2e-local-utils.mjs free-port)"
  # The port was just probed free — tell the start script not to sweep it
  # (sweeping is the "kill whatever is on this port" belt-and-suspenders that
  # must never reach into another run).
  export E2E_SKIP_PORT_SWEEP=1
fi
export E2E_MCP_PORT
export E2E_MCP_URL="${E2E_MCP_URL:-http://localhost:${E2E_MCP_PORT}/mcp}"

# ── Per-run PID + log paths ──────────────────────────────────────────
export E2E_PID_FILE="${E2E_PID_FILE:-/tmp/arc1-e2e-${RUN_ID}.pid}"
export E2E_LOG_DIR="${E2E_LOG_DIR:-/tmp/arc1-e2e-logs/${RUN_ID}}"

echo ""
echo "======================================================================"
echo "  E2E full run (isolated)"
echo "    run id:   ${RUN_ID}"
echo "    port:     ${E2E_MCP_PORT}"
echo "    url:      ${E2E_MCP_URL}"
echo "    log dir:  ${E2E_LOG_DIR}"
echo "======================================================================"

# ── Advisory: warn if CI is hammering the same SAP system right now ───
# Non-fatal — runs are isolated by run-id; this only flags work-process
# contention. Silently skipped when gh is absent / unauthenticated.
if command -v gh > /dev/null 2>&1; then
  RUNNING="$(GH_PAGER=cat gh run list --status in_progress --limit 20 \
    --json workflowName --jq '[.[]|select(.workflowName=="Test" or .workflowName=="SAP Slow Tests")]|length' 2> /dev/null || echo 0)"
  if [ "${RUNNING:-0}" != "0" ]; then
    echo ""
    echo "  ⚠ ${RUNNING} CI run(s) touching the SAP system are in progress."
    echo "    Your run is isolated, but heavy overlap can exhaust SAP work processes."
  fi
fi

# ── build → start → test → stop ──────────────────────────────────────
npm run build

# Always stop the server, even if start or the tests fail under `set -e`. The old
# inline test:e2e:full ran stop unconditionally; this trap preserves that so a
# failed start can never leak the spawned (write-enabled) MCP server.
trap 'npm run test:e2e:stop || true' EXIT

npm run test:e2e:start

set +e
npm run test:e2e
TEST_EXIT=$?
set -e

exit "${TEST_EXIT}"
