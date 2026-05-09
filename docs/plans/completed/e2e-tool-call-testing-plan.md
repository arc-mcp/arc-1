# E2E Tool Call Testing Plan

## Problem Statement

Current integration tests (`tests/integration/adt.integration.test.ts`) call ADT client methods directly — they test the HTTP layer, XML parsing, and safety system, but **not** the MCP tool-call layer. This means:

- Tool routing in `intent.ts` (the `handleToolCall` switch) is untested against real SAP
- Tool argument parsing/validation is untested end-to-end
- LLM-friendly error formatting is untested with real SAP errors
- Scope enforcement + safety system interaction is untested
- Elicitation protocol (`src/server/elicit.ts`) is implemented but **never invoked** by any tool handler — needs E2E validation
- The full MCP JSON-RPC roundtrip (client → HTTP transport → tool handler → ADT → SAP → response) is never exercised
- Error responses from ADT (404, 403, 500, XML parse errors) are not validated through the MCP layer

## Goal

Run ARC-1 from its **build output** (`dist/`) on `$E2E_SERVER`, execute **real MCP tool calls** via HTTP Streamable transport against the live SAP A4H system. Cover all 11 tools, their variants, expected errors, and elicitation flows. Runnable locally and from GitHub Actions on PRs.

---

## Deployment Strategy

### The Core Constraint

There is **one SAP system** (`$E2E_SERVER`). Only one MCP server instance should run at a time. This must hold across **all callers** — local dev, multiple developers, and GitHub Actions.

### Why Not Docker for the MCP Server?

Docker is overkill here. The `dist/` folder is **892KB** of plain JS files. The deployment is:
1. `rsync` 892KB of JS + `node_modules/` to the server
2. Run `node dist/index.js`
3. Done

No image build, no registry push, no layer caching. The SAP system already runs in Docker — no need to add a second container for a Node.js process.

### Exclusive Lock: One Runner at a Time

The fundamental problem: local dev, another developer, and GitHub Actions all might try to deploy + test simultaneously. The solution is a **server-side lockfile** managed by the deploy script.

```
┌─────────────────┐
│  Developer A     │──┐
│  (local)         │  │
├─────────────────┤  │     ssh: flock /tmp/arc1-e2e.lock      ┌──────────────────┐
│  Developer B     │──┼────────────────────────────────────▶  │  $E2E_SERVER   │
│  (local)         │  │     Only ONE gets the lock.            │                  │
├─────────────────┤  │     Others wait (with timeout)          │  Lock held by    │
│  GitHub Actions  │──┘     or fail immediately.               │  whoever got it  │
│  (PR check)      │                                           │  first.          │
└─────────────────┘                                            └──────────────────┘
```

**How it works:**

The deploy script wraps the entire deploy → start → test → stop sequence in `flock` on the server:

```bash
# scripts/e2e-deploy.sh (simplified)
LOCKFILE=/tmp/arc1-e2e.lock
TIMEOUT=300  # wait up to 5 min for lock, then fail

ssh $SERVER "flock --timeout $TIMEOUT $LOCKFILE bash -c '
  # === CRITICAL SECTION: only one runner at a time ===

  # 1. Kill any leftover MCP server
  pkill -f \"node dist/index.js\" || true
  sleep 1

  # 2. Accept fresh dist/ (already rsync'd before flock)
  # 3. Start MCP server
  cd /opt/arc1-e2e
  SAP_URL=http://localhost:50000 ... node dist/index.js &
  MCP_PID=\$!

  # 4. Wait for ready
  for i in \$(seq 1 30); do
    curl -sf http://localhost:3000/health && break
    sleep 1
  done

  # 5. Signal: server is ready (write PID to lockfile for debugging)
  echo \$MCP_PID > /tmp/arc1-e2e.pid
'"
```

The **lock is held for the entire duration** of the test run — from deploy through test execution to shutdown. This means:

| Scenario | What Happens |
|----------|-------------|
| Dev A runs locally | Gets lock, deploys, tests, releases lock |
| Dev B runs locally at same time | `flock` waits up to 5 min. If A finishes in time, B proceeds. Otherwise B fails with clear message. |
| GH Actions runs during local dev | Same — waits or fails. GH Actions concurrency guard (`cancel-in-progress: false`) queues at the GH level too. |
| Dev A's run crashes mid-test | Lock is auto-released when SSH session ends (`flock` is tied to the process). No stale locks. |
| Server reboots | `/tmp/arc1-e2e.lock` is gone (tmpfs). No cleanup needed. |

**Key property: `flock` is tied to the process, not the file.** If the SSH connection drops or the script crashes, the OS releases the lock automatically. No stale lock files, no manual cleanup, no "lockfile exists but owner is dead" problem.

### Preventing GH Actions from Conflicting with Local Runs

GitHub Actions concurrency groups only prevent **GH-vs-GH** collisions. They don't know about local runs. The `flock` on the server handles **all callers uniformly**.

```
┌──────────────────────────────────────────────────┐
│  Protection Layer 1: GitHub Actions concurrency  │  GH ↔ GH only
│  concurrency: { group: e2e-sap, queue }          │
├──────────────────────────────────────────────────┤
│  Protection Layer 2: Server-side flock           │  ALL callers
│  flock /tmp/arc1-e2e.lock                        │  (local, CI, any dev)
└──────────────────────────────────────────────────┘
```

Both layers are needed:
- **GH concurrency group**: prevents GH from queuing 10 runners that all SSH to the server simultaneously
- **Server-side flock**: prevents local dev from colliding with GH or other devs

### Deployment Flow

```
┌─────────────────────┐                                      ┌──────────────────────┐
│  Local / GH Actions │                                      │   $E2E_SERVER      │
│                     │                                      │                      │
│  npm ci             │  1. rsync dist/ + node_modules/      │  /opt/arc1-e2e/      │
│  npm run build      │ ──────────────────────────────────▶ │    dist/             │
│                     │                                      │    node_modules/     │
│                     │  2. ssh flock → start server         │                      │
│                     │ ──────────────────────────────────▶ │  node dist/index.js  │
│                     │                                      │  ↕ localhost:50000   │
│  npm run test:e2e   │  3. HTTP :3000/mcp                   │  (SAP A4H Docker)   │
│  (vitest → MCP SDK) │ ◀────────────────────────────────── │                      │
│                     │                                      │                      │
│                     │  4. ssh: stop + release lock          │                      │
│                     │ ──────────────────────────────────▶ │  (lock released)     │
└─────────────────────┘                                      └──────────────────────┘
```

### The Deploy Script

