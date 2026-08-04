# Plan: IDE integration v1 — ARC-1 proposes, the IDE writes

Status: **spec, not yet implemented**. Dated 2026-08-03.
Research behind it: `docs/research/2026-07-31-vscode-arc1-diff-bridge.md` (VS Code surfaces) and
`docs/research/2026-08-01-native-abap-editing-integration.md` (what "native" costs).
Reference implementation of the IDE half: `~/DEV/arc1-abap-bridge` (v0.4.0, working against a4h).

## Goal

Bring ARC-1 and the IDE close enough that an ABAP change feels like a normal Copilot code change:
the object opens in the real editor, the model's answer links to it, and the diff is a diff editor.
Secondary and equally important: make ARC-1 useful in the **many deployments that will never enable
writes** — by letting it *propose* changes the IDE applies.

## Measured basis (do not re-derive)

| Fact | Evidence |
|---|---|
| Copilot's Keep/Undo UI renders only for **its own** edit tools on a workspace URI | stable VS Code API has no edit-carrying chat part; every candidate is proposed API (Copilot enables 63) |
| `abap:` is a **writable** FileSystemProvider, so an ABAP object *is* a workspace URI | `registerFileSystemProvider(oe, this, {isCaseSensitive:true})` in `sapse.adt-vscode` 1.1.1 |
| No scheme gate on Copilot's edit path | `scheme!=="file"` appears 3× in the 20 MB bundle: cache-key normaliser, raw `node:fs` reader, `.copilotignore` discovery — none on the edit path |
| VS Code sends workspace folders as **MCP roots, including non-`file:` schemes** | workbench filters roots by `authority`, not scheme; only `file:` gets path normalisation |
| VS Code advertises the `roots` capability | probe: `Visual Studio Code` 1.131.0, proto 2025-11-25, caps `roots,sampling,elicitation,tasks,extensions` |
| Claude Desktop advertises **no** roots | probe: `claude-ai` 0.1.0, caps `extensions` |
| Claude Code names its client per-server | probe: `local-agent-mode-client-probe` → under ARC-1 it is `local-agent-mode-arc-1`; match by **prefix** |
| `listRoots()` is impossible on ARC-1's HTTP transport | `src/server/http.ts:193` builds a per-request `Server` that never sees `initialize` |
| `server.listRoots()` exists in the SDK ARC-1 already ships | `@modelcontextprotocol/sdk ^1.28.0` |

## A. `SAPWrite action="propose"` — read-scoped dry run

**The headline change.** Runs every transform, gate and check, returns what *would* happen, writes nothing.

### Shape

```
SAPWrite(action="propose", proposeAction="edit_method", type="CLAS", name="ZCL_X", method="…", source="…")
```

One new action enum value plus one `proposeAction` property covers **all** write actions. The alternative —
`propose_update`, `propose_edit_method`, ×20 — would blow the tool-definition snapshots and the schema
budget for no benefit.

### Policy

```ts
'SAPWrite.propose': { scope: 'read', opType: OperationType.Intelligence }
```

`Intelligence` is the correct opType (SAP-side compute, no mutation — same class as where-used and
completion) and `OPTYPE_SCOPE` already maps it to `read`. This satisfies the invariant that a tool may not
claim `read` while declaring a write op — which is exactly why `dryRun` **cannot** be a boolean flag on the
existing write actions. `filterToolsByAuthScope` already prunes per-action enums, so a read-only user sees
`SAPWrite` with `action` reduced to `["propose"]` — no new tool, no extra listing logic.

### Gating

- **Requires `read` scope only.** Works with `SAP_ALLOW_WRITES=false`. That is the point.
- Must never lock, PUT, DELETE, or take any CSRF-mutating path.
- `allowedPackages` is **evaluated and reported, never enforced**: nothing is written, so blocking a
  proposal buys nothing, and in a read-only deployment ARC-1's ceiling was never the enforcement point —
  `S_DEVELOP` and the IDE are. Response carries e.g. *"ZARC1_DEMO is outside allowedPackages; ARC-1 could
  not apply this itself."*
