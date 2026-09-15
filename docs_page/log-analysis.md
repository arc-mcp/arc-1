# Log analysis

<a id="arc-1-log-analysis-guide"></a>

Find the failed tool call, trace its `requestId`, then check whether auth, policy or SAP failed. The examples below read JSON-line audit files with `jq`.

## Enabling File Logging

Stderr audit logging is always available. On BTP, use `cf logs arc1-mcp-server --recent` or live `cf logs arc1-mcp-server`.
To retain JSON lines locally, set:

```bash
ARC1_LOG_FILE="$PWD/arc1-audit.jsonl" arc1
```

The service user needs write access. Rotate the file and retain it according to your operational policy.
In containers, mount a persistent log volume; a CF container's local filesystem is temporary.

## Log Levels

Control the stderr **audit sink** with `ARC1_LOG_LEVEL`:

```bash
ARC1_LOG_LEVEL=debug  # Include HTTP/CSRF audit events
ARC1_LOG_LEVEL=info   # Default — tool calls, auth events
ARC1_LOG_LEVEL=warn   # Only warnings and errors
ARC1_LOG_LEVEL=error  # Only errors
```

The audit file receives all event levels. Ordinary server messages use a separate logger: set `SAP_VERBOSE=true` to include its debug messages, such as PP diagnostics. This also sets the audit level to `debug`. Neither setting makes the audit file capture ordinary server messages.

## Event Types

