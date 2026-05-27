#!/usr/bin/env bash
# Layered rate-limiting smoke harness.
#
# Exercises each layer against a local ARC-1 instance backed by the a4h SAP
# trial. Designed to be re-run with different env-var combinations; see the
# scenario matrix at the bottom of the file (or invoke a single scenario via
# `./rate-limit-smoke.sh <scenario_name>`).
#
# Requires:
#   - dist/ built (run `npm run build` first)
#   - a4h credentials in /tmp/arc1-smoke.env (created on first run if missing)
#   - port 8088 free
#
# Output per scenario:
#   - Startup log highlights (semaphore, rate-limit, /mcp mounts)
#   - Counts of 200 / 429 / MCP tool errors per layer
#   - Audit-event counts (auth_rate_limited, mcp_rate_limited, http_request 429/503)
#
# Layers proven by each scenario:
#   - Layer 1 — HTTP edge per-IP cap on /mcp
#   - Layer 2 — per-user MCP quota (returns MCP tool error, not HTTP 429)
#   - Layer 3 — server-wide SAP semaphore (timing-based; serializes concurrent reads)

set -u  # don't set -e — we want to keep going on per-scenario errors
PORT="${PORT:-8088}"
LOG=/tmp/arc1-smoke.log
ENV_FILE=/tmp/arc1-smoke.env

# Portable millisecond clock — macOS BSD `date` doesn't support `%N`, so use
# node when GNU date isn't available. Adds ~100 ms overhead per call but
# stays portable. Used only for diagnostic wall-clock prints.
now_ms() {
  if date +%s%3N 2>/dev/null | grep -qE '^[0-9]+$'; then
    date +%s%3N
  else
    node -e 'process.stdout.write(String(Date.now()))'
  fi
}

# ─── Setup ──────────────────────────────────────────────────────────────────
ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<'EOF'
SAP_URL=http://a4h.marianzeis.de:50000
SAP_USER=MARIAN
SAP_PASSWORD=6j9GylaIHh5yaMXosSAjjRHqD
SAP_CLIENT=001
SAP_LANGUAGE=EN
EOF
    echo "[setup] wrote $ENV_FILE"
  fi
}

