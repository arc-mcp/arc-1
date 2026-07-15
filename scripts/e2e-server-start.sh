#!/usr/bin/env bash
# scripts/e2e-server-start.sh
# Runs ON THE SERVER inside flock. Uploaded by e2e-deploy.sh.
set -euo pipefail

DEPLOY_DIR="/opt/arc1-e2e"
MCP_PORT="${MCP_PORT:-3000}"
LOCKFILE="/tmp/arc1-e2e.lock"

echo "Lock acquired at $(date -Iseconds) (PID: $$)" > "${LOCKFILE}.info"

# Remove stale SQLite cache files (harmless safeguard)
rm -f "${DEPLOY_DIR}/.arc1-cache.db" "${DEPLOY_DIR}/.arc1-cache.db-wal" "${DEPLOY_DIR}/.arc1-cache.db-shm"

# ── Kill ALL previous MCP server processes ──────────────────────────
# Must be thorough: old processes from previous deploys may still be
# running on the MCP port with stale code. Kill by:
# 1. PID file (most recent known PID)
# 2. Pattern match on command line (covers any node process running our code)
# 3. Port (nuclear option — kill whatever is on the port)
OLD_PID=$(cat /tmp/arc1-e2e.pid 2>/dev/null || echo "")
if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
  echo "   Stopping previous MCP server (PID: $OLD_PID)..."
  kill "$OLD_PID" 2>/dev/null || true
  sleep 1
fi
# Match both absolute and relative paths to dist/index.js
pkill -f "node.*dist/index.js" 2>/dev/null || true
sleep 1
# Kill any process still holding the MCP port
fuser -k "${MCP_PORT}/tcp" 2>/dev/null || true
sleep 1

# Verify port is free
if fuser "${MCP_PORT}/tcp" 2>/dev/null; then
  echo "ERROR: Port ${MCP_PORT} is still in use after cleanup!"
  fuser -v "${MCP_PORT}/tcp" 2>/dev/null || true
  exit 1
fi
echo "   Port ${MCP_PORT}: free"

# Ensure firewall allows MCP port
iptables -C INPUT -p tcp --dport "${MCP_PORT}" -j ACCEPT 2>/dev/null || \
  iptables -I INPUT -p tcp --dport "${MCP_PORT}" -j ACCEPT

# Truncate old log
> /tmp/arc1-e2e.log

# Start MCP server
cd "${DEPLOY_DIR}"
# Close inherited fds (3-9) so the background process does NOT hold
# the flock file descriptor — otherwise the lock persists until the
# MCP server exits, blocking future CI runs.
SAP_URL=http://localhost:50000 \
SAP_USER="${SAP_USER:?SAP_USER must be set}" \
SAP_PASSWORD=$(cat "${DEPLOY_DIR}/.sap_password") \
SAP_CLIENT="${SAP_CLIENT:-001}" \
SAP_INSECURE=true \
SAP_TRANSPORT=http-streamable \
ARC1_MINIMAL_ERRORS=false \
ARC1_ALLOW_HTTP_NO_AUTH=true \
SAP_HTTP_ADDR="0.0.0.0:${MCP_PORT}" \
SAP_VERBOSE=true \
SAP_ALLOW_WRITES=true \
SAP_ALLOW_FREE_SQL=true \
SAP_ALLOW_DATA_PREVIEW=true \
SAP_ALLOW_TRANSPORT_WRITES=true \
SAP_ALLOW_GIT_WRITES=false \
SAP_ALLOWED_PACKAGES='$TMP,$ARC1T_*' \
ARC1_CACHE=memory \
nohup node dist/index.js >> /tmp/arc1-e2e.log 2>&1 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&- &
echo $! > /tmp/arc1-e2e.pid

# Wait for health check — verify it's OUR new process serving
NEW_PID=$(cat /tmp/arc1-e2e.pid)
for i in $(seq 1 30); do
  HEALTH=$(curl -sf "http://localhost:${MCP_PORT}/health" 2>/dev/null || echo "")
  if [ -n "$HEALTH" ]; then
    # Verify the responding process is ours by checking PID in health response
    HEALTH_PID=$(echo "$HEALTH" | grep -oP '"pid":\s*\K[0-9]+' || echo "")
    if [ -n "$HEALTH_PID" ] && [ "$HEALTH_PID" != "$NEW_PID" ]; then
      echo "   ZOMBIE DETECTED: /health reports PID $HEALTH_PID but we started PID $NEW_PID"
      echo "   Killing zombie PID $HEALTH_PID..."
      kill -9 "$HEALTH_PID" 2>/dev/null || true
      fuser -k "${MCP_PORT}/tcp" 2>/dev/null || true
      sleep 1
      continue
    fi

    if kill -0 "$NEW_PID" 2>/dev/null; then
      echo "   MCP server ready (PID: $NEW_PID)"
      # Verify transport in log
      if grep -q "http-streamable" /tmp/arc1-e2e.log; then
        echo "   Transport: http-streamable (confirmed)"
      else
        echo "   WARNING: Server log doesn't show http-streamable transport!"
        echo "   Log contents:"
        cat /tmp/arc1-e2e.log
      fi
      # Print startup fingerprint for traceability
      HEALTH_STARTED=$(echo "$HEALTH" | grep -oP '"startedAt":\s*"\K[^"]+' || echo "unknown")
      echo "   Started at: $HEALTH_STARTED"
      exit 0
    fi
  fi
  sleep 1
done

echo ""
echo "ERROR: MCP server did not start within 30s"
echo "-- Process status: --"
echo "   Expected PID: $NEW_PID"
echo "   PID alive: $(kill -0 $NEW_PID 2>/dev/null && echo 'yes' || echo 'NO')"
echo "   Port ${MCP_PORT} held by: $(fuser ${MCP_PORT}/tcp 2>/dev/null || echo 'nothing')"
echo "-- Server log (last 50 lines): --"
tail -50 /tmp/arc1-e2e.log
echo "-- End of server log --"
exit 1