The exact event inventory and field contract is maintained in
[audit event reference](#audit-event-reference). Important operator groups
include:

| Group | Events |
|-------|--------|
| Tool and SAP HTTP lifecycle | `tool_call_start`, `tool_call_end`, `http_request`, `http_csrf_fetch` |
| Authorization and safety | `auth_scope_denied`, `safety_blocked`, `data_source_policy_decision`, `data_response_limited`, `auth_rate_limited`, `mcp_rate_limited` |
| Selected identity | `auth_pp_created`, `auth_shared_created` |
| Multi-target failure stage | `target_resolution_failed`, `pp_exchange_failed`, `shared_auth_failed`, `cloud_connector_access_denied`, `sap_service_unavailable`, `sap_authentication_failed`, `sap_authorization_failed`, `target_policy_denied` |
| Server/client protocol | `server_start`, OAuth/DCR, and CORS events |

Within a selected multi-target call, use `requestId` to correlate events and `target`, `destination`,
and `identity` to identify the selected route and identity model. Failure-stage events also carry a
safe `errorCode`; they do not contain destination credentials or SAP response bodies.

## What a Healthy Startup Looks Like

Read the startup auth and safety summaries first. They show configured identity modes and server policy.
`/health` confirms the process is running; it does not prove that a user can reach SAP.

### The two green-light signals

```text
Authorization probe: object search access is available
Authorization probe: transport access is available
```

These confirm search and transport-read access for the identity that was probed. They do not prove
all SAP permissions. In PP mode, shared startup preflight is skipped; verify the user's first safe read and the SAP-side identity.

An access-denied probe needs investigation with the SAP owner. An unavailable endpoint may instead
mean that the feature is not supported or its service is inactive.

### "Feature not available" is normal, not an error

Optional probes can return `404` or an expected `400`. Check the resolved feature result before treating
an individual probe response as an incident. Debug logs include these probes; default logs reduce their noise.

### OAuth scope errors on the MCP client (not SAP)

`invalid_scope` can mean an unknown scope, a missing role, a wrong IdP identity or stale token state.
Use [XSUAA scope diagnosis](xsuaa-setup.md#insufficient-scope-invalid_scope) before clearing caches or changing roles.

## Analyzing Logs with jq

### Recent Errors

```bash
# All error-level records in the file
jq 'select(.level == "error")' arc1-audit.jsonl

# Failed tool calls with error details
jq 'select(.event == "tool_call_end" and .status == "error")' arc1-audit.jsonl

# Failed tool calls grouped by error class
jq -s '[.[] | select(.event == "tool_call_end" and .status == "error")] | group_by(.errorClass) | map({errorClass: .[0].errorClass, count: length})' arc1-audit.jsonl
```

### Multi-Target Failures

```bash
# Every selected-target failure stage
jq 'select(.event as $e | ["target_resolution_failed", "pp_exchange_failed", "shared_auth_failed", "cloud_connector_access_denied", "sap_service_unavailable", "sap_authentication_failed", "sap_authorization_failed", "target_policy_denied"] | index($e))' arc1-audit.jsonl

# One public target across identity, policy, and SAP failure stages
jq 'select(.target == "A4H/100" and .errorCode? != null)' arc1-audit.jsonl

# Failure counts by safe error code
jq -s '[.[] | select(.errorCode? != null) | .errorCode] | group_by(.) | map({errorCode: .[0], count: length}) | sort_by(-.count)' arc1-audit.jsonl

# Successful shared-identity canaries, grouped by destination
jq -s '[.[] | select(.event == "auth_shared_created")] | group_by(.destination) | map({destination: .[0].destination, successes: length})' arc1-audit.jsonl
```

`target` is the public SID/client or alias/client ID, while `destination` is the internal BTP
destination name. `identity` distinguishes `per-user` Principal Propagation from a `shared` Basic
technical user. Correlate the failure-stage event with the same `requestId`'s `tool_call_end`; do not
expect raw SAP response bodies in these events.

### Data-source policy decisions

```bash
# Correlate a blocked-data error with its policy decision
jq 'select(.event == "data_source_policy_decision" and .decisionId == "REPLACE_WITH_DECISION_ID")' arc1-audit.jsonl
```

The record identifies direct roots, matched source/path, allow/deny reason and metadata work. It contains no SQL text, literals or result rows. See the [blocklist boundary](authorization.md#experimental-data-source-blocklist).

### Invalid or denied tool calls

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

# Non-authentication failures for which a redacted error-body placeholder was retained
jq 'select(.event == "http_request" and .errorBody != null)' arc1-audit.jsonl

# Most common ADT paths called
jq -s '[.[] | select(.event == "http_request") | .path] | group_by(.) | map({path: .[0], count: length}) | sort_by(-.count) | .[:10]' arc1-audit.jsonl
```

The `errorBody` query deliberately excludes SAP HTTP 401 and 403 responses. Those bodies can expose
technical usernames, echoed login material, or SAP security details, so ARC-1 omits them even when
`ARC1_LOG_HTTP_DEBUG=true`. Use the status code, selected-target failure event, `errorCode`, and
`requestId` instead. Other error bodies are replaced with a length-only redacted placeholder before
sink writes; their content is never present in the audit file.

### User Activity

```bash
# Tool calls per user
jq -s '[.[] | select(.event == "tool_call_start" and .user != null)] | group_by(.user) | map({user: .[0].user, calls: length})' arc1-audit.jsonl

# What tools a specific user called
jq 'select(.event == "tool_call_start" and .user == "john.doe@company.com")' arc1-audit.jsonl
```

## BTP Audit Log Service

When deployed on BTP with the Audit Log Service premium plan bound, ARC-1 automatically forwards
categorized security and tool-call events to the BTP Audit Log Viewer. Low-level HTTP, startup, OAuth/CORS events, HTTP rate-limit events and `data_source_policy_decision` remain in stderr/file logs. Forwarded events are categorized as:

- **security-events**: auth/target/service failures, scope denials, safety blocks, shared-identity use
- **data-accesses**: tool calls other than the four tool families below
- **data-modifications**: all SAPWrite and SAPManage calls
- **configuration-changes**: all SAPTransport and SAPActivate calls

Tool-call categories depend on the tool name, not its action; for example, a transport read is still categorized as a configuration change. Successful `auth_pp_created` events stay in stderr/file; failed ones are security events.

View these in the BTP cockpit under **Instances and Subscriptions > Audit Log Viewer**.

## Retain Cloud Foundry application logs

For searchable application logs beyond `cf logs --recent`, bind SAP Cloud Logging using its [Cloud Foundry ingestion procedure](https://help.sap.com/docs/cloud-logging/cloud-logging/ingest-via-cloud-foundry-runtime). Keep service bindings in the deployment descriptor.

SAP Application Logging Service (`application-logs`, Kibana) is deprecated; the optional resource in `mta.yaml` is inactive by default. Use [SAP Cloud Logging](https://help.sap.com/docs/cloud-logging) for a new deployment; see [SAP KBA 3557260](https://userapps.support.sap.com/sap/support/knowledge/en/3557260) for the retirement policy. Application logging and the categorized Audit Log Service above serve different purposes.

## Docker Volume Mount Example

Add these options to the [configured Docker deployment](docker.md):

```text
-v /data/arc1-logs:/logs -e ARC1_LOG_FILE=/logs/audit.jsonl
```

```bash
tail -f /data/arc1-logs/audit.jsonl | jq .
```

## Audit event reference

| Event | Description |
|-------|-------------|
| `tool_call_start` | Tool name and centrally redacted arguments. |
| `tool_call_end` | Tool, duration, success/error status, error class, and result size/preview after central redaction. |
| `http_request` | SAP HTTP method, ADT path, status, and duration. Optional debug bodies/headers are centrally redacted; authentication response bodies are never logged. |
| `data_source_policy_decision` | Exact-name blocklist decision: `decisionId`, allow/deny, `executed`, direct roots, optional matched source/path and failure code, policy fingerprint, metadata/graph counts, duration. No SQL, literals, rows or credentials. |
| `data_response_limited` | A successful or retry response crossed the configured data-preview byte ceiling. Includes tool, limit/observed bytes, endpoint family, queue wait, request ID, and selected target/identity when applicable; never SQL or response bodies. |
| `http_csrf_fetch` | CSRF-token fetch success and duration. |
| `auth_scope_denied` | Tool, required scope, and caller's available scopes when authorization rejects a call. |
| `auth_pp_created` | Success or failure while creating a per-user Principal Propagation ADT client. |
| `auth_shared_created` | Successful shared technical-user authentication after the Basic canary. Includes tool and `identity: "shared"`. |
| `target_resolution_failed` | Multi-target ID/registry resolution failed. Includes tool and safe `errorCode`. |
| `pp_exchange_failed` | Per-user destination/token exchange failed before the SAP call. Includes tool and safe `errorCode`. |
| `shared_auth_failed` | Shared Basic credential preparation or canary failed. Includes tool and safe `errorCode`. |
| `cloud_connector_access_denied` | Cloud Connector did not expose or allow the selected target. Includes tool and safe `errorCode`. |
| `sap_service_unavailable` | A required SAP/ICF service is inactive or unavailable. Includes tool and safe `errorCode`. |
| `sap_authentication_failed` | SAP rejected the selected per-user or shared identity. Includes tool and safe `errorCode`. |
| `sap_authorization_failed` | SAP authenticated the identity but denied the operation. Includes tool and safe `errorCode`. |
| `target_policy_denied` | Instance/target policy denied a selected-target operation. Includes tool and safe `errorCode`. |
| `safety_blocked` | Safety ceiling blocked an operation; includes the operation and safe reason. |
| `server_start` | Server version, transport, write ceiling, configured target URL indicator, and process ID where available. |
| `activation_preaudit_completed` | Two-phase SAP activation preaudit result, reference count, and phase durations. |
| `oauth_client_registered` | XSUAA only: a new DCR `client_id` was minted (`/register`). Includes id length and redirect-URI count. |
| `oauth_client_lookup_failed` | XSUAA only: a `client_id` failed to resolve. `reason` ∈ {`unknown_prefix`, `malformed`, `bad_signature`, `invalid_payload`, `expired`}. Useful for spotting forgery / probing. |
| `oauth_redirect_uri_registered` | XSUAA only: a redirect URI was added at `/authorize` time to the pre-registered XSUAA default client. |
| `oauth_redirect_uri_rejected` | XSUAA only: an unapproved redirect URI was rejected at `/authorize`; useful for detecting interception attempts or bad client configuration. |
| `cors_rejected` | A browser request was blocked because its `Origin` header is not in `ARC1_ALLOWED_ORIGINS`. Includes origin, method, path. Useful for spotting misconfigured browser clients or probing. |
| `auth_rate_limited` | **Layer 1** rate-limit denial on OAuth or `/mcp` endpoint (per-IP). Includes endpoint, IP, `limitPerMinute`. See [Rate Limiting Guide](rate-limiting.md). |
| `mcp_rate_limited` | **Layer 2** rate-limit denial on per-user MCP tool quota. Includes user, tool, `limitPerMinute`, `retryAfterMs`. The MCP client receives a tool error with `retryAfter` (not HTTP 429). |

Every entry has `timestamp`, `level`, and `event`. Events within one MCP tool call share a
`requestId`; authenticated calls add `user` and `clientId` when available. Selected multi-target
calls also add `destination`, public `target`, and `identity` (`per-user` or `shared`). Destination
credentials, bearer tokens, cookies, authorization headers, and other secret values are centrally
redacted before any sink write.

### Retention

- **File sink**: Retention is the operator's responsibility. Implement log rotation (e.g., logrotate) for long-running deployments.
- **BTP Audit Log**: Retention is managed by the BTP Audit Log Service per the service plan.
- **Stderr**: Transient unless captured by a container runtime or log aggregator.