```bash
#!/usr/bin/env bash
# scripts/e2e-deploy.sh
# Deploys dist/ to the E2E test server, starts MCP server under exclusive lock.
# The lock prevents multiple callers (local devs, CI) from colliding.
#
# Outputs are designed so you can see exactly what happened at every step.
set -euo pipefail

SERVER="${E2E_SERVER:?E2E_SERVER must be set}"
SERVER_USER="${E2E_SERVER_USER:?E2E_SERVER_USER must be set}"
DEPLOY_DIR="/opt/arc1-e2e"
LOCKFILE="/tmp/arc1-e2e.lock"
LOCK_TIMEOUT="${E2E_LOCK_TIMEOUT:-300}"  # 5 min default
MCP_PORT="${E2E_MCP_PORT:-3000}"
LOG_DIR="${E2E_LOG_DIR:-/tmp/arc1-e2e-logs}"  # local directory for collected logs

SSH="ssh ${SERVER_USER}@${SERVER}"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# Create local log directory (for collecting server logs after tests)
mkdir -p "${LOG_DIR}"

# ── Step 1: Pre-flight checks ──────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  E2E Deploy                                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Server:     ${SERVER_USER}@${SERVER}"
echo "  Deploy dir: ${DEPLOY_DIR}"
echo "  MCP port:   ${MCP_PORT}"
echo "  Lock file:  ${LOCKFILE} (timeout: ${LOCK_TIMEOUT}s)"
echo "  Local logs: ${LOG_DIR}/"
echo ""

# Check SSH connectivity first — fail fast with clear message
echo "── Checking SSH connectivity..."
if ! ssh ${SSH_OPTS} ${SERVER_USER}@${SERVER} "echo ok" > /dev/null 2>&1; then
  echo "ERROR: Cannot SSH to ${SERVER_USER}@${SERVER}"
  echo "  - Is the server running?"
  echo "  - Is your SSH key configured?"
  echo "  - Try: ssh ${SERVER_USER}@${SERVER}"
  exit 1
fi
echo "   SSH: OK"

# Check if SAP is running
echo "── Checking SAP system..."
SAP_STATUS=$(ssh ${SSH_OPTS} ${SERVER_USER}@${SERVER} \
  "curl -sf -o /dev/null -w '%{http_code}' http://localhost:50000/sap/public/ping 2>/dev/null || echo 'DOWN'")
if [ "$SAP_STATUS" = "DOWN" ] || [ "$SAP_STATUS" = "000" ]; then
  echo "ERROR: SAP system not reachable at localhost:50000"
  echo "  - Check Docker container: ssh ${SERVER_USER}@${SERVER} 'docker ps | grep a4h'"
  echo "  - Start SAP: ssh ${SERVER_USER}@${SERVER} 'docker start a4h'"
  exit 1
fi
echo "   SAP: OK (HTTP $SAP_STATUS)"

# Check if someone else holds the lock
echo "── Checking lock status..."
LOCK_INFO=$(ssh ${SSH_OPTS} ${SERVER_USER}@${SERVER} "cat ${LOCKFILE}.info 2>/dev/null || echo 'no active lock'")
echo "   Lock: ${LOCK_INFO}"

# ── Step 2: Sync files ─────────────────────────────────────────────
echo ""
echo "── Syncing dist/ to server..."
rsync -az --delete --stats -e "ssh ${SSH_OPTS}" dist/ ${SERVER_USER}@${SERVER}:${DEPLOY_DIR}/dist/ 2>&1 | grep -E "total size|speedup"
echo "── Syncing node_modules/..."
rsync -az --delete -e "ssh ${SSH_OPTS}" node_modules/ ${SERVER_USER}@${SERVER}:${DEPLOY_DIR}/node_modules/
scp -q ${SSH_OPTS} package.json ${SERVER_USER}@${SERVER}:${DEPLOY_DIR}/
echo "   Sync: done"

# ── Step 3: Acquire lock and start server ──────────────────────────
echo ""
echo "── Acquiring lock (waiting up to ${LOCK_TIMEOUT}s if another run is active)..."

${SSH} ${SSH_OPTS} "
  flock --timeout ${LOCK_TIMEOUT} ${LOCKFILE} bash -c '
    echo \"Lock acquired by \$(whoami)@\$(hostname) at \$(date -Iseconds) (PID: \$\$)\" > ${LOCKFILE}.info

    # Kill any previous MCP server
    OLD_PID=\$(cat /tmp/arc1-e2e.pid 2>/dev/null || echo \"\")
    if [ -n \"\$OLD_PID\" ] && kill -0 \$OLD_PID 2>/dev/null; then
      echo \"   Stopping previous MCP server (PID: \$OLD_PID)...\"
      kill \$OLD_PID 2>/dev/null || true
      sleep 1
    fi
    pkill -f \"node ${DEPLOY_DIR}/dist/index.js\" 2>/dev/null || true

    # Truncate old log, start fresh
    > /tmp/arc1-e2e.log

    # Start MCP server with verbose logging for debugging
    cd ${DEPLOY_DIR}
    SAP_URL=http://localhost:50000 \
    SAP_USER=DEVELOPER \
    SAP_PASSWORD=\$(cat ${DEPLOY_DIR}/.sap_password) \
    SAP_CLIENT=001 \
    SAP_INSECURE=true \
    SAP_TRANSPORT=http-streamable \
    SAP_HTTP_ADDR=0.0.0.0:${MCP_PORT} \
    SAP_VERBOSE=true \
    nohup node dist/index.js >> /tmp/arc1-e2e.log 2>&1 &
    echo \$! > /tmp/arc1-e2e.pid

    # Wait for health check
    for i in \$(seq 1 30); do
      if curl -sf http://localhost:${MCP_PORT}/health > /dev/null 2>&1; then
        echo \"   MCP server ready (PID: \$(cat /tmp/arc1-e2e.pid))\"
        exit 0
      fi
      sleep 1
    done

    echo \"\"
    echo \"ERROR: MCP server did not start within 30s\"
    echo \"── Server log (last 50 lines): ──\"
    tail -50 /tmp/arc1-e2e.log
    echo \"── End of server log ──\"
    exit 1
  ' || {
    RC=\$?
    if [ \$RC -eq 1 ]; then
      echo \"\"
      echo \"ERROR: Could not acquire lock within ${LOCK_TIMEOUT}s.\"
      echo \"Another E2E run is in progress:\"
      cat ${LOCKFILE}.info 2>/dev/null || echo \"  (no lock info available)\"
      echo \"\"
      echo \"Options:\"
      echo \"  1. Wait for the other run to finish\"
      echo \"  2. Force stop: npm run test:e2e:stop\"
    fi
    exit 1
  }
"

echo ""
echo "══ MCP server running at http://${SERVER}:${MCP_PORT}/mcp ══"
echo ""
```

### The Stop Script

