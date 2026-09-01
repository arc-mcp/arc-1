# Issue #733: model-facing identification for direct-connect ARC-1 instances

Audience: ARC-1 maintainers

Date: 2026-09-01

Scope: root cause, reproduction, review of PR #734, and fix-option analysis for single-target
instances. Multi-target behavior is in scope only as a compatibility boundary.

## Executive answer

Issue [#733](https://github.com/arc-mcp/arc-1/issues/733) is reproducible. `ARC1_SERVER_NAME`
changes `InitializeResult.serverInfo.name`, but the model-facing `instructions` remain identical for
every single-target ARC-1 instance. A client that registers a remote connector under its own opaque
ID therefore removes the only target-specific signal available before the first SAP tool call.

The correct fix is a separate, optional `ARC1_SYSTEM_LABEL` / `--system-label` that adds one short
identity line to the beginning of the single-target instructions. The default must remain
byte-identical, and multi-target instructions must remain authoritative. Unlike the raw interpolation
in [PR #734](https://github.com/arc-mcp/arc-1/pull/734), the value should be normalized to one line and
capped at 160 characters so a descriptive label cannot become extra prompt paragraphs or push the
existing instructions past the client-side 2,048-character ceiling.

## Root cause

The configuration and protocol paths diverge in `createServer`:

1. `ARC1_SERVER_NAME` / `--server-name` resolves to `config.serverName`.
2. `config.serverName` is passed as the SDK server implementation `name`, so it appears in
   `InitializeResult.serverInfo.name`.
3. Single-target `instructions` come from the static `SERVER_INSTRUCTIONS` constant and contain no
   configuration-derived identity.
4. Multi-target servers use `buildMultiTargetServerInstructions`, which already identifies a pinned
   target or explains explicit aggregate target selection.

This is a channel mismatch, not an SDK serialization failure. The MCP 2025-06-18 schema explicitly
defines `serverInfo` and `instructions` as separate initialize-result fields. It describes
`instructions` as model guidance that a client may add to the system prompt, while the implementation
`name` is a programmatic/logical identity ([MCP schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/schema.mdx#initializeresult)).
The newer discovery contract makes the distinction even clearer: `serverInfo` is intended for
display, logging, and debugging, while `instructions` are natural-language guidance for LLMs
([MCP discovery](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/discover.mdx#data-types)).

## Independent reproduction

Environment: repository `origin/main` at `ed171461`, Node 22.21.1,
`@modelcontextprotocol/sdk` 1.30.0 from the lockfile.

An in-memory SDK client/server handshake was run twice with otherwise identical `DEFAULT_CONFIG`:

| Configured name | Received `serverInfo.name` | First instruction line |
|---|---|---|
| `arc1-erp-dev` | `arc1-erp-dev` | `ARC-1 gives this SAP ABAP system ...` |
| `arc1-erp-prod` | `arc1-erp-prod` | `ARC-1 gives this SAP ABAP system ...` |

The two instruction strings were exactly equal. The current string is 1,151 JavaScript characters
(1,155 UTF-8 bytes). The focused baseline suite passed 307 tests across `config.test.ts`,
`server.test.ts`, and `multi-target-server.test.ts`.

The reported client behavior could not be reproduced without the reporter's hosted connector/account
state. It is independently corroborated by a detailed Claude Code report showing OAuth remote MCP
connectors registered as `mcp__<uuid>__*` even when the initialize response contains a friendly
`serverInfo.name` ([anthropics/claude-code#58015](https://github.com/anthropics/claude-code/issues/58015)).
That client behavior is therefore credible but remains client-side evidence rather than an ARC-1
integration test.

## Review and test of PR #734

PR #734 was checked out in an isolated worktree. Its focused suite passed 312 tests and its full
TypeScript typecheck passed. Its core idea and configuration plumbing are sound, but the tests call a
helper directly instead of verifying the label in an actual MCP initialize exchange.

Additional handshake probes found three gaps:

| Probe | Observed result | Consequence |
|---|---|---|
| Label contains `\n` | The second line becomes a new instruction paragraph | A nominal label can alter the instruction structure |
| Label has leading/trailing spaces | Spaces are preserved before the final period | Accidental configuration noise reaches every model context |
| Label has 1,000 characters | Instructions grow to 2,176 characters | The tail crosses Claude Code's 2,048-character truncation boundary |

The 2,048-character limit is already an ARC-1 source invariant and is independently reproduced in
[anthropics/claude-code#81268](https://github.com/anthropics/claude-code/issues/81268). It is a client
limit, not an MCP protocol limit. A 160-character label produces instructions comfortably below that
ceiling and matches ARC-1's existing bound for human-readable SAP target descriptions.

PR #734 correctly leaves multi-target instructions untouched; an aggregate handshake probe with a
sentinel system label confirmed that its multi-target branch does not emit the sentinel.

## Fix options

### 1. Keep changing only `serverInfo.name`, or add `serverInfo.title`

Rejected. This is the channel already hidden by the affected client's UUID namespace. `title` can
improve UI display but does not guarantee model-visible target context.

### 2. Automatically copy `ARC1_SERVER_NAME` into the instructions

Rejected. It conflates a programmatic identifier with a human description and cannot cleanly express
operator context such as `ERP production (read-only)`. It would also change instructions for every
existing deployment that already customizes the name, without an explicit model-context opt-in.

### 3. Discover SID/client from SAP before initialization

Rejected. ARC-1 deliberately keeps protocol initialization and `tools/list` independent of SAP
availability and startup feature-probe latency. An internal URL or destination name is not
necessarily a useful or safe operator-facing label, either.

### 4. Add an explicit model-facing system label

Selected. It directly fixes the missing channel, permits a useful landscape/access description,
requires no SAP request, preserves current behavior when absent, and composes with the existing
server name instead of replacing it.

The selected variant normalizes Unicode and whitespace to one line, rejects a normalized value over
160 characters, prepends `Connected SAP system: <label>.` plus one blank line, and keeps the
multi-target builder in precedence. Server configuration is operator-controlled and therefore part of
the trusted server boundary, but constraining a field advertised as a *label* prevents accidental
instruction-structure changes and protects the established context budget.

## Implementation verification

The selected design was implemented with the static instructions and builder isolated in
`src/server/server-instructions.ts`. The first broad gate exposed `server.ts` at 1,501 lines against
its 1,500-line ratchet; extracting the cohesive instructions module fixed the architecture finding
without raising the budget.

Final verification passed:

- 317 focused configuration/server/multi-target tests;
- 5,384 tests in the full unit suite;
- TypeScript typecheck, Biome lint, production build, and action-policy validation;
- file-size ratchets and every MCP tool-schema budget scenario.

No live SAP test was run because neither the configuration parser nor the MCP initialize response
performs SAP I/O.

## Limitations and stopping criterion

- No live SAP request is needed or useful: the defect and fix are wholly in configuration and MCP
  initialization.
- The hosted Claude connector cannot be exercised from this repository. The issue report and the
  independent Claude Code reproduction establish the client-side premise; the local handshake
  establishes ARC-1's side.
- Research stopped after the protocol channel, SDK behavior, client namespace behavior, instruction
  length limit, multi-target boundary, and candidate-input risks all had direct evidence. Further
  client anecdotes would not change the selected server-side design.

## Claim-to-source ledger

| Claim | Source | Date / access note |
|---|---|---|
| ARC-1 instances lose target identity in static instructions | [ARC-1 issue #733](https://github.com/arc-mcp/arc-1/issues/733) | MWKAnalytics, opened 2026-09-01 |
| Existing proposed implementation and contributor provenance | [ARC-1 PR #734](https://github.com/arc-mcp/arc-1/pull/734) | Marvin Kloth / MWKAnalytics, opened 2026-09-01; patch tested locally |
| `serverInfo.name` was introduced for direct-connect identity | [ARC-1 PR #606](https://github.com/arc-mcp/arc-1/pull/606) | Marcus Schölzel, merged 2026-07-24 |
| `instructions` may be added to model context and are distinct from implementation identity | [MCP 2025-06-18 schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/schema.mdx#initializeresult) | Model Context Protocol project; accessed 2026-09-01 |
| Newer MCP discovery continues to separate identity and LLM guidance | [MCP 2026-07-28 discovery](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/discover.mdx#data-types) | Model Context Protocol project; accessed 2026-09-01 |
| OAuth remote connectors can use a UUID instead of `serverInfo.name` | [Claude Code issue #58015](https://github.com/anthropics/claude-code/issues/58015) | Independent reproduction report, 2026-05-11; closed as not planned |
| Claude Code truncates instructions at 2,048 characters | [Claude Code issue #81268](https://github.com/anthropics/claude-code/issues/81268) | Independent reproduction report, 2026-07-26; also encoded as an ARC-1 source invariant |
