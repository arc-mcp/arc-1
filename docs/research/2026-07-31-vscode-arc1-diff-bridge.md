# Research: showing ARC-1 changes as diffs / clickable files in VS Code + Copilot

Dated 2026-07-31. Verified against **VS Code 1.129.1**, **built-in `copilot-chat` 0.57.0**, and
**`sapse.adt-vscode` 1.1.0** (installed locally, `~/.vscode/extensions/sapse.adt-vscode-1.1.0-darwin-arm64`).
Evidence = teardown of the shipped bundles, not docs.

## Problem

ARC-1 writes ABAP source over ADT REST straight into SAP. Nothing in the VS Code workspace changes, so
Copilot has no edit to render: no diff, no Keep/Undo, no clickable file. The user wants both, using
`sapse.adt-vscode` (virtual ABAP filesystem) as the editor.

## Ground truth

### 1. Copilot's diff UI is bound to *its own* edit pipeline

Built-in edit tools are `copilot_applyPatch`, `copilot_insertEdit`, `copilot_editFiles`,
`copilot_createFile` (38 tools in `extensions/copilot/package.json`). The Keep/Undo diff decoration
only appears for edits those tools make on a workspace URI. **No API lets a third-party MCP server or
extension push an edit into that UI.**

There *is* an internal `kind:"externalEdit"` chat part carrying `beforeContentUri`/`afterContentUri`/
`diff:{added,removed}` — but it is fed from **AHP / `chatSessions` agent-host** `content[].type==="fileEdit"`
items (external agent CLIs surfaced as chat sessions), not from MCP tool results or `lm.registerTool`.
Different integration surface; not reachable from ARC-1.

### 2. MCP `resource_link` cannot point at a workspace file

VS Code rewrites **every** `resource_link` URI a server returns:

```js
// workbench.desktop.main.js — pT.fromServer
r.with({ scheme: "mcp-resource", authority: enc(server.id),
         path: ["", r.scheme, r.authority || "dylo78gyp"].join("/") + r.path })
```

So `file:///…` becomes `mcp-resource://<server>/file/…` and is read back through the server's own
`resources/read`. Clicking it opens ARC-1-served content in a read-only editor — never SAP's ABAP editor,
never a real file. Useful as a zero-extension fallback, useless for "open the ABAP object".

### 3. `vscode://` links in chat survive; `file:` is special-cased local

Chat's markdown link rewriter (`qRn`) leaves a link alone iff its scheme is in the allowlist:

```
http https mailto ws wss ftp ftps data blob javascript command vscode vscode-insiders … copilot-skill
```