```bash
#!/usr/bin/env bash
# scripts/e2e-stop.sh
# Stops the MCP server, collects logs, releases the lock.
set -euo pipefail

SERVER="${E2E_SERVER:?E2E_SERVER must be set}"
SERVER_USER="${E2E_SERVER_USER:?E2E_SERVER_USER must be set}"
LOG_DIR="${E2E_LOG_DIR:-/tmp/arc1-e2e-logs}"
SSH="ssh ${SERVER_USER}@${SERVER}"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

mkdir -p "${LOG_DIR}"

echo ""
echo "── Collecting MCP server logs..."

# Copy server log before stopping (so we have it even if stop fails)
scp -q ${SSH_OPTS} ${SERVER_USER}@${SERVER}:/tmp/arc1-e2e.log "${LOG_DIR}/mcp-server.log" 2>/dev/null || true

# Count lines for feedback
if [ -f "${LOG_DIR}/mcp-server.log" ]; then
  LINE_COUNT=$(wc -l < "${LOG_DIR}/mcp-server.log")
  echo "   Collected ${LINE_COUNT} log lines → ${LOG_DIR}/mcp-server.log"
else
  echo "   No server log found (server may not have started)"
fi

echo "── Stopping MCP server..."
${SSH} ${SSH_OPTS} "
  if [ -f /tmp/arc1-e2e.pid ]; then
    PID=\$(cat /tmp/arc1-e2e.pid)
    if kill -0 \$PID 2>/dev/null; then
      kill \$PID
      echo \"   Stopped MCP server (PID: \$PID)\"
    else
      echo \"   MCP server already stopped (PID: \$PID was not running)\"
    fi
    rm -f /tmp/arc1-e2e.pid
  else
    echo \"   No PID file found\"
  fi
  pkill -f 'node /opt/arc1-e2e/dist/index.js' 2>/dev/null || true
  rm -f /tmp/arc1-e2e.lock.info
" 2>/dev/null || true

echo ""
echo "── Logs saved to: ${LOG_DIR}/"
echo "   mcp-server.log  — MCP server stderr (audit events, errors, tool calls)"
echo ""

# If server log has errors, show a summary
if [ -f "${LOG_DIR}/mcp-server.log" ]; then
  ERROR_COUNT=$(grep -c '"level":"error"\|"level": "error"\|\[ERROR\]' "${LOG_DIR}/mcp-server.log" 2>/dev/null || echo "0")
  if [ "$ERROR_COUNT" -gt 0 ]; then
    echo "⚠ Found ${ERROR_COUNT} error(s) in server log. Last 5:"
    grep '"level":"error"\|"level": "error"\|\[ERROR\]' "${LOG_DIR}/mcp-server.log" | tail -5
    echo ""
  fi
fi

echo "MCP server stopped. Lock released."
```

### npm Scripts

```jsonc
{
  "scripts": {
    "test:e2e": "vitest run --config tests/e2e/vitest.e2e.config.ts",
    "test:e2e:deploy": "bash scripts/e2e-deploy.sh",
    "test:e2e:stop": "bash scripts/e2e-stop.sh",
    "test:e2e:full": "npm run build && npm run test:e2e:deploy && npm run test:e2e; EXIT=$?; npm run test:e2e:stop; exit $EXIT"
  }
}
```

`test:e2e:full` captures the test exit code, always runs stop, then exits with the original code. This way you see the test failures AND the server gets stopped.

### GitHub Actions

```yaml
e2e:
  runs-on: ubuntu-latest
  if: >
    github.event_name == 'pull_request' &&
    github.event.pull_request.head.repo.full_name == github.repository
  needs: test
  # Layer 1: GH-level queue (prevents multiple GH runners hitting server)
  concurrency:
    group: e2e-sap-system
    cancel-in-progress: false  # queue, don't cancel — tests modify SAP state

  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: 'npm' }

    - name: Setup SSH key
      run: |
        mkdir -p ~/.ssh
        echo "${{ secrets.E2E_SSH_KEY }}" > ~/.ssh/id_ed25519
        chmod 600 ~/.ssh/id_ed25519
        ssh-keyscan -H $E2E_SERVER >> ~/.ssh/known_hosts

    - run: npm ci
    - run: npm run build

    # Layer 2: server-side flock (prevents collision with local devs)
    - name: Deploy to test server
      run: npm run test:e2e:deploy
      env:
        E2E_SERVER: $E2E_SERVER
        E2E_LOCK_TIMEOUT: 600  # CI can wait longer (10 min)
        E2E_LOG_DIR: /tmp/e2e-logs

    - name: Run E2E tests
      run: npm run test:e2e
      env:
        E2E_MCP_URL: http://$E2E_SERVER:3000/mcp
      timeout-minutes: 10

    - name: Stop MCP server + collect logs
      if: always()
      run: npm run test:e2e:stop
      env:
        E2E_LOG_DIR: /tmp/e2e-logs

    # Upload ALL logs as artifact — visible in the GH Actions "Artifacts" tab
    - name: Upload E2E logs
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: e2e-logs
        path: /tmp/e2e-logs/
        retention-days: 14
        if-no-files-found: warn

---

## Observability: Knowing What Happened and Why

### The Problem

When an E2E test fails you're looking at **three systems**: your local machine (vitest), the MCP server (Node.js on the server), and SAP (ABAP backend). The failure could be in any of them. Without proper logging you're guessing.

### Three Log Streams

| Log | Where | What's In It | How To See It |
|-----|-------|-------------|---------------|
| **Vitest output** | Local terminal / GH Actions step log | Test names, pass/fail, assertion errors, expected vs actual | Direct console output |
| **MCP server log** | `/tmp/arc1-e2e.log` on server → collected to `$E2E_LOG_DIR/mcp-server.log` | Every tool call (start/end), duration, args, errors, audit events | `e2e-stop.sh` copies it locally; GH uploads as artifact |
| **SAP system log** | SAP SM21 / `docker exec a4h` | ABAP runtime errors, ICM errors, lock conflicts | Manual check (only needed for deep SAP-side issues) |

### What You See When Tests Pass

```
╔══════════════════════════════════════════════════════════════╗
║  E2E Deploy                                                  ║
╚══════════════════════════════════════════════════════════════╝

  Server:     $E2E_SERVER_USER@$E2E_SERVER
  Deploy dir: /opt/arc1-e2e
  MCP port:   3000
  Lock file:  /tmp/arc1-e2e.lock (timeout: 300s)
  Local logs: /tmp/arc1-e2e-logs/

── Checking SSH connectivity...
   SSH: OK
── Checking SAP system...
   SAP: OK (HTTP 200)
── Checking lock status...
   Lock: no active lock
── Syncing dist/ to server...
   total size is 892,341  speedup is 3.21
── Syncing node_modules/...
   Sync: done
── Acquiring lock...
   MCP server ready (PID: 12345)

══ MCP server running at http://$E2E_SERVER:3000/mcp ══

 ✓ sapread.e2e.test.ts (36 tests) 12.4s
 ✓ sapsearch.e2e.test.ts (8 tests) 3.2s
 ✓ sapwrite.e2e.test.ts (12 tests) 8.7s
   ...
 ✓ 128 tests passed in 2m 14s

── Collecting MCP server logs...
   Collected 847 log lines → /tmp/arc1-e2e-logs/mcp-server.log