- Emits a distinct audit event (`tool_call_*` with the propose action) so admins can see proposals being
  generated in a writes-disabled system.

### Payload rules (context-safety)

Large classes and reports must not overflow the caller's context. Three rules, no size knob needed:

1. **Never echo back caller-supplied source.** For `update`/`edit_method` the model already sent the new
   source — return only the unified diff plus verdicts (lint, package, syntax).
2. **Return generated source only where ARC-1 generated it** — RAP scaffolding, create-from-template,
   `batch_create`, `generate_behavior_implementation`.
3. **Return the smallest replaceable unit** — a method for `edit_method`, a section for class surgery —
   never the whole object.

Plus a hard cap on the diff with an explicit truncation notice; the full text stays reachable via
`SAPRead action="diff"`.

### Engineering cost — the real work

Each write action must split into a pure **plan** (`{source?, diff, warnings, package, verdicts}`, no
mutation) and an **apply** (lock → PUT → unlock). Affects `src/handlers/write/` (`create.ts` 1304 lines,
`class-surgery.ts` 616, `update-delete.ts` 321, `rap.ts` 291, `unit-surgery.ts` 82) and `write.ts` (329).
Independently a quality win: plans become unit-testable without a SAP system.

Follow the playbook — freeze `tests/fixtures/tool-definitions/*.json` first, move code verbatim, one action
at a time, full gate between commits.

## B. Diff on ordinary writes

Successful writes currently return `Successfully updated CLAS ZCL_X.` Add `+N/-M` and optionally the hunks.
Needs the same pre-write GET of current source that `propose` needs (ETag-cached) — **build the pre-read
once, serve both A and B**. `unifiedDiff` already exists in `src/adt/source-diff.ts`.

## C. `package` on results

- **Writes: free** — `enforceAllowedPackageForObjectUrl` already calls `client.resolveObjectPackage()`
  whenever `allowedPackages` is restricted. Include it in the result.
- **Reads: one extra ADT GET** — `/source/main` carries no package. Therefore **opt-in only**
  (`includePackage: true`), never on by default. Do not spend a round trip per read.

## D. `ARC1_IDE_LINKS` — clickable output

```
ARC1_IDE_LINKS = auto | off | vscode | eclipse | <template>
```

`<template>` takes `{type} {name} {package} {uri}` so it stays vendor-neutral (principle 5).

`auto` resolves from the existing `clientAgent` (`clientInfo` on stdio, `User-Agent` on HTTP —
`src/server/context.ts:27`, `src/server/http.ts:201`), today marked audit-only; promote it to a
**presentation** input:

| clientInfo | auto emits |
|---|---|
| `Visual Studio Code` (prefix match, covers forks) | `vscode://marianfoo.arc1-abap-bridge/open?name=…&package=…` |
| `local-agent-mode-*` (Claude Code) | nothing — no IDE to target |
| `claude-ai`, anything unrecognised | **nothing** |

Claude Desktop advertises no roots and has no IDE, so `auto` can never infer there — which is exactly why
the explicit setting matters. `.mcpb` `user_config` supports only `string`/`boolean`, so it is a string
field defaulting to `auto`, mapped to `ARC1_IDE_LINKS` in `server.mcp_config.env`. A Claude Desktop user
picks `vscode` or an Eclipse template in the extension's settings UI.

**Security line:** `clientAgent` is client-controlled. Fine for choosing a link format (worst case: a
useless link). Never for anything security-relevant.

**Mismatch behaviour (decided):** emit the link anyway, with a warning when the IDE destination cannot be
confirmed. Suppress the warning when roots confirms the same system.

### Eclipse `adt://` links — format derived, scheme is OS-registered