kill_server() {
  local pid
  pid=$(lsof -ti:"$PORT" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    # SIGTERM first so the process exits cleanly without bash's "Killed: 9"
    # job-control message leaking into our stdout.
    kill -TERM $pid 2>/dev/null || true
    sleep 1
    # If still running, force-kill silently — discard the job-control message
    # by waiting on the pid before re-checking.
    if kill -0 $pid 2>/dev/null; then
      kill -9 $pid 2>/dev/null || true
      wait $pid 2>/dev/null || true
    fi
  fi
  # Give SAP probe / OAuth callbacks a moment to release sockets, otherwise
  # the next start_server can race the previous shutdown.
  sleep 2
}

# Start the HTTP server in the background with the given rate-limit env.
# Args: AUTH_RATE_LIMIT RATE_LIMIT MAX_CONCURRENT
start_server() {
  local auth="$1" rl="$2" maxc="$3"
  kill_server
  rm -f "$LOG"
  # shellcheck source=/dev/null
  set -a; . "$ENV_FILE"; set +a
  ARC1_AUTH_RATE_LIMIT="$auth" \
  ARC1_RATE_LIMIT="$rl" \
  ARC1_MAX_CONCURRENT="$maxc" \
  ARC1_API_KEYS="testkey:developer-sql" \
  SAP_TRANSPORT=http-streamable ARC1_PORT="$PORT" \
    node dist/index.js > "$LOG" 2>&1 &
  # Wait up to 15 seconds for /health to respond — SAP probe + auth preflight
  # can take several seconds against a remote a4h system.
  local attempts=0
  while [ $attempts -lt 30 ]; do
    if curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
    attempts=$((attempts + 1))
  done
  echo "[start] FAILED — server didn't come up in 15 s. Last log lines:"
  tail -10 "$LOG"
  return 1
}

# Print the three startup lines that show the layer config.
show_layer_config() {
  echo "--- Layer config at startup ---"
  grep -E "SAP semaphore|MCP rate limiting|Auth rate limiting" "$LOG" | sed 's/^/  /'
}

# Fire N MCP requests serially, counting status codes + MCP tool errors.
# Args: N METHOD (tools/list|tools/call) IP_HEADER (optional)
# tools/list — exercises Layer 1 only (doesn't hit handleToolCall, so Layer 2 doesn't fire).
# tools/call — exercises Layer 1 + Layer 2 (a real tool call goes through handleToolCall).
fire_mcp() {
  local n="$1" method="$2" ip="${3:-127.0.0.1}"
  local body_json
  if [ "$method" = "tools/call" ]; then
    body_json='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"SAPRead","arguments":{"type":"PROG","name":"RSPARAM"}}}'
  else
    body_json='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
  fi
  local p200=0 p429=0 p_tool_err=0 p_other=0
  for ((i=0; i<n; i++)); do
    local resp http_code body
    resp=$(curl -s -w "\n__HTTP__%{http_code}" -X POST "http://127.0.0.1:$PORT/mcp" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -H "X-Forwarded-For: $ip" \
      -H 'Authorization: Bearer testkey' \
      -d "$body_json")
    http_code="${resp##*__HTTP__}"
    body="${resp%__HTTP__*}"
    case "$http_code" in
      200)
        # MCP responses are SSE-formatted (`data: {...}`) and the rate-limit
        # payload is JSON-escaped inside the `text` field. Match on `isError`
        # in the result object — that's set true ONLY when the tool returned
        # an error result (Layer 2 denial, validation error, scope denial).
        if echo "$body" | grep -q '"isError":true'; then
          p_tool_err=$((p_tool_err+1))
        else
          p200=$((p200+1))
        fi
        ;;
      429) p429=$((p429+1)) ;;
      *)   p_other=$((p_other+1)) ;;
    esac
  done
  printf "  results [%s]: HTTP 200 (ok)=%d  HTTP 200 (mcp tool-error)=%d  HTTP 429=%d  other=%d\n" \
    "$method" "$p200" "$p_tool_err" "$p429" "$p_other"
}

# Fire N concurrent SAPRead calls (Layer 3 timing test).
# Uses xargs -P for parallelism (more portable / less fragile than bash `&`
# + `wait`, which has stalled on macOS in this test harness with SAP-slow
# responses). Each curl is capped at 30s so the whole burst can't wedge.
# Per-call durations are read from the server audit log — the authoritative
# numbers — since the bash-side wall-clock includes connection setup.
fire_concurrent_read() {
  local n="$1"
  local start end
  start=$(now_ms)
  seq 1 "$n" | xargs -n1 -P"$n" -I{} curl -s --max-time 30 \
    -o "/tmp/resp-{}.json" \
    -X POST "http://127.0.0.1:$PORT/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'Authorization: Bearer testkey' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"SAPRead","arguments":{"type":"PROG","name":"RSPARAM"}}}'
  end=$(now_ms)
  local wall=$((end - start))
  # Count error responses (Layer 2 denial would say isError:true)
  local errs=0
  for f in /tmp/resp-*.json; do
    [ -f "$f" ] && grep -q 'isError' "$f" 2>/dev/null && errs=$((errs+1))
  done
  echo "  wall=${wall}ms across $n concurrent SAPRead calls (errors=$errs)"
  rm -f /tmp/resp-*.json
  echo "  per-call durationMs (last $n SAPRead tool_call_end events; expect stair-step in pairs at cap=2):"
  # Grab the last N tool_call_end lines for SAPRead+RSPARAM, extract durationMs,
  # sort ascending. With cap=2 these should cluster in pairs (≈250 ms, ≈500 ms,
  # ≈750 ms, ≈1000 ms — actual values depend on per-call SAP latency).
  grep -E 'tool_call_end.*SAPRead.*RSPARAM' "$LOG" 2>/dev/null \
    | tail -n "$n" \
    | grep -oE '"durationMs":[0-9]+' \
    | sed 's/"durationMs"://' \
    | sort -n \
    | awk '{ printf "    %d ms\n", $1 }'
}