── Stopping MCP server...
   Stopped MCP server (PID: 12345)
MCP server stopped. Lock released.
```

### What You See When Tests Fail

**Vitest shows which test failed and why:**
```
 ✗ sapread.e2e.test.ts > SAPRead > reads DDLS source
   AssertionError: expected result to not have property 'isError'

   Tool call:   SAPRead { type: "DDLS", name: "/DMO/FLIGHT" }
   Response:    { isError: true, content: [{ text: "Not found..." }] }
   Expected:    isError to be undefined (success)

   This means the DDLS endpoint returned a 404. Possible causes:
   - /DMO/FLIGHT doesn't exist on this system
   - CDS views not supported (check SAPManage probe → RAP feature)
```

**Stop script shows server-side errors:**
```
── Collecting MCP server logs...
   Collected 312 log lines → /tmp/arc1-e2e-logs/mcp-server.log

⚠ Found 3 error(s) in server log. Last 5:
  {"level":"error","event":"tool_call_end","tool":"SAPRead","status":"error",
   "errorClass":"AdtApiError","errorMessage":"Object /DMO/FLIGHT not found","durationMs":234}
```

### What You See When the Server Won't Start

```
── Acquiring lock...

ERROR: MCP server did not start within 30s
── Server log (last 50 lines): ──
  Error: connect ECONNREFUSED 127.0.0.1:50000
    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)
  ...
── End of server log ──
```

This tells you immediately: SAP is not reachable at localhost:50000 — the Docker container is probably down.

### What You See When Locked Out

```
── Checking lock status...
   Lock: Lock acquired by root@server at 2026-03-30T14:23:45+00:00 (PID: 9876)
── Acquiring lock (waiting up to 300s if another run is active)...

ERROR: Could not acquire lock within 300s.
Another E2E run is in progress:
  Lock acquired by root@server at 2026-03-30T14:23:45+00:00 (PID: 9876)

Options:
  1. Wait for the other run to finish
  2. Force stop: npm run test:e2e:stop
```

### Vitest Configuration for Rich Output

```typescript
// tests/e2e/vitest.e2e.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,  // 60s per test (SAP can be slow)
    sequence: { concurrent: false },  // sequential — one SAP system
    reporters: [
      'default',     // console output (local + GH Actions step log)
      ['junit', {    // machine-readable XML (for GH Actions summary)
        outputFile: process.env.E2E_LOG_DIR
          ? `${process.env.E2E_LOG_DIR}/junit-results.xml`
          : '/tmp/arc1-e2e-logs/junit-results.xml',
      }],
    ],
  },
});
```

### The callTool Wrapper: Rich Failure Context

The test helper wraps every MCP tool call with context so failures are debuggable:

```typescript
// tests/e2e/helpers.ts
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const duration = Date.now() - start;

    // Log every call for local debugging (visible in vitest --reporter=verbose)
    console.log(`  → ${name}(${JSON.stringify(args)}) — ${duration}ms — ${result.isError ? 'ERROR' : 'OK'}`);

    return result;
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`  → ${name}(${JSON.stringify(args)}) — ${duration}ms — THREW: ${err.message}`);

    // Re-throw with enriched message
    throw new Error(
      `Tool call failed: ${name}(${JSON.stringify(args)})\n` +
      `  Duration: ${duration}ms\n` +
      `  Error: ${err.message}\n` +
      `  Check MCP server log: $E2E_LOG_DIR/mcp-server.log`
    );
  }
}

// Assertion helper for error responses
export function expectToolError(result: ToolResult, ...expectedSubstrings: string[]) {
  expect(result.isError, `Expected error but got success: ${result.content[0]?.text?.slice(0, 200)}`).toBe(true);
  const text = result.content[0]?.text ?? '';
  expect(text).not.toContain('<?xml');
  expect(text).not.toContain('at Object.');
  expect(text).not.toContain('.ts:');
  for (const sub of expectedSubstrings) {
    expect(text, `Error message should contain "${sub}":\n  Actual: ${text.slice(0, 300)}`).toContain(sub);
  }
}
```

### Correlating Test Failures with Server Logs

Every MCP tool call emits an audit event in the server log with a `requestId`. When a test fails:

1. Vitest shows: which tool call, what args, what response
2. Server log shows: the same tool call with `requestId`, SAP-side error details, duration
3. Together they tell the full story without guessing

**Server log format (JSON, one line per event):**
```json
{"timestamp":"2026-03-30T14:25:01.123Z","level":"info","event":"tool_call_start","requestId":"r-abc123","tool":"SAPRead","args":{"type":"DDLS","name":"/DMO/FLIGHT"}}
{"timestamp":"2026-03-30T14:25:01.357Z","level":"error","event":"tool_call_end","requestId":"r-abc123","tool":"SAPRead","durationMs":234,"status":"error","errorClass":"AdtApiError","errorMessage":"Object /DMO/FLIGHT not found (HTTP 404)"}
```

### GitHub Actions: What PR Authors See

In the GH Actions run:

1. **Step log** — vitest console output (pass/fail per test, assertion errors)
2. **Artifacts tab** — downloadable `e2e-logs.zip` containing:
   - `mcp-server.log` — full MCP server log for the run
   - `junit-results.xml` — machine-readable test results
3. **Job summary** — (optional, via `actions/test-reporter`) renders JUnit XML as a table in the PR check

```yaml
    # Optional: render test results as a table in the GH Actions summary
    - name: Test report
      if: always()
      uses: dorny/test-reporter@v1
      with:
        name: E2E Test Results
        path: /tmp/e2e-logs/junit-results.xml
        reporter: java-junit
        fail-on-error: false
```

### Log File Summary

| File | Location | Content |
|------|----------|---------|
| `mcp-server.log` | `$E2E_LOG_DIR/` (local) or GH artifact | Server stderr: audit events, tool calls, SAP errors |
| `junit-results.xml` | `$E2E_LOG_DIR/` or GH artifact | Machine-readable test results |
| vitest console | Terminal / GH step log | Human-readable pass/fail + assertion details |

---

## Test Object Setup: Cost & Strategy

### Is Setup Expensive?

**No.** Setup is a SAPSearch check per object (~100ms each). With 5 persistent objects, that's ~500ms total.

| Step | Cost | When |
|------|------|------|
| SAPSearch to check existence | ~100ms per object | Every run |
| SAPWrite create + SAPActivate | ~1-2s per object | Only if missing |
| Full setup (all objects exist) | **~500ms** | Typical case |
| Full setup (all objects missing) | **~10s** | First run or after cleanup |

Objects live in `$TMP` and persist across SAP restarts. Once created, they stay. The setup check is cheap enough to run on every test execution.

### Setup Flow

```
beforeAll:
  1. Connect to MCP server (E2E_MCP_URL)
  2. For each persistent object in FIXTURE_OBJECTS:
     - callTool("SAPSearch", { query: objectName })
     - If not found:
       - Read source from tests/fixtures/abap/<file>
       - callTool("SAPWrite", { action: "create", ... })
       - callTool("SAPActivate", { name, type })
     - If found: skip (already on system)
  3. If any creation failed → skip entire suite with clear error