ADT registers the scheme with the operating system, so an `adt://` link clicked from Claude Desktop, a
browser or anywhere else routes into Eclipse:

```xml
<extension point="org.eclipse.urischeme.uriSchemeHandlers">
  <uriSchemeHandler class="com.sap.adt.tools.core.ui.internal.openurl.AdtLinkHandler" uriScheme="adt"/>
```

Present in every ADT from 3.32 to 3.60. `AdtLinkHandler` implements `IUriSchemeHandler` and delegates
straight to `AdtNavigationServiceFactory` → `IAdtNavigationService`.

The format comes from `com.sap.adt.tools.abapsource.urimapping.ExternalUriUtil`, whose constants are
`adt://`, `getSystemId`, `adtObjectBaseUri`, `client` / `sap-client`, `addSystemClientToUriIfNecessary`
and `useSystemAgnosticURI`:

```
adt://<systemId>/<adt object uri>[?sap-client=NNN]
e.g. adt://A4H/sap/bc/adt/oo/classes/zcl_arc1_task_service?sap-client=001
```

**ARC-1 already has every part** — the ADT object URI is what it builds for every read/write, and the SID
and client come from the connection. A *system-agnostic* variant (no `<systemId>`) exists for sharing a
link with someone on a different system; worth exposing as a template option.

Remaining empirical detail: whether the authority is the **SID** (`A4H`) or the ADT **project name**
(`A4H2023` in the current VS Code destination). `getSystemId` implies SID. Confirm with one
**ABAP: Share Link… → Copy ADT Link** before shipping the `eclipse` variant.

## E. IDE context via MCP roots — strictly additive

On stdio, call `server.listRoots()` once per session (cached, refreshed on
`notifications/roots/list_changed`) and keep any `abap:` roots. Gives ARC-1, with **zero extension
involvement**: which destination the IDE has open, and which packages are in the workspace.

Uses: confirm the IDE is on the same system before emitting a link without a warning; tell the model when
an object is not in the workspace and therefore not openable.

**Rule: roots changes what ARC-1 knows, never what it does.** Every feature must work without it. HTTP
deployments simply keep the warning that roots would have suppressed — nothing breaks, and those
deployments (Copilot Studio, browser clients) usually have no IDE anyway.

### Measured: Claude Desktop renders `vscode://` links but will not open them

Live test, 2026-08-03. With `ARC1_IDE_LINKS=vscode`, Claude Desktop renders the link as a normal blue
"Open in IDE" hyperlink — and **clicking does nothing**. The scheme itself is fine: `open
"vscode://marianfoo.arc1-abap-bridge/open?name=ZCL_ARC1_TASK_SERVICE"` from a shell returns 0 and fronts
VS Code, and the identical link works from VS Code's own chat. Claude Desktop only hands `http`/`https`
to the OS.

Consequences:

- **`auto` emitting nothing for `claude-ai` is now evidence-based, not caution.** A link there would
  render and silently fail — worse than no link.
- **Setting `vscode` explicitly in Claude Desktop is a trap**, and the `user_config` description said to
  do exactly that. Corrected: the link is copy-paste only there.
- Expect the same for `adt://` from Claude Desktop, for the same reason. Untested but it is the same
  class of scheme.

Two workarounds were prototyped and **both rejected**:

1. **Loopback listener in the bridge.** For ARC-1 to emit a correct URL it must know the port at emit
   time, so the port has to be fixed and guessable — and a fixed, unauthenticated local endpoint that
   performs actions is reachable by any web page you visit (CORS blocks reading the response, not the
   side effect). A random port plus a token published in `~/.arc1/bridge.json` closes that hole, but it
   is a listener in the editor plus a secrets file to save a copy-paste.
