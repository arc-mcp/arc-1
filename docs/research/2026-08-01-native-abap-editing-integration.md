# Research: how close can ARC-1 + IDE get to native Copilot editing for ABAP?

Dated 2026-08-01. Verified against **VS Code 1.129.1**, built-in **copilot-chat 0.57.0**,
**`sapse.adt-vscode` 1.1.1**, **Copilot for Eclipse 0.20.0**, ADT for Eclipse 3.5x.
Companion to `2026-07-31-vscode-arc1-diff-bridge.md`, which covers the plumbing already built
(`~/DEV/arc1-abap-bridge`, v0.4.0, working against a4h).

## The question

Get ABAP as close as possible to what Copilot does natively for a TypeScript file: the model edits,
you see inline hunks with Keep/Undo, changed files are listed in chat and clickable, links open at the
right line. Which parts are reachable, with what, and what is simply closed off.

## The one gate that decides everything

Copilot's edit UI — inline hunks, Keep/Undo, the edited-files list, the undo stop — is rendered only for
edits produced by **its own edit tools** (`copilot_applyPatch`, `copilot_editFiles`, `copilot_insertEdit`,
`copilot_createFile`) acting on a **workspace URI**. Verified two ways:

1. **The stable VS Code API has no edit-carrying chat part.** The complete stable set is
   `ChatResponseMarkdownPart`, `AnchorPart`, `ProgressPart`, `ReferencePart`, `FileTreePart`,
   `CommandButtonPart`. Nothing that carries a text edit.
2. **Everything that could carry one is proposed API.** Copilot itself enables **63 proposals**, among them
   `chatParticipantAdditions` (where the edit parts live), `chatSessionsProvider`, `mappedEditsProvider`,
   `contribLanguageModelToolSets`. Proposed APIs cannot be published to the Marketplace — they need
   `--enable-proposed-api` or an allowlist entry.

There *is* an internal `kind:"externalEdit"` chat part carrying `beforeContentUri`/`afterContentUri`/
`diff:{added,removed}`/`undoStopId` — it is how external agent CLIs surface their edits natively. It is fed
from the **AHP `chatSessions`** protocol (`content[].type === "fileEdit"`), which is `chatSessionsProvider`,
i.e. proposed. **Not reachable for a distributable extension.**

> **Consequence — the whole strategy follows from this.** Do not try to *push* an edit into Copilot's UI.
> Instead make Copilot's own edit tools do the write, and have ARC-1 feed them. In VS Code that is
> possible today because `sapse.adt-vscode` registers `abap:` as a **writable** `FileSystemProvider`
> (`registerFileSystemProvider(oe, this, {isCaseSensitive:true})`) — an ABAP object in a workspace folder
> *is* a workspace URI. SAP designed for exactly this: their shipped `abap-developer.agent.md` says
> *"Always add and edit source code via the VS Code editor."*

## Verified capability matrix

| Capability | VS Code | Eclipse |
|---|---|---|
| ABAP object is a workspace file Copilot's edit tools can target | **Yes** — `abap:` writable FS provider | **No** — ADT editors are not `IFile`s; Copilot works on the open *document* |
| Native inline diff + Keep/Undo for model edits | **Yes**, via Copilot's edit tools | Yes for its own edits (`ChangedFiles`, `DiffModel`, `DiffPopup`, `EditableFileCompareInput`, `UndoableTextViewer` in `copilot.eclipse.ui`) |
| Third party can register a tool the assistant calls | **Yes** — `lm.registerTool` (stable) | **No** — Copilot for Eclipse declares *zero* extension points |
| Third party can reach the assistant at all | tools, MCP | **MCP only** (54 MCP classes incl. `McpServerToolsCollection`, `McpResource`, `IMcpConfigService`) |
| Open an object by name from code | hard — no public resolver; solved by the bridge | **easy** — `com.sap.adt.tools.core.ui.navigation` is exported with **no `x-friends`** restriction |
| Show a diff from code | `vscode.diff` | `org.eclipse.compare.CompareUI` + ADT's own version compare |
| Clickable link in chat that opens the object | **Yes** — `vscode://<ext>/…`, verified live | ADT link (`shareLink` / `openWithAdtForEclipse`) — format is LS-side, capture it from the command |
| Extension can call another tool without a model turn | **Yes** — `lm.invokeTool` works for MCP tools too (already used to fetch the package) | via MCP client only |

## Strategy: invert the write path

Today ARC-1 writes source over ADT REST and the IDE learns nothing. The closest-to-native arrangement is
the opposite:

```
ARC-1  = read, search, where-used, SQL, lint, ATC, transports, activation,
         CDS/RAP intelligence  +  PROPOSE source for its smart transforms
Copilot = performs the actual text write, through its own edit tools
Bridge  = makes sure the right file is open/targeted, and shows diffs for
          the cases where ARC-1 did write after all
```

ARC-1 keeps its unique value (method-level surgery, class-section splice, RAP scaffolding, batch create,
AFF validation) — it just returns the resulting source instead of PUTting it, and lets Copilot apply it.
That single change turns every ARC-1 transform into a natively-rendered edit.

## Ladder of changes, cheapest first

### Rung 1 — system instructions only (no code)

Already partly done (`copilot-instructions.md`, shipped by the bridge). Extend to state the split above,
and specifically: *when an object is reachable in the workspace, never write it through ARC-1 — read it,
decide the change, and apply it with your normal edit tools.* Cost: minutes. Gets: full native diff for
ordinary edits.