```

### Why Check + Create Instead of Always Create?

- `SAPWrite create` on an existing object **errors** (409 conflict / already exists)
- Checking first avoids that and is cheap (~100ms vs ~2s for create+activate)
- If objects were deleted (manual cleanup, SAP reset), they get recreated automatically

---

## Test Output Strategy: Snapshots vs Structural Assertions

### Why NOT Snapshot Testing

SAP responses contain volatile data that changes between runs:

```json
{
  "user": "DEVELOPER",
  "systemTime": "2026-03-30T14:23:45",    // changes every call
  "sessionId": "SAP_SESSION_ABC123",       // different per session
  "csrfToken": "xYz789...",               // rotates
  "transportId": "A4HK900123"             // increments
}
```

Snapshot comparison would fail on every run. You'd spend more time updating snapshots than finding bugs.

### Structural Assertions (Recommended)

Instead, assert on the **shape and invariants** of the response:

```typescript
// SAPRead PROG
const result = await callTool("SAPRead", { type: "PROG", name: "RSHOWTIM" });
expect(result.isError).toBeUndefined();                    // no error
expect(result.content).toHaveLength(1);                    // single text block
expect(result.content[0].type).toBe("text");               // text type
expect(result.content[0].text).toContain("REPORT");        // ABAP report keyword
expect(result.content[0].text.length).toBeGreaterThan(10); // non-trivial content

// SAPSearch
const result = await callTool("SAPSearch", { query: "CL_ABAP_*" });
const parsed = JSON.parse(result.content[0].text);
expect(parsed.length).toBeGreaterThan(0);                  // found results
expect(parsed[0]).toHaveProperty("objectName");            // has expected fields
expect(parsed[0]).toHaveProperty("objectType");
expect(parsed[0]).toHaveProperty("uri");
expect(parsed[0].objectName).toMatch(/^CL_ABAP_/);        // matches pattern