2. **Hosted `http` page that bounces to `vscode://`.** Verified working: a browser *will* hand a custom
   scheme to the OS from page JS, with no confirmation prompt. Putting the object in the URL **fragment**
   keeps it off the server entirely. But the chain is Desktop link policy → default browser → host
   reachable → not proxy-blocked → browser hands off → fragment survives every hop → VS Code running →
   bridge installed. Eight links, seven outside our control, and it fails *after* the click rather than
   by simply not being clickable. The fragment was already lost once during testing (macOS `open` strips
   it from a `file://` URL), producing a silent empty-name link.

**Decision: neither ships.** `auto` emitting nothing in Claude Desktop is the correct behaviour because no
reliable path exists. The template escape hatch remains for anyone who wants to wire up a redirect with
full knowledge of the trade-offs — ARC-1 just does not own that brittleness. A prototype redirect page
lives at `arc1-abap-bridge/redirect/index.html` for reference.

## Session hygiene on writes — hypothesis disproven, real fix shipped

Observed four times on 2026-08-03: the ADT session in VS Code dies and every `abap:` operation fails,
surfacing misleadingly as `NoPermissions (FileSystemError): Method "createDirectory" not yet implemented`.

**The original hypothesis was wrong.** It assumed SAP issues a fresh `SAP_SESSIONID` for a stateful
request, so that discarding the clone's cookie jar orphaned one session per write. Probed directly
against a4h (read-only, three GETs on `/sap/bc/adt/discovery`):

| Request | New session cookie |
|---|---|
| plain GET | yes — the initial session |
| GET with `X-sap-adt-sessiontype: stateful` | **none — cookie reused** |
| GET with `X-sap-adt-sessiontype: stateless` | none — cookie reused |

So there is no per-write session orphaning, and that mechanism cannot explain the logouts.

**What was genuinely wrong, and is now fixed** (`withStatefulSession`):

1. **The stateful context was never released.** A stateful ADT session persists until explicitly ended —
   omitting the header on later requests does *not* end it. ARC-1 sent `stateful` and never followed with
   `stateless`, so its session stayed stateful and held an ABAP mode until timeout. Eclipse ADT and
   `abap-adt-api` both send the release. Now sent as a best-effort `HEAD /sap/bc/adt/core/discovery`
   in a `finally`, so it also runs when the write throws and can never mask the caller's error.
2. **A rotated session cookie was lost.** The clone's jar was discarded, so if SAP ever rotates the
   session id mid-block the parent keeps using a dead one and the next request silently starts a new
   session. Not observed on 7.58, but the window is real; the jar and CSRF token are now merged back.

Verified live: create → update → delete of a `$TMP` program, all three stateful cycles clean.

**The logouts remain unexplained.** Remaining candidates, cheapest first: an idle/absolute timeout on the
ADT language server's reentrance-ticket session (most likely, and nothing to do with ARC-1); the per-user
mode cap (`rdisp/max_alt_modes`, commonly 6) with ARC-1 + the LS + SAP GUI all logged on as the same user;
or the bridge's parallel `readDirectory` load on the LS. To identify it, record the interval between
logon and logout — a consistent ~30/60 minutes points to a timeout, correlation with write bursts points
to load.

## Out of scope for v1

- **Write journal** (`ARC1_WRITE_JOURNAL_DIR`) — deferred by decision. It is also the change with a real
  security story: plaintext source to disk, outside the audit sinks' redaction.
- Pushing an edit into Copilot's Keep/Undo UI — requires proposed APIs, not publishable.
- MCP `resource_link` to an ABAP file — VS Code rewrites every one to `mcp-resource://`.
- Name→URI resolution, editors, diff editors — bridge/plugin territory, deliberately not in ARC-1.

## IDE side (context, not ARC-1 work)

**VS Code** — `arc1-abap-bridge` already resolves name→`abap:` URI (package via ARC-1's
`SAPSearch(tadir_lookup)` through `lm.invokeTool`, no model turn), opens objects, serves `vscode://` deep
links, and renders the activated↔inactive diff. Remaining: `line`/`method` in deep links, and consuming
`propose` output once it exists.

