#!/usr/bin/env bash
# scripts/e2e-start-local.sh
# Starts the MCP server locally on the CI runner (or dev machine).
# The server connects to the remote SAP system via direct HTTP.
# No SSH, no rsync, no remote deployment — the server is just a local Node.js process.
set -euo pipefail

MCP_PORT="${E2E_MCP_PORT:-3000}"
LOG_DIR="${E2E_LOG_DIR:-/tmp/arc1-e2e-logs}"
LOG_FILE="${LOG_DIR}/mcp-server.log"
PID_FILE="/tmp/arc1-e2e.pid"

mkdir -p "${LOG_DIR}"

echo ""
echo "======================================================================"
echo "  E2E Local Start"
echo "======================================================================"
echo ""
echo "  SAP URL:    ${SAP_URL:?SAP_URL must be set}"
echo "  MCP port:   ${MCP_PORT}"
echo "  Log file:   ${LOG_FILE}"
echo ""

# ── Kill leftover from a previous run ─────────────────────────────────
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "-- Stopping previous MCP server (PID: ${OLD_PID})..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# Kill anything still on the port (belt-and-suspenders). Prefer lsof because
# it works on macOS and Linux; fuser's "<port>/tcp" form is Linux-specific.
if command -v lsof > /dev/null 2>&1; then
  LISTENER_PIDS=$(lsof -tiTCP:"${MCP_PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${LISTENER_PIDS}" ]; then
    echo "-- Stopping process(es) listening on port ${MCP_PORT}: ${LISTENER_PIDS//$'\n'/ }"
    kill ${LISTENER_PIDS} 2>/dev/null || true
    sleep 1
  fi
elif command -v fuser > /dev/null 2>&1; then
  fuser -k "${MCP_PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

# ── SAP health check (direct HTTP) ───────────────────────────────────
echo "-- Checking SAP system at ${SAP_URL}..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -u "${SAP_USER:?SAP_USER must be set}:${SAP_PASSWORD:?SAP_PASSWORD must be set}" \
  -H "sap-client: ${SAP_CLIENT:-001}" \
  "${SAP_URL}/sap/bc/adt/discovery" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "000" ]; then
  echo "ERROR: SAP system not reachable at ${SAP_URL}"
  echo "  - Is the SAP system running?"
  echo "  - Can this machine reach ${SAP_URL}?"
  exit 1
fi
echo "   SAP: OK (HTTP ${HTTP_CODE})"

# ── Start MCP server ─────────────────────────────────────────────────
echo ""
echo "-- Starting MCP server..."

# Truncate old log
> "${LOG_FILE}"

SAP_TRANSPORT=http-streamable \
ARC1_PORT="${MCP_PORT}" \
SAP_INSECURE=true \
SAP_ALLOW_WRITES=true \
SAP_ALLOW_DATA_PREVIEW=true \
SAP_ALLOW_FREE_SQL=true \
SAP_ALLOW_TRANSPORT_WRITES=true \
SAP_ALLOW_GIT_WRITES=false \
SAP_ALLOWED_PACKAGES='$TMP,$ARC1T_*' \
ARC1_CACHE=memory \
nohup node dist/index.js >> "${LOG_FILE}" 2>&1 &
echo $! > "$PID_FILE"

NEW_PID=$(cat "$PID_FILE")
echo "   Started (PID: ${NEW_PID})"

# ── Wait for health check ────────────────────────────────────────────
echo "-- Waiting for MCP server to become ready..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${MCP_PORT}/health" > /dev/null 2>&1; then
    HEALTH_JSON=$(curl -sf "http://localhost:${MCP_PORT}/health" 2>/dev/null || echo "{}")
    HEALTH_VERSION=$(printf '%s' "${HEALTH_JSON}" | node scripts/e2e-local-utils.mjs health-field version)
    HEALTH_STARTED=$(printf '%s' "${HEALTH_JSON}" | node scripts/e2e-local-utils.mjs health-field startedAt)
    echo ""
    echo "======================================================================"
    echo "  MCP server ready on port ${MCP_PORT}"
    echo "  PID:       ${NEW_PID}"
    echo "  Version:   ${HEALTH_VERSION}"
    echo "  Started:   ${HEALTH_STARTED}"
    echo "  Safety:    writes/data/sql/transports enabled; git writes disabled"
    echo "======================================================================"
    echo ""
    exit 0
  fi
  sleep 1
done

echo ""
echo "ERROR: MCP server did not start within 30s"
echo "-- Process status: --"
echo "   Expected PID: $NEW_PID"
echo "   PID alive: $(kill -0 $NEW_PID 2>/dev/null && echo 'yes' || echo 'NO')"
echo "-- Server log (last 50 lines): --"
tail -50 "${LOG_FILE}"
echo "-- End of server log --"
exit 1