// Error case
const err = await callTool("SAPRead", { type: "PROG", name: "ZZZNOTEXIST999" });
expect(err.isError).toBe(true);
expect(err.content[0].text).toContain("not found");        // LLM-friendly
expect(err.content[0].text).toContain("SAPSearch");        // remediation hint
expect(err.content[0].text).not.toContain("<?xml");        // no raw XML leaked
```

### What to Assert per Tool

| Tool | Key Assertions |
|------|----------------|
| **SAPRead** | `isError` false, text is non-empty, contains expected keywords (REPORT, CLASS, INTERFACE...) |
| **SAPSearch** | JSON array, objects have `objectName`/`objectType`/`uri`, pattern matches query |
| **SAPWrite** | Success message contains object name, read-back matches written source |
| **SAPActivate** | Success message or activation errors list (structured, not XML) |
| **SAPNavigate** | JSON with uri/line/column for definition, array for references |
| **SAPQuery** | JSON with `columns` array and `rows` array, column names match query |
| **SAPLint** | JSON array of issues, each with `rule`/`severity`/`message` |
| **SAPDiagnose** | JSON result, syntax check has severity, unittest has test count/pass/fail |
| **SAPTransport** | Transport ID format `A4HK\d{6}`, list returns array, get returns details |
| **SAPContext** | Output contains dependency names, stats line, no raw errors |
| **SAPManage** | JSON with 6 feature entries, each has `id`/`available`/`mode` |
| **Errors** | `isError: true`, no XML, no stack traces, contains hint text |

### For Custom Objects: Assert Against Fixture Content

For objects we created from fixtures, we CAN assert exact content:

```typescript
// We wrote this exact source, so we can check it comes back
const fixture = readFixture("zarc1_test_report.abap");
const result = await callTool("SAPRead", { type: "PROG", name: "ZARC1_TEST_REPORT" });
expect(result.content[0].text).toContain("ARC-1 E2E test report"); // known string from fixture
```

This gives us the best of both worlds: structural assertions for standard SAP objects (volatile), exact assertions for our own fixtures (stable).

---

## ABAP Test Fixtures

All ABAP source files stored in `tests/fixtures/abap/` and loaded by setup.

### Fixture Files

```
tests/fixtures/abap/
├── zarc1_test_report.abap                  # Simple report with text elements
├── zcl_arc1_test.clas.abap                 # Class implementing ZIF_ARC1_TEST
├── zcl_arc1_test_ut.clas.abap              # Class with testable method
├── zcl_arc1_test_ut.clas.testclasses.abap  # ABAP Unit test class (FOR TESTING)
├── zif_arc1_test.intf.abap                 # Interface with method + type
└── zarc1_e2e_write.abap                    # Throwaway program for write lifecycle
```

### Object Inventory

| Object | Type | Name | Package | Purpose | Persistent? |
|--------|------|------|---------|---------|-------------|
| Program | PROG | `ZARC1_TEST_REPORT` | `$TMP` | Read, diagnose, lint | Yes |
| Class | CLAS | `ZCL_ARC1_TEST` | `$TMP` | Read, activate, context, navigate | Yes |
| Class (UT) | CLAS | `ZCL_ARC1_TEST_UT` | `$TMP` | Diagnose/unittest | Yes |
| Interface | INTF | `ZIF_ARC1_TEST` | `$TMP` | Read, context dep | Yes |
| Write lifecycle | PROG | `ZARC1_E2E_WRITE` | `$TMP` | create → update → activate → delete | No (transient) |

**Note:** FUGRs, FUNCs, MSAGs, INCLs, TABLs can't easily be created via ADT API — use standard SAP objects for those.

---

## Test Object Lifecycle (Setup / Teardown)

### Design Principles

1. **You create objects manually first** — `npm run test:e2e:setup` or just run the tests (setup is in `beforeAll`)
2. **Tests check existence before running** — SAPSearch per object (~100ms each), recreate from fixtures if missing
3. **Write/transport tests create transient objects** — deleted in `afterAll`
4. **If cleanup failed last run** — next run's `beforeAll` detects and recreates

### Teardown

```
afterAll:
  1. Delete transient objects (ZARC1_E2E_WRITE) via SAPWrite delete — swallow errors
  2. Log transport request IDs created during run (don't release — leave for inspection)
  3. Disconnect MCP client
```

### Stale State Handling

| Situation | Detection | Action |
|-----------|-----------|--------|
| Object missing | SAPSearch returns empty | Recreate from fixture |
| Object locked by previous run | SAPWrite fails with lock error | Log warning, skip write tests |
| Transport left over | SAPTransport list shows old E2E transports | Ignore (use unique timestamps) |
| MCP server still running | Port 3000 occupied | `pkill` in deploy script before starting |

---

## Tool Coverage Matrix

### 1. SAPRead (18 type variants)

| # | Type | Test Object | Source | Notes |
|---|------|-------------|--------|-------|
| 1 | `PROG` | `RSHOWTIM` | Standard | Always present |
| 2 | `PROG` | `ZARC1_TEST_REPORT` | Fixture | Assert fixture content |
| 3 | `CLAS` (no include) | `CL_ABAP_CHAR_UTILITIES` | Standard | Full class source |
| 4 | `CLAS` (no include) | `/DMO/CL_FLIGHT_AMDP` | Standard | Has local defs/impls |
| 5 | `CLAS` (no include) | `ZCL_ARC1_TEST` | Fixture | Verify interface impl |
| 6 | `CLAS` + `include=definitions` | `/DMO/CL_FLIGHT_AMDP` | Standard | Local type definitions |
| 7 | `CLAS` + `include=implementations` | `/DMO/CL_FLIGHT_AMDP` | Standard | Local helpers |
| 8 | `CLAS` + `include=testclasses` | `ZCL_ARC1_TEST_UT` | Fixture | Should have test class |
| 9 | `CLAS` + `include=testclasses` | `/DMO/CL_FLIGHT_AMDP` | Standard | Graceful if empty |
| 10 | `CLAS` + `include=definitions,implementations` | `/DMO/CL_FLIGHT_AMDP` | Standard | Multi-include |
| 11 | `INTF` | `IF_SERIALIZABLE_OBJECT` | Standard | Standard interface |
| 12 | `INTF` | `ZIF_ARC1_TEST` | Fixture | Assert fixture content |
| 13 | `FUNC` | `FUNCTION_EXISTS` + `group` | Standard | Discover group first |
| 14 | `FUGR` | (discovered) | Standard | Function group metadata |
| 15 | `INCL` | (discovered) | Standard | Standard include |
| 16 | `DDLS` | `/DMO/FLIGHT` | Standard | CDS view (if available) |
| 17 | `BDEF` | `/DMO/R_FLIGHT` | Standard | RAP (if available) |
| 18 | `SRVD` | `/DMO/UI_FLIGHT` | Standard | Service def (if available) |
| 19 | `TABL` | `T000` | Standard | Table structure |
| 20 | `VIEW` | (discovered) | Standard | Standard view |
| 21 | `TABLE_CONTENTS` | `T000` | Standard | Basic read |
| 22 | `TABLE_CONTENTS` + `sqlFilter` | `T000` + `MANDT = '001'` | Standard | Filtered |
| 23 | `TABLE_CONTENTS` + `maxRows=1` | `T000` | Standard | Row limit |
| 24 | `DEVC` | `$TMP` | Standard | Local objects package |
| 25 | `DEVC` | `/DMO/FLIGHT` | Standard | Demo package |
| 26 | `SYSTEM` | — | Standard | System info |
| 27 | `COMPONENTS` | — | Standard | Installed components |
| 28 | `MESSAGES` | (discovered) | Standard | Message class |
| 29 | `TEXT_ELEMENTS` | `RSHOWTIM` | Standard | Text elements |
| 30 | `VARIANTS` | `RSHOWTIM` | Standard | Report variants |

**SAPRead Error Cases:**

| # | Scenario | Expected |
|---|----------|----------|
| E1 | Non-existent program | 404 + "Use SAPSearch" hint |
| E2 | Non-existent class | 404 + hint |
| E3 | Invalid type `FOOBAR` | "Unknown SAPRead type" |
| E4 | Missing name | Error or empty |
| E5 | FUNC without group | Error about missing group |
| E6 | Non-existent TABLE_CONTENTS | SAP error |

### 2. SAPSearch

| # | Scenario | Arguments | Key Assertion |
|---|----------|-----------|---------------|
| 1 | Standard class | `query: "CL_ABAP_*"` | Results array, objectName matches pattern |
| 2 | Custom objects | `query: "ZARC1_*"` | Finds our fixture objects |
| 3 | DMO demo | `query: "/DMO/*"` | DMO objects |
| 4 | Exact match | `query: "RSHOWTIM"` | Single result |
| 5 | maxResults | `query: "CL_*", maxResults: 3` | At most 3 |
| 6 | Middle wildcard | `query: "CL_ABAP_*UTILITIES"` | Matches |
| E1 | No results | `query: "ZZZNONEXISTENT999*"` | Empty array, no error |
| E2 | Empty query | `query: ""` | Empty or SAP rejection |

### 3. SAPWrite (Lifecycle)

Tests use transient object `ZARC1_E2E_WRITE`:

| # | Step | Tool Call | Key Assertion |
|---|------|-----------|---------------|
| 1 | Create | `SAPWrite create PROG` | Success message |
| 2 | Read back | `SAPRead PROG` | Source matches fixture |
| 3 | Update | `SAPWrite update PROG` | Success message |
| 4 | Read back | `SAPRead PROG` | Source matches updated content |
| 5 | Activate | `SAPActivate PROG` | Activation success |
| 6 | Delete | `SAPWrite delete PROG` | Success message |
| 7 | Verify gone | `SAPSearch` | Not found |

**Error Cases:**

| # | Scenario | Expected |
|---|----------|----------|
| E1 | Update non-existent | 404 / lock failure |
| E2 | Delete non-existent | 404 / lock failure |
| E3 | Create duplicate | Already exists error |
| E4 | Invalid action `foobar` | "Unknown SAPWrite action" |
| E5 | Empty source on update | SAP error |

### 4. SAPActivate

| # | Scenario | Key Assertion |
|---|----------|---------------|
| 1 | Activate after create | Success message |
| 2 | Activate existing | Success (idempotent) |
| 3 | Activate class | Success |
| 4 | Activate interface | Success |
| E1 | Non-existent object | 404 |
| E2 | Bad source → activate | Activation errors list (not raw XML) |

### 5. SAPNavigate

| # | Action | Strategy | Key Assertion |
|---|--------|----------|---------------|
| 1 | `definition` | Read ZCL_ARC1_TEST, find line/col of `zif_arc1_test` | JSON with URI pointing to interface |
| 2 | `references` | URI of ZIF_ARC1_TEST | Array containing ZCL_ARC1_TEST |
| 3 | `completion` | URI + partial text in method body | Array of proposals |
| 4 | `definition` (standard) | URI of CL_ABAP_CHAR_UTILITIES | Navigate within standard |
| E1 | Invalid URI | Graceful error |
| E2 | Invalid action | "Unknown SAPNavigate action" |
| E3 | Out-of-range line/col | Empty result, no crash |

### 6. SAPQuery

| # | SQL | Key Assertion |
|---|-----|---------------|
| 1 | `SELECT * FROM T000` | `columns` array, `rows` array |
| 2 | `SELECT * FROM T000` maxRows=1 | rows.length >= 1 |
| 3 | `SELECT MANDT, MTEXT FROM T000` | columns = ["MANDT", "MTEXT"] |
| 4 | `WHERE MANDT = '001'` | Filtered results |
| 5 | `SELECT COUNT(*) FROM T000` | Aggregate |
| 6 | Alias syntax | Valid SQL with alias |
| E1 | Non-existent table | SAP SQL error |
| E2 | SQL syntax error | Parse error |
| E3 | Empty SQL | Error |

### 7. SAPLint

| # | Input | Key Assertion |
|---|-------|---------------|
| 1 | Clean source | No issues or minor |
| 2 | Source with unused var | Issue flagged |
| 3 | Empty source | Graceful handling |
| 4 | Source + name param | Filename detection |
| E1 | Invalid action `foobar` | "Unknown SAPLint action" |
| E2 | Unsupported action `atc` | "Unknown SAPLint action" (handler only supports lint) |

### 8. SAPDiagnose

| # | Action | Object | Key Assertion |
|---|--------|--------|---------------|
| 1 | `syntax` | `ZARC1_TEST_REPORT` | Clean or structured result |
| 2 | `syntax` | `RSHOWTIM` | Standard program |
| 3 | `syntax` | `ZCL_ARC1_TEST` | Class syntax check |
| 4 | `unittest` | `ZCL_ARC1_TEST_UT` | test count >= 1, pass >= 1 |
| 5 | `atc` | `ZARC1_TEST_REPORT` | ATC result (may have findings) |
| 6 | `atc` + variant | explicit variant | ATC with variant |
| E1 | Non-existent | 404 + hint |
| E2 | Invalid action | "Unknown SAPDiagnose action" |
| E3 | unittest no tests | Empty results or error |

### 9. SAPTransport (Lifecycle)

| # | Step | Key Assertion |
|---|------|---------------|
| 1 | `list` | Array of transports |
| 2 | `list` user=DEVELOPER | Filtered results |
| 3 | `create` desc="ARC1-E2E-{ts}" | Transport ID matches `A4HK\d{6}` |
| 4 | `get` id from step 3 | Details with description |
| 5 | `release` id from step 3 | Success message |
| 6 | `get` after release | Shows released status |
| E1 | Get non-existent | Not found |
| E2 | Release already released | Already released error |
| E3 | Create without description | "Description is required" |
| E4 | Get without ID | "Transport ID is required" |

### 10. SAPContext

| # | Scenario | Key Assertion |
|---|----------|---------------|
| 1 | `ZCL_ARC1_TEST` | Output contains `ZIF_ARC1_TEST` as dep |
| 2 | `ZIF_ARC1_TEST` | Interface deps |
| 3 | `/DMO/CL_FLIGHT_AMDP` | Multiple deps, SAP standard filtered |
| 4 | `RSHOWTIM` | Few custom deps |
| 5 | Source provided inline | Skips fetch, parses provided source |
| 6 | FUNC + group | Function module deps |
| 7 | maxDeps=2 | At most 2 deps resolved |
| 8 | depth=2 | Transitive deps |
| 9 | depth=3 | Deep traversal |
| E1 | Non-existent | 404 |
| E2 | FUNC without group | "group parameter is required" |
| E3 | Unsupported type TABL | "SAPContext supports types..." |
| E4 | Missing type | Error |
| E5 | Missing name | "Both type and name are required" |

### 11. SAPManage

| # | Action | Key Assertion |
|---|--------|---------------|
| 1 | `features` (cold) | "No features probed yet" message |
| 2 | `probe` | JSON with 6 features, each has `id`/`available`/`mode` |
| 3 | `features` (warm) | Cached status with `probedAt` |
| 4 | `probe` again | Idempotent, updated `probedAt` |
| E1 | Invalid action | "Unknown SAPManage action" |

---

## Elicitation Testing

The elicitation system (`src/server/elicit.ts`) provides `confirmDestructive()`, `selectOption()`, `promptString()` but **no handler invokes them yet**. The `_server` param in `handleToolCall` is accepted but unused.

### Current State: Test Graceful Fallback

```typescript
// Client WITHOUT elicitation capability — all tools must work normally
const client = new Client({ name: "e2e-test", version: "1.0.0" });
// No capabilities.elicitation declared → fallback path

// SAPWrite delete should proceed without asking
const result = await callTool("SAPWrite", { action: "delete", type: "PROG", name: "..." });
expect(result.isError).toBeUndefined(); // works without elicitation
```

### Future: When Elicitation is Wired into Handlers

| Tool | Action | Elicitation | Client Response | Expected |
|------|--------|-------------|-----------------|----------|
| SAPWrite | delete | `confirmDestructive` | accept | Object deleted |
| SAPWrite | delete | `confirmDestructive` | decline | NOT deleted, graceful message |
| SAPTransport | release | `confirmDestructive` | accept | Released |
| SAPTransport | release | `confirmDestructive` | decline | NOT released |
| Any tool | — | Client without capability | (n/a) | Works normally (fallback) |

---

## Expected Error Response Format

### Error Validation Pattern

Every error response must be:

```typescript
expect(result.isError).toBe(true);
expect(result.content[0].type).toBe("text");
expect(result.content[0].text).toBeTruthy();
expect(result.content[0].text).not.toContain("<?xml");         // no raw XML
expect(result.content[0].text).not.toContain("at Object.");    // no stack traces
expect(result.content[0].text).not.toContain(".ts:");           // no TS file refs
```

### Error Categories

| Error Source | Example | Expected in Message |
|---|---|---|
| 404 Not Found | Read non-existent | "not found" + "Use SAPSearch" hint |
| 403 Forbidden | No authorization | "Authorization error" hint |
| Safety Block | Write in read-only mode | AdtSafetyError message |
| Invalid Arguments | Unknown type | "Unknown SAPRead type: FOOBAR" + supported list |
| SAP XML Error | SQL syntax error | Parsed error (not raw XML) |
| Lock Conflict | Object locked | Lock conflict info |

---

## Research Needed (Run on Live System First)

| # | What | How | Fills In |
|---|------|-----|----------|
| 1 | DMO objects | `SAPSearch query: "/DMO/*"` | DDLS, BDEF, SRVD, DEVC rows |
| 2 | Standard includes | `SAPSearch query: "LSUNI*"` | INCL row |
| 3 | Standard views | `SAPSearch query: "V_T000*"` | VIEW row |
| 4 | Message classes | `SAPSearch query: "00"` | MESSAGES row |
| 5 | Text elements | `SAPRead TEXT_ELEMENTS RSHOWTIM` | TEXT_ELEMENTS row |
| 6 | Variants | `SAPRead VARIANTS RSHOWTIM` | VARIANTS row |
| 7 | ATC variants | `SAPDiagnose atc` with no variant | atc+variant row |
| 8 | FUNCTION_EXISTS group | `SAPSearch query: "FUNCTION_EXISTS"` | FUNC row |
| 9 | Feature availability | `SAPManage probe` | DDLS/BDEF/SRVD availability |
| 10 | Unit test candidates | `SAPRead CLAS /DMO/CL_FLIGHT_AMDP include=testclasses` | unittest row |

---

## Test File Structure

```
tests/
├── e2e/
│   ├── README.md                  # Prerequisites, setup, running, troubleshooting
│   ├── vitest.e2e.config.ts       # 60s timeout, sequential, JUnit reporter
│   ├── helpers.ts                 # MCP client factory, callTool wrapper, expectToolError
│   ├── fixtures.ts                # Load ABAP from tests/fixtures/abap/
│   ├── setup.ts                   # Check objects exist → create from fixtures if missing
│   ├── teardown.ts                # Delete transient objects, log transport IDs
│   │
│   ├── sapread.e2e.test.ts        # 30 variants + 6 errors
│   ├── sapsearch.e2e.test.ts      # 6 variants + 2 errors
│   ├── sapwrite.e2e.test.ts       # 7-step lifecycle + 5 errors
│   ├── sapactivate.e2e.test.ts    # 4 tests + 2 errors
│   ├── sapnavigate.e2e.test.ts    # 4 tests + 3 errors
│   ├── sapquery.e2e.test.ts       # 6 variants + 3 errors
│   ├── saplint.e2e.test.ts        # 4 tests + 2 errors
│   ├── sapdiagnose.e2e.test.ts    # 6 tests + 3 errors
│   ├── saptransport.e2e.test.ts   # 6-step lifecycle + 4 errors
│   ├── sapcontext.e2e.test.ts     # 9 variants + 5 errors
│   ├── sapmanage.e2e.test.ts      # 4 tests + 1 error
│   └── elicitation.e2e.test.ts    # Fallback + future wired tests
│
├── fixtures/
│   ├── abap/                      # ABAP source fixtures
│   │   ├── zarc1_test_report.abap
│   │   ├── zcl_arc1_test.clas.abap
│   │   ├── zcl_arc1_test_ut.clas.abap
│   │   ├── zcl_arc1_test_ut.clas.testclasses.abap
│   │   ├── zif_arc1_test.intf.abap
│   │   └── zarc1_e2e_write.abap
│   └── xml/                       # Existing XML fixtures (unchanged)
│
scripts/
├── e2e-deploy.sh                  # Pre-flight checks, rsync, flock, start server
└── e2e-stop.sh                    # Collect logs, stop server, release lock

# Generated at runtime (gitignored):
/tmp/arc1-e2e-logs/                # Default E2E_LOG_DIR
├── mcp-server.log                 # MCP server stderr (copied from server)
└── junit-results.xml              # Vitest JUnit output
```

---

## Documentation (tests/e2e/README.md)

### Contents

1. **Prerequisites**
   - SAP system running on $E2E_SERVER (check: `curl http://$E2E_SERVER:50000/sap/public/ping`)
   - Node.js 20+
   - SSH access to server (for deploy script)

2. **Quick Start**
   ```bash
   npm run build
   npm run test:e2e:deploy      # deploys dist/ to server, starts MCP
   npm run test:e2e              # runs all E2E tests
   # Or all-in-one:
   npm run test:e2e:full
   ```

3. **Environment Variables**
   - `E2E_MCP_URL` — MCP server URL (default: `http://localhost:3000/mcp`)
   - `E2E_SKIP_SETUP` — skip object existence check (default: false)
   - `E2E_SKIP_TEARDOWN` — skip cleanup (default: false)

4. **Test Object Inventory** — table of persistent objects on SAP

5. **Adding New Tests** — where to add fixtures, assertion patterns

6. **Troubleshooting**

   | Symptom | Where To Look | Fix |
   |---------|---------------|-----|
   | Deploy fails: "Cannot SSH" | Terminal output | Check SSH key, server reachable |
   | Deploy fails: "SAP not reachable" | Terminal output | `ssh $E2E_SERVER_USER@$E2E_SERVER 'docker start a4h'` |
   | Deploy fails: "Could not acquire lock" | Terminal output (shows who holds lock) | Wait, or `npm run test:e2e:stop` to force |
   | Server won't start | Terminal output (shows last 50 log lines) | Check SAP_PASSWORD, port conflict |
   | Test fails: tool returned error | Vitest output (shows tool call + response) | Check `$E2E_LOG_DIR/mcp-server.log` for server-side error |
   | Test fails: assertion mismatch | Vitest output (expected vs actual) | Object may have changed on SAP, update assertion |
   | Test fails: timeout | Vitest output | SAP may be slow/overloaded, increase timeout |
   | Multiple errors, unclear cause | `$E2E_LOG_DIR/mcp-server.log` | Search for `"level":"error"` entries, correlate with requestId |
   | GH Actions failed | Artifacts tab → download `e2e-logs.zip` | Contains mcp-server.log + junit-results.xml |
   | Objects locked on SAP | Vitest output: "lock" in error message | Previous run crashed — wait 15min or restart SAP |

7. **Reading the Logs**
   ```bash
   # After a test run, logs are at:
   ls /tmp/arc1-e2e-logs/

   # View server errors only:
   grep '"level":"error"' /tmp/arc1-e2e-logs/mcp-server.log

   # View all tool calls with timing:
   grep '"event":"tool_call_end"' /tmp/arc1-e2e-logs/mcp-server.log | \
     jq '{tool, status, durationMs, errorMessage}'

   # Find a specific failed tool call:
   grep 'SAPRead.*DDLS' /tmp/arc1-e2e-logs/mcp-server.log
   ```

8. **Manual Cleanup**
   ```bash
   # Delete all E2E test objects
   # (via SAPWrite delete or SE80/ADT in Eclipse)
   ```

---

## Total Test Count

| Tool | Happy Path | Error Cases | Total |
|------|-----------|-------------|-------|
| SAPRead | 30 | 6 | 36 |
| SAPSearch | 6 | 2 | 8 |
| SAPWrite | 7 | 5 | 12 |
| SAPActivate | 4 | 2 | 6 |
| SAPNavigate | 4 | 3 | 7 |
| SAPQuery | 6 | 3 | 9 |
| SAPLint | 4 | 2 | 6 |
| SAPDiagnose | 6 | 3 | 9 |
| SAPTransport | 6 | 4 | 10 |
| SAPContext | 9 | 5 | 14 |
| SAPManage | 4 | 1 | 5 |
| Elicitation | 2 | 4 | 6 |
| **Total** | **88** | **40** | **~128** |

### Estimated Runtime

| Phase | Tests | Duration |
|-------|-------|----------|
| Setup (check objects) | — | ~0.5s (all exist) / ~10s (recreate) |
| Read-only tests | ~70 | ~30-60s |
| Write/activate lifecycle | ~20 | ~20-30s |
| Transport lifecycle | ~10 | ~15-20s |
| Error + elicitation | ~28 | ~15-20s |
| **Total** | **~128** | **~2-3 min** |