**Eclipse** — plugin hosting an in-process MCP server (Copilot for Eclipse has zero extension points but
full MCP support). Core logic is *simpler* than VS Code — `com.sap.adt.tools.core.ui.navigation` is
exported public API, and `CompareUI` handles diffs — but packaging is OSGi/Tycho. Build only if Eclipse
becomes a primary target.

## Sequencing — revised after live measurement

**`propose` is demoted.** The measured flow needs no ARC-1 write at all: Copilot edits the `abap:` file,
SAP's own provider performs the write under SAP auth, and ARC-1's ceiling never enters it. A read-only
ARC-1 deployment already works today with zero changes. `propose` now covers only two cases — objects not
reachable in the workspace, and ARC-1's generative transforms (RAP scaffolding, `batch_create`,
class-section surgery). Both real, neither urgent, and a plan/apply split across ~3000 lines of `write/`
is too much to build speculatively.

### Tier 1 — small, fully evidence-backed, testable in both clients

**T1. `ARC1_IDE_LINKS`** — `off | auto | vscode | eclipse | <template>`, default `auto`.
- Files: `src/server/types.ts` (default), `src/server/config.ts` (parse/validate),
  `src/handlers/shared.ts` (append to `textResult`), `mcpb-manifest.json` (`user_config` string field +
  `server.mcp_config.env`).
- Detection from the existing `clientAgent` (`src/server/context.ts:27`), promoted from audit-only to a
  presentation input. Measured client names: `Visual Studio Code` (prefix match, covers forks),
  `claude-ai`, `local-agent-mode-*` (Claude Code — the name is derived from the *server* name, so match
  by prefix). Unrecognised ⇒ emit nothing.
- Templates: `vscode://marianfoo.arc1-abap-bridge/open?name={name}&package={package}` and
  `adt://{sid}/{uri}?sap-client={client}`.
- Security line: `clientAgent` is client-controlled. Fine for choosing a link format, never for anything
  security-relevant.

**T2. Roots-derived destination awareness.** ✅ **DONE**
- Files: `src/server/server.ts` (call `server.listRoots()` once per session, cache, refresh on
  `notifications/roots/list_changed`), consumed where links are emitted.
- Measured: VS Code returns `[{name:"UI5con_2026",uri:"file:///…"},{name:"A4H2023",uri:"abap:/repotree-v1/A4H2023"}]`.
- Strictly additive: roots changes what ARC-1 *knows*, never what it *does*. Impossible on HTTP
  (`src/server/http.ts:193` builds a per-request `Server`), so every feature must work without it.

Shipped as `src/server/ide-roots.ts` (cached per session, capability-gated, 2s timeout, never throws)
plus `abapDestinationsFromRoots` in `ide-links.ts`. Two behaviours it buys:

1. **Links are gated on a real ABAP folder, not the client's name.** `auto` previously keyed on "is this
   VS Code", so a VS Code user *without* the bridge or without a package in the workspace got a link that
   could not resolve. An `abap:` root proves the extension is live and a package is open. When roots are
   unavailable (HTTP, or a client without the capability) it falls back to the client name, so nothing
   regresses.
2. **`{sid}` comes from the IDE.** `abap:/repotree-v1/A4H2023` → `A4H2023`, which is the only place a
   system id exists at all on a plain on-prem connection — `destinationName`/`targetId` are BTP/multi-target
   only. That makes `eclipse` links work without a hand-written template.

**T3. `package` on results.** Free on writes (`resolveObjectPackage` already runs when `allowedPackages`
is restricted); opt-in on reads (`includePackage: true`) because it costs an extra ADT GET.

### Tier 2 — after Tier 1 has been used in anger

**T4. Diff on ordinary writes** — needs a pre-write GET; build it once and it also serves `propose`.

