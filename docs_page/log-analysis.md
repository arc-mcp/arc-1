# ARC-1 Log Analysis Guide

## Enabling File Logging

Set the `ARC1_LOG_FILE` environment variable to enable JSON line audit logging:

```bash
# Local development
ARC1_LOG_FILE=/tmp/arc1-audit.jsonl npm run dev

# Docker
docker run -v /data/logs:/logs -e ARC1_LOG_FILE=/logs/arc1-audit.jsonl ghcr.io/arc-mcp/arc-1

# BTP Cloud Foundry (in manifest.yml)
env:
  ARC1_LOG_FILE: /tmp/arc1-audit.jsonl
```

On BTP Cloud Foundry, ARC-1's stderr logs are always available via `cf logs arc1-mcp-server`
(live) and `cf logs arc1-mcp-server --recent` (buffer) — no service binding required. The
deprecated Application Logging Service (Kibana) is **off by default** (SAP Note 3557260); see
[BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) to opt back in, or use **SAP Cloud
Logging** for a managed observability stack.

## Log Levels

Control stderr verbosity with `ARC1_LOG_LEVEL`:

```bash
ARC1_LOG_LEVEL=debug  # Show everything (HTTP requests, CSRF fetches)
ARC1_LOG_LEVEL=info   # Default — tool calls, auth events
ARC1_LOG_LEVEL=warn   # Only warnings and errors
ARC1_LOG_LEVEL=error  # Only errors
```

The file sink always receives ALL events regardless of stderr level.

## Event Types

| Event | Level | Description |
|-------|-------|-------------|
| `tool_call_start` | info | MCP tool call received |
| `tool_call_end` | info/error | Tool call completed (with status, duration, error details) |
| `http_request` | debug/warn | HTTP request to SAP ADT |
| `http_csrf_fetch` | debug | CSRF token fetch |
| `auth_scope_denied` | warn | Tool blocked by insufficient auth scope |
| `auth_pp_created` | info/error | Per-user ADT client created via principal propagation |
| `safety_blocked` | warn | Operation blocked by safety system |
| `server_start` | info | ARC-1 server started |
| `elicitation_sent` | info | Elicitation prompt sent to client |
| `elicitation_response` | info | User response to elicitation |

## What a Healthy Startup Looks Like

After you deploy (or run locally), the **startup transcript is the fastest way to confirm SAP
connectivity and authorization are working** — before you ever make a tool call. On BTP Cloud Foundry,
read it with `cf logs arc1-mcp-server --recent` (or the **Logs** tab of the app in the BTP Cockpit).

A healthy startup at the default `info` level looks like this (real output, S/4HANA 2023 / ABAP
Platform 2025):

```
INFO: [server_start] {"version":"0.9.x","transport":"stdio","allowWrites":...,"url":"http://your-sap:50000"}
INFO: ARC-1 starting {"version":"0.9.x","transport":"...","url":"..."}
INFO: SAP semaphore {"maxConcurrent":10,"scope":"server-wide"}
INFO: Object cache enabled {"mode":"auto",...}
INFO: ARC-1 MCP server running on stdio          # (or: "ARC-1 HTTP server started" on BTP)
INFO: Startup auth preflight succeeded for shared SAP credentials. {"endpoint":"/sap/bc/adt/core/discovery"}
INFO: Authorization probe: object search access is available
INFO: Authorization probe: transport access is available
```

### The two green-light signals

```
INFO: Authorization probe: object search access is available
INFO: Authorization probe: transport access is available
```

**These two lines mean your SAP authorizations are correct.** If you see them, ARC-1 reached SAP,
authenticated, and the SAP user can search the repository and read transports — the foundation every
tool call builds on. (Under principal propagation the preflight is skipped — each user authenticates at
runtime — so you'll instead see `Skipped startup auth preflight: principal propagation mode is enabled`;
the per-user authorization probe then runs on that user's first call.)

If instead you see either of:

```
WARN: Authorization probe: object search access denied — <reason>
INFO: Authorization probe: transport access is not available — <reason>
```

…the SAP **user** is missing an authorization (not an ARC-1 bug). Search/read needs `S_DEVELOP` and
`S_ADT_RES` (read-only users need `S_ADT_RES` with `ACTVT = 01 AND 02` — several ADT reads are POSTs).
See [Authorization](authorization.md) and [Principal Propagation](principal-propagation-setup.md).

### "Feature not available" is normal, not an error

ARC-1 probes optional capabilities at startup (abapGit, AMDP, RAP/CDS, UI5, HANA info, source search,
…). Any capability your system doesn't have simply returns `404` (not installed / ICF service not
active) or `400` — **this is expected and is recorded as data, not an error.** These probe misses are
logged at `debug`, so they do **not** appear at the default `info` level. A clean startup has **no
`WARN` lines** from probing.

If you run with `ARC1_LOG_LEVEL=debug`, you'll see them — and they're still harmless:

```
DEBUG: [http_request] {"method":"GET","path":"/sap/bc/adt/abapgit/repos","statusCode":404,...}
DEBUG: [http_request] {"method":"GET","path":"/sap/bc/adt/debugger/amdp","statusCode":404,...}
DEBUG: [http_request] {"method":"GET","path":"/sap/bc/adt/ddic/ddl/sources","statusCode":400,...}
```

These just mean abapGit/AMDP aren't installed and the RAP probe returned its expected `400` — ARC-1
disables those features gracefully and serves the rest. The resolved feature set is what matters, not
the individual probe responses.