Everything else (including `abap:`) is wrapped into the remote-agent scheme via `Np()`. `Np()` passes
`file:` through untouched when the session is local. **⇒ a `vscode://<publisher>.<ext>/…` deep link is the
one reliable clickable hook a tool result can put in front of the user.** (`command:` is allow-listed
against rewriting but still needs `isTrusted`, which model output doesn't get.)

### 4. What `sapse.adt-vscode` 1.1.0 actually exposes

| Fact | Value |
|---|---|
| FS scheme | `abap`, activation `onFileSystem:abap` (lazy — any extension touching an `abap:` URI activates it) |
| Real URI shape | `abap:/repotree-v1/<DEST>/<Tree Root>/<pkg path>/Source%20Code%20Library/Classes/<OBJ>/<obj>.clas.abap` |
| Writable? | Yes — `adtLs/fileSystem/{readFile,writeFile,lockFile,unlockFile,toggleVersion,forceRefresh}` |
| Public extension API | **None** (`activate()` exports nothing) |
| URI handler / deep links | **None** — `registerUriHandler` count = 0 |
| `openAbapObject` command args | **None** — always opens the QuickPick |
| Proposed APIs | **None** ⇒ no `FileSearchProvider` ⇒ **`workspace.findFiles` does not work on `abap:`** |
| Chat integration | ships `contributes.chatAgents` → `agents/abap-developer.agent.md`, and `mcpServerDefinitionProviders` for the ADT MCP server |

The URI embeds the **package hierarchy plus localized tree labels** (`Local Objects ($TMP)`,
`System Library`, `Source Code Library`, `Classes`, and for `$TMP` the *owning user*). Real examples from
this machine's `state.vscdb`:

```
abap:/repotree-v1/A4H/Local%20Objects%20%28%24TMP%29/DEVELOPER/Source%20Code%20Library/Classes/ZCL_ARC1LSP_ATC/zcl_arc1lsp_atc.clas.abap
abap:/repotree-v1/A4H/System%20Library/Z_RAP_VB_1/Core%20Data%20Services/Data%20Definitions/ZC_FBCLUBTP/zc_fbclubtp.ddls.acds
```

⇒ **you cannot synthesize the URI from an object name.** Resolution options, in order of laziness:
open tabs/`workspace.textDocuments` → walk workspace folders with `workspace.fs.readDirectory`. Never
`findFiles`. SAP's own agent file says the same thing: *"You MUST adjust the file search because the ABAP
extension uses the virtual workspace file system. Always search via the directory first!"*

### 5. SAP already solved this — by not writing out-of-band

`agents/abap-developer.agent.md` (21 lines, shipped in the extension):

> Use the adt-mcp-server for creating new ABAP development objects … **Always add and edit source code via
> the VS Code editor.** If needed open the editor first via the provided file paths.

SAP's MCP server deliberately has **no edit-source tool**. Creation/activation/tests go through MCP; source
edits go through Copilot's normal edit tools on the `abap:` virtual file — which is why SAP gets native
diffs for free. First-party evidence that `copilot_applyPatch` & co. work on the `abap:` scheme.

## Options

### Option 0 — no code at all (start here)

Add the SAP package as a workspace folder, and tell Copilot (via `.github/copilot-instructions.md` or a
custom `*.agent.md`) to **edit through the editor** and use ARC-1 only for what the SAP extension can't do
(search, where-used, context compression, lint, transports, ATC on old releases, CDS/RAP intelligence).
Native diff + Keep/Undo + clickable files, zero maintenance. Cost: only works for objects in the workspace,
and requires an SAP-extension logon in addition to ARC-1's.

### Option 0b — local mirror (also no extension)

`ARC1_MIRROR_DIR`: ARC-1 writes every source it PUTs to a local git-tracked mirror
(the `setup-abap-mirror` skill's layout). VS Code's built-in Git shows every ARC-1 change as a normal diff,
`file:` links in chat are clickable (§3), and it works in Cursor/Claude Code/any editor. Cost: a second copy
of the truth; no ADT navigation on those files.

### Option 1 — the bridge extension (what was asked for)

One file, ~200 LOC, no dependency on SAP's extension internals beyond the `abap:` scheme:

```ts
// 1. read-only buffers for before/after
workspace.registerTextDocumentContentProvider('arc1', { provideTextDocumentContent: uri => buffers.get(uri.path) });

// 2. journal watcher → diff editor pops automatically, no model involvement
watcher.onDidCreate(async f => {
  const c = JSON.parse(await readFile(f));            // { dest, type, name, before, after }
  buffers.set(`/before/${c.name}`, c.before); buffers.set(`/after/${c.name}`, c.after);
  commands.executeCommand('vscode.diff',
    Uri.parse(`arc1:/before/${c.name}`), Uri.parse(`arc1:/after/${c.name}`),
    `${c.name} — ARC-1 change`);
});

// 3. clickable link in Copilot chat
window.registerUriHandler({ handleUri: u => openObject(new URLSearchParams(u.query)) });
// → vscode://arc-mcp.arc1-bridge/open?dest=A4H&name=ZCL_FOO

// 4. open the real ABAP editor: match an open tab, else walk abap: workspace folders
//    with workspace.fs.readDirectory; fall back to the arc1: buffer.
```

Optional 5th piece: `contributes.languageModelTools` + `lm.registerTool('arc1_showDiff')` so the model can
also trigger the diff on demand — but the watcher already covers the common case without spending tokens or
depending on tool-call reliability.

**ARC-1 side (small):** emit the journal entry on every successful `SAPWrite`. The pieces exist —
`src/adt/source-diff.ts` (`unifiedDiff`) and the shipped `SAPRead action="diff"` (active-vs-inactive,
`src/adt/version-diff.ts`). Needs one pre-write GET of the current source (already ETag-cached) plus a
`ARC1_WRITE_JOURNAL_DIR` config option, and the tool result should carry the `vscode://…` link with a tool
description instructing the model to print it.

## Recommendation

Option 0 first — it costs nothing and is what SAP designed for. Build Option 1 only for the ARC-1-only
workflows (writes outside the workspace, batch creates, RAP scaffolding, remote/BTP targets), and start with
the journal watcher + `UriHandler`; skip the LM tool until the watcher proves insufficient.

## Open items to spike (≤20 LOC each)

1. Does a `vscode://ext.id/…` markdown link actually render clickable in a Copilot chat *answer* (not just
   survive rewriting)? §3 says the scheme is allow-listed; rendering path unverified.
2. Do `copilot_applyPatch` / `copilot_editFiles` accept `abap:` URIs? SAP's agent file assumes yes.
3. `adt-vscode.forceRefreshRelatedFiles` — argument shape, so the bridge can refresh an open ABAP editor
   after an ARC-1 write.