**T5. `propose`** — build when a concrete case demands it (first RAP scaffold, or the first object outside
the workspace). Design as specified in section A: one action + `proposeAction`, `{scope:'read',
opType:Intelligence}`, plan/apply split. `SAPDiagnose action="syntax"` with `source` is the working
precedent — SAP-side, mutation-free, read-scoped, already shipping.

## How to test each change in both clients

**VS Code (with the bridge).** ARC-1 is already wired as a stdio MCP server in
`~/Library/Application Support/Code/User/mcp.json`. Point it at the local build instead of `npx arc-1@latest`:

```json
"arc-1": { "type": "stdio", "command": "node", "args": ["/Users/marianzeis/DEV/arc-1/dist/index.js"], "env": { … } }
```

Then `npm run build` in `~/DEV/arc-1`, restart VS Code, and exercise it through Copilot chat. The bridge's
*ARC-1 ABAP Bridge* output channel shows every tool the bridge itself invokes.

**Claude Code.** Add the same local build via `claude mcp add`, or a `.mcp.json` in the project. Claude
Code advertises `roots` (measured) but has no `abap:` filesystem and no bridge — so it is the honest test
of whether a feature degrades gracefully:
- **T1** should emit *nothing* under `local-agent-mode-*`, since there is no IDE to target. If it emits a
  `vscode://` link there, the detection is wrong.
- **T2** should return the *file* cwd roots, not an `abap:` root. Confirms ARC-1 handles both shapes.

**Fast loop without any client** — `node dist/cli.js call <Tool> --json …` against the real system, which
is how the `SAPDiagnose action="syntax"` behaviour in this document was measured.

## The inversion is supported by design — resolved

`copilot_applyPatch` takes a **patch string**, not a URI, so the question is how a path inside the patch
resolves. Copilot's `IPromptPathRepresentationService`:

```js
getFilePath(uri) {                       // how a document is named TO the model
  if (uri.scheme === file || uri.scheme === vscodeRemote) { … return uri.fsPath }
  return uri.toString();                 // non-file schemes → the full URI string
}
resolveFilePath(path, defaultScheme = file) {
  … return defaultScheme === file ? Uri.file(p) : Uri.from({ scheme: defaultScheme, path: p.path });
}
```

and the resolver used on the model's response:

```js
_createUriFromResponsePath(p) {
  for (const f of this._editCodeStep.workingSet)
    if (pathService.getFilePath(f.document.uri) === p) return f.document.uri;   // working set first
  const u = pathService.resolveFilePath(p, this._editCodeStep.getPredominantScheme());
  …
}
```

`getPredominantScheme()` means Copilot tracks the edit session's dominant URI scheme and resolves patch
paths against it. Together with `getFilePath` returning `uri.toString()` for non-`file` schemes and the
explicit non-file branch in `resolveFilePath`, this is purpose-built machinery for editing virtual
filesystems — not an accident. Combined with the absence of any scheme gate on the edit path, the
inversion is safe to build on.

### Measured live (bridge v0.5.0 self-test, VS Code 1.131.0, a4h)

| Step | Result |
|---|---|
| `workspace.fs.isWritableFileSystem('abap')` | **true** |
| Edit tools invokable by a third party | `copilot_applyPatch`, `copilot_insertEdit`, `copilot_createFile`, `copilot_editFiles` |
| Resolve + `readFile` on `abap:` | ok, 2579 bytes |
| How the doc would be named to the model | `abap:/repotree-v1/A4H2023/System%20Library/…` (URI string, as predicted) |
| **Third-party `WorkspaceEdit` on an `abap:` doc** | **applied: true, becameDirty: true, reverted: true** |
| `copilot_applyPatch` invoked *outside* a chat session | **failed** — resolved the path to `file:///abap%3A/repotree-v1/…System%2520Library/…`, "outside of your workspace", "No changes detected" |

**The working set is the mechanism, not an optimisation.** With no chat session there is no
`getPredominantScheme()` and no working set to match against, so `resolveFilePath` fell into its `file`
branch and mangled the URI. Copilot can only target an `abap:` document when that document is in the edit
session's working set.