> A genuine problem looks different: a `WARN`/`error` `auth_scope_denied`, a `401` on the auth
> preflight, an `Authorization probe: … denied` line, or `Startup auth preflight failed` — those are
> worth investigating; a `404` probe miss at `debug` is not.

### OAuth scope errors on the MCP client (not SAP)

A different failure class: the MCP client (Claude, Copilot, …) can't complete OAuth and reports an
`invalid_scope` / scope error even though your user has the right role collection. This is almost always
a **stale cache**, not a missing authorization:

- Log out of the MCP client's OAuth session and reconnect — or use a fresh/incognito browser window for
  the consent step. A previous deployment's XSUAA/DCR client registration is often cached.
- Verify the role collection is assigned under the **correct identity provider**. If your subaccount
  uses a custom IdP (e.g. SAP IAS), assign the role collection to the user *under that IdP*
  (`--of-idp <your-idp>`), not the default SAP ID service — otherwise the JWT carries no ARC-1 scopes.
- After a redeploy that recreated the XSUAA service, give the client one clean re-login; cached
  `client_id`s from the old service instance produce scope errors until they re-register.

## Analyzing Logs with jq

### Recent Errors

```bash
# All errors in the last hour
jq 'select(.level == "error")' arc1-audit.jsonl

# Failed tool calls with error details
jq 'select(.event == "tool_call_end" and .status == "error")' arc1-audit.jsonl

# Failed tool calls grouped by error class
jq -s '[.[] | select(.event == "tool_call_end" and .status == "error")] | group_by(.errorClass) | map({errorClass: .[0].errorClass, count: length})' arc1-audit.jsonl
```

### Bad/Wrong Tool Calls (for improving LLM feedback)

```bash
# Tool calls that returned client-visible handler errors (unknown tool/action, validation, etc.)
jq 'select(.event == "tool_call_end" and .status == "error" and .errorClass == "result-path")' arc1-audit.jsonl

# Tool calls blocked by safety (LLM tried a blocked operation)
jq 'select(.event == "tool_call_end" and .errorClass == "AdtSafetyError")' arc1-audit.jsonl

# Auth scope denials (LLM called a tool the user can't access)
jq 'select(.event == "auth_scope_denied")' arc1-audit.jsonl

# Error counts by class — errorMessage content is redacted before sink writes
jq -s '[.[] | select(.event == "tool_call_end" and .status == "error") | .errorClass] | group_by(.) | map({errorClass: .[0], count: length}) | sort_by(-.count)' arc1-audit.jsonl
```

### Slow Operations

```bash
# Tool calls taking >5 seconds
jq 'select(.event == "tool_call_end" and .durationMs > 5000)' arc1-audit.jsonl

# HTTP requests taking >10 seconds
jq 'select(.event == "http_request" and .durationMs > 10000)' arc1-audit.jsonl

# Average duration by tool
jq -s '[.[] | select(.event == "tool_call_end")] | group_by(.tool) | map({tool: .[0].tool, avgMs: (map(.durationMs) | add / length | round), count: length})' arc1-audit.jsonl
```

### Correlating Events by Request ID

Every tool call generates a unique `requestId` (e.g., `REQ-42`). All HTTP requests made during that tool call share the same ID:

```bash
# Trace a specific tool call through all its HTTP requests
jq 'select(.requestId == "REQ-42")' arc1-audit.jsonl

# Find tool calls that made many HTTP requests (potential performance issue)
jq -s '[.[] | select(.event == "http_request")] | group_by(.requestId) | map({requestId: .[0].requestId, httpCalls: length}) | sort_by(-.httpCalls) | .[:10]' arc1-audit.jsonl
```

### HTTP-Level Analysis

```bash
# Failed HTTP requests (4xx/5xx)
jq 'select(.event == "http_request" and .statusCode >= 400)' arc1-audit.jsonl

# HTTP requests with redacted error-body placeholders
jq 'select(.event == "http_request" and .errorBody != null)' arc1-audit.jsonl

# Most common ADT paths called
jq -s '[.[] | select(.event == "http_request") | .path] | group_by(.) | map({path: .[0], count: length}) | sort_by(-.count) | .[:10]' arc1-audit.jsonl
```

### User Activity

```bash
# Tool calls per user
jq -s '[.[] | select(.event == "tool_call_start" and .user != null)] | group_by(.user) | map({user: .[0].user, calls: length})' arc1-audit.jsonl

# What tools a specific user called
jq 'select(.event == "tool_call_start" and .user == "john.doe@company.com")' arc1-audit.jsonl
```

## BTP Audit Log Service

When deployed on BTP with the Audit Log Service premium plan bound, ARC-1 automatically sends audit events to the BTP Audit Log Viewer. Events are categorized as:

- **security-events**: auth failures, scope denials, safety blocks
- **data-accesses**: tool calls that read SAP data (SAPRead, SAPSearch, SAPQuery)
- **data-modifications**: tool calls that write data (SAPWrite, SAPManage)
- **configuration-changes**: transport and activation operations (SAPTransport, SAPActivate)

View these in the BTP cockpit under **Instances and Subscriptions > Audit Log Viewer**.

## Docker Volume Mount Example

```bash
# Run with persistent log file
docker run -d \
  -v /data/arc1-logs:/logs \
  -e ARC1_LOG_FILE=/logs/audit.jsonl \
  -e SAP_URL=http://sap:50000 \
  -e SAP_USER=admin \
  -e SAP_PASSWORD=secret \
  ghcr.io/arc-mcp/arc-1

# Tail logs in real-time
tail -f /data/arc1-logs/audit.jsonl | jq .

# Watch for errors only
tail -f /data/arc1-logs/audit.jsonl | jq 'select(.level == "error")'
```