# Print audit-event counts for the latest run.
# Uses awk instead of `grep -c` — grep -c exits non-zero on zero matches,
# which combined with bash's `|| true` fallback can emit "0\n0" through
# command substitution and break the downstream printf.
count_in_log() {
  awk -v pat="$1" 'index($0, pat) { c++ } END { print (c ? c : 0) }' "$LOG" 2>/dev/null
}
count_re_in_log() {
  awk -v pat="$1" '$0 ~ pat { c++ } END { print (c ? c : 0) }' "$LOG" 2>/dev/null
}
audit_counts() {
  printf "  audit events: auth_rate_limited=%d  mcp_rate_limited=%d  http_request 429/503=%d\n" \
    "$(count_in_log 'auth_rate_limited')" \
    "$(count_in_log 'mcp_rate_limited')" \
    "$(count_re_in_log 'statusCode":(429|503)')"
}

# ─── Scenarios ──────────────────────────────────────────────────────────────

scenario_default() {
  echo "=== Scenario: shipping defaults (Layer 1+3 ON, Layer 2 OFF) ==="
  start_server 20 0 10 || return
  show_layer_config
  echo "Fire 30 SAPRead calls. None should hit 429 or MCP tool error — Layer 2 disabled, Layer 1 cap (600/min) far above 30."
  fire_mcp 30 tools/call
  audit_counts
}

scenario_layer1_tight() {
  echo "=== Scenario: Layer 1 tight (auth_rate_limit=1 → /mcp cap = max(30, 600) = 600) ==="
  start_server 1 0 10 || return
  show_layer_config
  echo "Fire 700 tools/list calls (cheap, no SAP roundtrip). /mcp floor=600 → expect 600 OK + 100 × 429."
  fire_mcp 700 tools/list
  audit_counts
}

scenario_layer2_strict() {
  echo "=== Scenario: Layer 2 strict (rate_limit=5) ==="
  start_server 20 5 10 || return
  show_layer_config
  echo "Fire 10 SAPRead calls (tools/call — actually exercises Layer 2). First 5 succeed, last 5 return MCP tool errors (HTTP 200 body, NOT HTTP 429)."
  fire_mcp 10 tools/call
  audit_counts
}

scenario_layer2_lenient() {
  echo "=== Scenario: Layer 2 lenient (rate_limit=60 — recommended multi-user setting) ==="
  start_server 20 60 10 || return
  show_layer_config
  echo "Fire 30 SAPRead calls. None should hit Layer 2 (60/min cap > 30 calls)."
  fire_mcp 30 tools/call
  audit_counts
}

scenario_layer3_serialization() {
  echo "=== Scenario: Layer 3 serialization (max_concurrent=2, layers 1+2 off) ==="
  start_server 0 0 2 || return
  show_layer_config
  echo "Fire 8 concurrent SAPRead. With cap=2, durations should stair-step in pairs."
  fire_concurrent_read 8
  audit_counts
}

scenario_layer3_wide() {
  echo "=== Scenario: Layer 3 wide (max_concurrent=20) ==="
  start_server 0 0 20 || return
  show_layer_config
  echo "Fire 8 concurrent SAPRead. With cap=20, all 8 should land in one batch (similar durations)."
  fire_concurrent_read 8
  audit_counts
}

scenario_all_disabled() {
  echo "=== Scenario: ALL LAYERS OFF (auth=0, rate=0, max=10000) ==="
  start_server 0 0 10000 || return
  show_layer_config
  echo "Fire 50 /mcp calls + 8 concurrent SAPRead. Everything should pass; no caps."
  fire_mcp 50 tools/call
  fire_concurrent_read 8
  audit_counts
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  ensure_env
  if [ ! -f dist/index.js ]; then
    echo "dist/index.js missing — run 'npm run build' first."
    exit 1
  fi

  local scenarios=(
    scenario_default
    scenario_layer1_tight
    scenario_layer2_strict
    scenario_layer2_lenient
    scenario_layer3_serialization
    scenario_layer3_wide
    scenario_all_disabled
  )

  if [ $# -gt 0 ]; then
    # Run a single named scenario, e.g. `./rate-limit-smoke.sh scenario_layer1_tight`
    "$1"
  else
    for s in "${scenarios[@]}"; do
      "$s"
      echo ""
    done
  fi

  kill_server
}

main "$@"