### Consequence: two write paths, one guaranteed

1. **Bridge-applied (primary, guaranteed).** The bridge takes ARC-1's proposed source and applies it with
   `workspace.applyEdit` — measured working. The editor shows the change and goes dirty; the user reviews
   and saves; SAP's own provider performs the write. No Keep/Undo chrome, but it depends on nothing inside
   Copilot and cannot break when Copilot changes.
2. **Copilot-applied (opportunistic, nicer).** Native hunks and Keep/Undo, but only inside a real chat edit
   session with the object attached. **Requirement for the bridge: `abapOpen` must add the object to the
   chat working set, not merely open an editor.** VS Code registers
   `workbench.action.chat.attachFile` (alongside `attachContext`, `attachFolder`, `attachSelection`,
   `attachPinnedEditors`), so the bridge can do this itself — best-effort, wrapped in try/catch, since
   these are workbench commands and not stable API.

Build 1, and let 2 happen when the conditions are right.

### Confirmed live: Copilot edits `abap:` natively — and SAP rejects the save

With the object **attached to the chat**, Copilot resolved it correctly and applied a real edit:
`Edited zcl_arc1_task_service.clas.abap +1 -0`, green hunk decoration, **Keep / Undo**. Attachment was the
missing ingredient — the same tool without it produced `file:///abap%3A/…` and "No changes detected".

The save then failed:

```
Failed to save 'zcl_arc1_task_service.clas.abap':
The class contains unknown comments which can't be stored.
```

**This is the finding that matters.** Copilot wrote syntactically plausible ABAP that the backend refuses —
a comment in a position the class serializer will not store. Nothing in the IDE knew that until SAP said
no, after the edit was already applied and the buffer dirty.

⇒ **The division of labour is not "Copilot writes, ARC-1 reads". It is "Copilot writes, ARC-1 validates
before the write lands."** That is a role only ARC-1 can play: it already has `SAPLint` (abaplint with the
right release profile), pre-write hints, and the SAP-side syntax check. Add to the plan:

#### Validated live — and it needs **no ARC-1 change at all**

`SAPDiagnose action="syntax"` already accepts `source`: *"SAP compiles the given content as if it lived at
the object's URI (pre-write dry-run, nothing is written)"*. Run against the exact buffer SAP refused:

```json
{ "hasErrors": false,
  "messages": [ { "severity": "warning",
                  "text": "The class contains unknown comments which can't be stored.",
                  "line": 23, "column": 0,
                  "uri": "/sap/bc/adt/oo/classes/zcl_arc1_task_service/source/main#start=23,0" } ] }
```

Identical message, correct line, **795 ms**, nothing written. Two corrections this produced:

1. **Offline abaplint cannot substitute.** `arc1 lint` crashes on this class — `ZARC1_T_TASK not found,
   lookupView` — identically for the good and the bad source, because DDIC types are not resolvable
   offline. Pre-save validation **must** use the SAP-side check, not local lint.
2. **`hasErrors` is `false` — it is a *warning*.** A naive `if (hasErrors)` gate would let exactly this
   failure through. Surface warnings too.

So the work is entirely on the IDE side:

- **Bridge:** on `onWillSaveTextDocument` for an `abap:` document, call `SAPDiagnose action="syntax"` with
  the buffer through `lm.invokeTool`, and warn (never block) on any message regardless of `hasErrors`.
- **Instructions:** after editing an ABAP file and before saving, validate the buffer with ARC-1.

This is also a working precedent for the `propose` design in section A: SAP-side dry-run, mutation-free,
read-scoped, already shipping.

Also observed while the destination was disconnected: `NoPermissions (FileSystemError): Method
"createDirectory" not yet implemented`. Treat as a symptom of the logged-off session rather than a
separate defect unless it recurs while connected.