Weakness: instruction-following is probabilistic. Observed live — asked to "show what changed", Copilot
picked ARC-1's `SAPRead action="diff"` (text) over the bridge's `abapChanges` (diff editor) until the tool
descriptions were rewritten to split them by *audience*. Tool descriptions beat instructions.

### Rung 2 — ARC-1 `dryRun` / propose mode  ← highest leverage

`SAPWrite(..., dryRun: true)` performs every gate and transform but **returns the resulting full source
plus a unified diff instead of writing**. `src/adt/source-diff.ts` (`unifiedDiff`) already exists, and
`SAPRead action="diff"` proves the shape.

Why it matters: `edit_method`, `edit_section`, RAP scaffolding and `batch_create` are real intelligence
that Copilot cannot replicate. Dry-run lets that intelligence flow through Copilot's edit pipeline, so the
user gets native hunks and Keep/Undo on an ARC-1-quality change. Without it, every ARC-1 transform is
invisible.

Also worth returning `package` on `SAPRead`/`SAPWrite` results (search already returns `packageName`), so
links can be built without a second lookup.

### Rung 3 — bridge: target the file for Copilot

The bridge already resolves name → `abap:` URI and opens it (v0.4.0). Additions, all small:

- **`line`/`method` in the deep link and the open tool** — reveal a range, so links land on the right line
  rather than the top of the file.
- **Attach-to-chat** — opening is not the same as being in Copilot's working set. Worth testing whether an
  open editor is enough for `copilot_applyPatch` to target it, or whether the file must be attached.
- **Post-write refresh** — after any ARC-1 write, call `adt-vscode.forceRefreshRelatedFiles` so the open
  editor is not stale. Takes no arguments and acts on the active editor, so the object must be shown first.

### Rung 4 — ARC-1 write journal + auto-diff

For writes that must stay server-side (BTP targets, objects outside the workspace, batch creates,
activation-time changes): `ARC1_WRITE_JOURNAL_DIR` drops `{dest, type, name, before, after}` per write; the
bridge already watches it (`arc1AbapBridge.journalDir`) and pops a diff with zero tokens and no model
involvement. Only unbuilt half is the ARC-1 emitter.

### Rung 5 — IDE links in ARC-1 output

Config `ARC1_IDE_LINKS = off | vscode | eclipse`. ARC-1 knows the ADT object URI, so it can append a
clickable link to read/write results:

- **VS Code** — `vscode://marianfoo.arc1-abap-bridge/open?name=…&package=…` (scheme is allow-listed in
  chat's markdown rewriter; verified clickable live).
- **Eclipse** — the canonical ADT link. Its exact shape is built inside the ADT language server and is not
  a literal in any shipped jar; capture it once by running **ABAP: Share Link…** → *Copy ADT Link*.

This is the most direct answer to "show a link in chat you can click", and it works for any MCP client,
not just the two IDEs.

### Rung 6 — Eclipse plugin (only if Eclipse matters)

Copilot for Eclipse has no extension points but full MCP support, so the shape inverts: an Eclipse plugin
that **hosts a small MCP server in-process**, which Copilot connects to. Tool calls then run inside the
workbench with full access. Precedent: SAP's own ADT MCP server runs in-process in Eclipse (port 2234).

The core logic is far *simpler* than the VS Code bridge — `com.sap.adt.tools.core.ui.navigation` is public
API, so name→object navigation is one call, and `CompareUI` handles diffs. The cost is packaging: OSGi
bundle, Java, Tycho/PDE, update site, versus 400 lines of plain JS with no build. And the payoff is
smaller, because ADT *is* native there and already has version compare.

## What is out of reach, so nobody spends time on it

| Wish | Why not |
|---|---|
| Push an ARC-1 write into Copilot's Keep/Undo UI | needs `chatParticipantAdditions` / `chatSessionsProvider` — proposed, not publishable |
| MCP `resource_link` pointing at the ABAP file | VS Code rewrites every one to `mcp-resource://` and reads it back through the server |
| `command:` links in a model answer | needs trusted markdown; model output is untrusted |
| Reuse SAP's own name→URI resolver | `adtLs/repository/quickSearch` is language-server-side, no public API, no `registerUriHandler` |
| Copilot for Eclipse calling a local plugin directly | zero extension points; MCP is the only door |

## Recommended sequence

1. **Rung 2 in ARC-1** (`dryRun`) — biggest jump toward native, and useful to every MCP client.
2. **Rung 1 + rung 3** — instructions and bridge polish to make the model actually take that path.
3. **Rung 5** (`ARC1_IDE_LINKS`) — cheap, and serves Eclipse and non-IDE clients too.
4. **Rung 4** (journal) — closes the gap for writes that cannot go through the editor.
5. **Rung 6** only if Eclipse becomes a primary target.

## Open items to verify

1. Do `copilot_applyPatch` / `copilot_editFiles` actually accept `abap:` URIs? SAP's shipped agent file
   assumes yes; never confirmed live. **This is the load-bearing assumption of the whole strategy** — test
   it before building rungs 2–3.
2. Does an object have to be attached to the chat context, or is an open editor enough for the edit tools
   to target it?
3. Does Copilot for Eclipse's inline edit work inside an ADT editor, given ADT documents are not `IFile`s?
