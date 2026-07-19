# Cline shows "Tools (0)" for ARC-1 — tools/list timeout race

**Status:** Root cause confirmed via raw stdio capture. Fix: respond to `tools/list` immediately,
push `notifications/tools/list_changed` once startup feature discovery completes.

## Symptom

In Cline (VS Code extension), the ARC-1 MCP server entry shows as connected (green) but the tool
list stays empty ("Tools (0)"), even after:
- restarting the process (fresh PID confirmed via `Win32_Process`)
- reloading the VS Code window
- reducing the tool count to 1 via `ARC1_TOOL_MODE=hyperfocused`

A structurally near-identical sibling server (`ABAP_MCP`, same machine, same SAP lab host, also
`node` + stdio + local `dist/index.js`) worked fine in the same Cline instance (13 tools), which
ruled out Cline itself, PATH/env, and network/credentials as the cause.

## Root cause

`src/server/server.ts` (`createServer`, `ListToolsRequestSchema` handler) blocks the `tools/list`
response until the startup feature-discovery probe finishes, capped at 10 seconds:

```ts
server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
  if (startupProbePromise) {
    await Promise.race([startupProbePromise, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
  ...
```

Confirmed via a stdio MITM wrapper spliced between Cline and the real server process (raw
JSON-RPC, timestamps in UTC):

```
07:10:03.488  Client → Server: initialize
07:10:07.273  Server → Client: initialize result            (+3.79s)
07:10:07.274  Client → Server: tools/list
07:10:12.289  Client → Server: notifications/cancelled       reason="MCP error -32001: Request timed out"  (+5.01s after tools/list)
07:10:15.559  Server stderr:  "Authorization probe: object search access is available"   (discovery only NOW finishing)
```

**Cline cancels `tools/list` after ~5 seconds.** ARC-1's feature-discovery probe against a real
(non-localhost) SAP system routinely takes longer than that — here the probe was still running at
+8.3s past the `tools/list` request, well past Cline's patience and even past ARC-1's own 10s cap
would have allowed it to reach. Since the wait sits in the shared code path before tool-list
construction, this affects standard **and** hyperfocused mode identically (hyperfocused only
changes what happens *after* the wait, so a 1-tool response is delayed exactly as much as the
12-tool one).

ABAP_MCP has no equivalent blocking wait — its `tools/list` answers immediately regardless of SAP
reachability, which is why it never showed this symptom.

## Fix

Chosen approach (of two considered): stop blocking `tools/list` on the probe. Respond immediately
with the best-effort/default tool set, declare `capabilities.tools.listChanged = true`, and emit
`notifications/tools/list_changed` once the startup probe resolves so clients that support live
refresh re-fetch the discovery-adjusted list shortly after. (Alternative considered: just lower the
10s cap to ~2s — simpler, but still a race against unknown client timeouts and loses the
discovery-adjusted list on any slow SAP system rather than delivering it slightly late via
notification.)

## Diagnostic method (for future reference)

A throwaway Node.js MITM script was pointed to by the Cline config in place of the real command; it
spawned the real `dist/index.js` as a child process, piped stdin/stdout through unmodified, and
logged every chunk with a timestamp to a file. This captured the exact wire-level JSON-RPC exchange
between Cline and ARC-1 without needing the user to interpret Cline's UI — the log alone was
sufficient to pinpoint the exact timeout race. Both the wrapper script and its log were scratch
artifacts, deleted after use (not committed).
