#!/usr/bin/env bash
# scripts/e2e-stop-local.sh
# Stops the local MCP server and shows error summary.
set -euo pipefail

# Match the (optionally per-run) PID file chosen by e2e-start-local.sh.
PID_FILE="${E2E_PID_FILE:-/tmp/arc1-e2e.pid}"
LOG_DIR="${E2E_LOG_DIR:-/tmp/arc1-e2e-logs}"
LOG_FILE="${LOG_DIR}/mcp-server.log"

echo ""
echo "-- Stopping MCP server..."

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    # Wait briefly for graceful shutdown
    for i in $(seq 1 5); do
      if ! kill -0 "$PID" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    # Force kill if still alive
    if kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID" 2>/dev/null || true
    fi
    echo "   Stopped MCP server (PID: $PID)"
  else
    echo "   MCP server already stopped (PID: $PID was not running)"
  fi
  rm -f "$PID_FILE"
else
  echo "   No PID file found"
fi

echo ""

# Show error summary if any
if [ -f "${LOG_FILE}" ]; then
  node scripts/e2e-local-utils.mjs error-summary "${LOG_FILE}"
else
  echo "-- No server log found"
fi

echo "MCP server stopped."
