---
name: sap-transport-review
description: Review what actually changed — in a transport, or in your unactivated drafts — by diffing each object's source and summarizing the change set with optional impact and quality signals. Produces a reviewable report (per-object unified diffs + risk flags), not a raw object dump. Use when asked to "review this transport", "what changed in TR X", "diff the objects in a transport", "show my pending changes before I activate/release", "prepare a transport/change review", or "what am I about to ship".
---

# SAP Transport / Change Review

Answer "what actually changed?" for a transport or for your in-flight (unactivated) work, as a
**reviewable report**: a per-object unified diff plus risk flags — not a wall of full source.

It leans on two token-cheap ARC-1 primitives so a review of a 30-object transport costs a handful
of small diffs instead of 60 full-source reads:

- `SAPTransport(action="list", summary=true)` — scan many open transports cheaply (objects omitted, `objectCount` kept), then drill into one.
- `SAPRead(action="diff", from=…, to=…)` — server-side unified diff per object; the response is just the hunks.

Complements [explain-abap-code](../explain-abap-code/SKILL.md) (deep single-object understanding) and
[sap-object-documenter](../sap-object-documenter/SKILL.md) (written docs for a package). This skill is
about **delta** — what moved between two points in time — for code review, hand-off, or a pre-release gate.

## Pick the mode (who's asking)

| You are… | Scope | What the skill does |
|---|---|---|
| **Reviewing a transport** (senior dev / approver) | one transport id | Diff every safely resolved source object, label the version coverage, and add impact/quality checks only when requested or risk-triggered. The chat / whole-transport twin of Eclipse ADT 3.6's "Object Changes" tab (same source-diff coverage boundary). |
| **Checking your own recent work** (dev) | your modifiable transports | "What have I changed since my last release?" — diff each object's last-released version → current. Light: skip impact/ATC unless asked. |

For a **system-wide inventory of every open transport** (basis: who has what open, how big, conflicts —
*no diffs*) that's a different job → [sap-transport-overview](../sap-transport-overview/SKILL.md).

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Transport scope | current user, modifiable (`status="D"`) | The work in progress, not released history |
| Overview first | `summary=true` when listing | Cheap scan before pulling any object list in full |
| Diff direction (in-flight) | `from="active"`, `to="inactive"` | Exact for pending, unactivated source only; it does not reconstruct changes already activated in an open request |
| Diffable types | PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, BDEF, SRVD, DDLX, TABL | The plain-text source types `action="diff"` supports |
| Object-diff cap | ~40 | Above that, summarize counts and ask which to expand |
| Impact | On for changed CDS/RAP objects in a risk-focused review; otherwise opt-in | Focus the extra reads where dependency risk exists |
| ATC | Opt-in (`+atc`) or clearly risk-triggered; bounded to changed objects | ATC is workload-producing and must not fan out silently across a large request |

## Input

The user provides **one of**:

- **A transport id** (e.g. `A4HK900123`) — review everything in that request.
- **"my pending changes" / "before I activate"** — review unactivated drafts (active → inactive).
- **An object list or package** — review those objects' pending changes.
- **Nothing specific** ("what changed") — list the user's modifiable transports (summary) and ask which one, or default to pending drafts.

Optional: `+impact` (who consumes the changed CDS/RAP), `+atc` (new quality findings), output path for a Markdown file.

**Scope guard:** if the selected set exceeds ~40 diffable objects, show the object table with `+/-`
counts only and ask which objects (or which task) to expand into full diffs. A review nobody reads is
worse than no review.

## Step 1: Resolve scope

- **Transport id given** → `SAPTransport(action="get", id="<id>")` → the `tasks[].objects[]` list.
- **"what changed" / pick a transport** → `SAPTransport(action="list", summary=true)` → a cheap table
  (`id`, `description`, `owner`, `status`, `objectCount`). Present it, let the user pick, then `get` that one.
- **Pending changes / package** → enumerate the objects the user touched (the transport's object list,
  or the objects in the named package). No transport id needed for the diff itself.

## Step 2: Normalize CTS entries, then classify

`SAPTransport get` returns **CTS identities**, not guaranteed `SAPRead` inputs. Each entry has
`pgmid`, CTS `type`, `name`, and `wbtype`; real transports may also contain subobjects such as
`LIMU/METH`, `LIMU/REPS`, language entries, and package/metadata entries.

Before diffing:

1. Flatten `tasks[].objects[]`, but keep the task id and original CTS key for the report.
2. Treat supported `R3TR` entries (`R3TR/CLAS`, `R3TR/DDLS`, …) as direct repository objects and
   deduplicate exact repeats.
3. Never pass `pgmid` (`LIMU`, `LANG`), a CTS subtype (`METH`, `REPS`), or `wbtype` (`CLAS/OM`,
   `PROG/I`, …) to `SAPRead(type=…)`.
4. Fold a subobject into a direct parent entry only when the parent is unambiguous. If the response
   exposes only the subobject, report it as `parent resolution unavailable` rather than guessing a
   class/include name. This is a coverage limitation, not evidence that nothing changed.
5. Count both raw CTS entries and unique resolved repository objects; do not present entry count as
   a unique-object count.

Then split the resolved repository objects into:

- **Diffable** (source types above) → these get a real diff in Step 3.
- **Metadata-only** (SRVB, G4BA, SUSH, DOMA, DTEL, MSAG, VIEW, ENHO, AUTH, DEVC, server-driven, …) →
  `action="diff"` returns "not supported" (their read is parsed metadata/XML, not plain-text source).
  **This is exactly the boundary SAP's own Eclipse ADT 3.6 "Object Changes" has** — it prints
  *"Feature not supported for object …"* for these same types (e.g. SRVB). Don't try to diff them.
  For a thorough review, still read the object's metadata (e.g. `SAPRead(type="SRVB", name=…)`) so the
  report names *what* the object is and that it's in the change set — just without a source diff.

## Step 3: Diff each object — pick `from`/`to` by intent

Run these in parallel (each returns only hunks):

```
SAPRead(type="<type>", name="<name>", action="diff", from="<from>", to="<to>")
```

Choose the sides by what the user is reviewing:

| Intent | from → to | Notes |
|---|---|---|
| **Pending draft** ("what I'm about to activate") | `active` → `inactive` | Exact pending-source diff. No draft means "no pending source", not "the open transport made no changes". |
| **Since the latest released snapshot** | `<latest released revision id>` → `active` (or `inactive` if still draft) | Captures all changes since that release; it may combine multiple open requests and must be labelled that way. Confirm revision ordering/timestamps rather than assuming feed order. |
| **Released transport** ("what did this TR change") | `<revision immediately before TR>` → `<revision tagged with TR>` | Compare the transport's own released snapshot, not today's `active` source. If the matching snapshot/predecessor is ambiguous or absent, report the baseline gap. |
| **Specific revisions** | `<id\|uri>` → `<id\|uri\|active>` | From a VERSIONS response. |

**Snapshot-sparsity reality (important):** ABAP cuts a version snapshot only when a transport is
*released*. So for an open/unreleased transport, objects usually have just the active version (+ maybe
an inactive draft) — there is no "before" revision to diff against. Handle it honestly:

1. For each resolved object, query `SAPRead(type="VERSIONS", name=…, objectType=…)` where supported.
2. For a released request, locate the revision tagged with that request and its immediate predecessor.
   If either cannot be established, do not substitute current `active` source for an old transport.
3. For an open request, use `active` → `inactive` only for the pending portion. A prior released
   revision → `active` comparison is useful, but label it "since released snapshot" because it can
   include other open requests.
4. If there is no inactive delta and no trustworthy pair of snapshots, report `baseline unavailable`.
   Do not call it an add unless independent object metadata proves creation in this request.

The report must state its **coverage**: `pending draft`, `released snapshot`, `since released
snapshot (may span requests)`, or `baseline unavailable`.

## Step 4 (optional): impact + quality — only when asked or the change is risky

- **Impact** (a changed `DDLS`/`BDEF`/`SRVD` can break consumers): `SAPContext(action="impact", type="DDLS", name="<view>")` → projection views, BDEFs, service defs/bindings, ABAP consumers that depend on it.
- **Quality**: when the user requests `+atc`, or risk justifies it, run `SAPDiagnose(action="atc", ...)`
  only for the bounded changed set. Use `SAPLint(action="lint", name=…)` for a cheaper local pass.
- **Pre-release validity**: use the read-only `SAPDiagnose action="syntax"` check for unactivated work.
  `SAPActivate` mutates system state; run it only when the user explicitly asks to activate.

## Step 5: Write the report

```markdown
# Change review — <transport id or "pending drafts"> on <SID>

_<owner> · <status> · <description>_

_Coverage: <pending draft | released snapshot | since released snapshot | baseline unavailable>_

## Summary

| Object | Type | Change | +/− | Flags |
|---|---|---|---|---|
| ZCL_ORDER | CLAS | changed | +12 −3 | |
| ZI_ORDER  | DDLS | changed | +4 −0  | impacts 3 consumers |
| ZNEW_REPORT | PROG | unknown | —     | baseline unavailable |
| ZSTATUS   | DOMA | changed | —      | metadata — no source diff |
| <CTS subobject> | LIMU/METH | unresolved | — | parent resolution unavailable |

## Diffs

### ZCL_ORDER (CLAS)  active → inactive  (+12 −3)
```diff
<the unified-diff hunks from SAPRead action="diff">
```
…one block per diffable object…

## Risk flags
- ⚠ ZI_ORDER (DDLS) has 3 downstream consumers — re-activation order matters (see impact).
- ⚠ ZCL_BP appears in two explicitly expanded request manifests; current lock holder is A4HK900123.
- ⚠ A4HK900123 has no target — this is a local request and cannot be imported onward.

## Verdict
<2–3 lines: what this change set does, what to review first, what's risky / not yet activated.>
```

Write to disk (default `docs/reviews/transport-<id>-<date>.md`) only if asked; otherwise return inline.

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `action="diff"` → "not supported for type X" | Metadata type (DOMA/DTEL/MSAG/SRVB/VIEW/…) | Expected — list it as "metadata — no source diff", don't diff |
| "No differences between active and inactive" | No unactivated draft for that object | Report "no pending source"; do not infer that the open request made no activated changes |
| "Revision-id diff is not available for type X" | FUGR/DDLX have no revisions feed | Use `active`/`inactive` or a full `/sap/bc/adt/` URI instead of a bare id |
| VERSIONS returns 1 revision | Snapshot only cut on release (sparsity) | Use active→inactive only for a real pending draft; otherwise report `baseline unavailable` |
| Transport entry is `LIMU/*`, `LANG/*`, or only has a slash `wbtype` | CTS identity is not a `SAPRead` type | Fold into an unambiguous parent entry or report `parent resolution unavailable`; never guess |
| Transport `get` 404 | Wrong id / already deleted | Re-list with `summary=true` and confirm the id |
| >40 objects in scope | Review too large to read | Show the `+/-` table, ask which task/objects to expand |

## When to use this skill

- Pre-release / pre-activation gate — "show me everything I'm about to ship."
- Code review of a colleague's transport without leaving the chat — the headless / pasteable / whole-transport-at-once counterpart to Eclipse ADT 3.6's "Object Changes" tab (same per-object diffs, same coverage boundary).
- Hand-off / audit — a written delta of a change set.
- "What changed after my last request / since my last release?" (since-last-release mode).
- "I've been editing for an hour — what have I actually changed?" (pending-drafts mode).

## When NOT to use this skill

- **System-wide inventory of every open transport** (basis: who has what open, sizes, conflicts — no diffs) → [sap-transport-overview](../sap-transport-overview/SKILL.md). This skill is depth-on-one-transport; that one is breadth-across-the-system.
- **Understanding one object deeply** → [explain-abap-code](../explain-abap-code/SKILL.md).
- **Documenting a whole package** (not a delta) → [sap-object-documenter](../sap-object-documenter/SKILL.md).
- **Across multiple systems** (DEV vs QAS source compare) → out of scope here: ARC-1 binds to one system
  per instance. Do a cross-system review by running the ARC-1 CLI against each system (`arc1-cli call
  SAPRead … --url <sys>`) and diffing the two outputs — a separate orchestration, not this skill.

## Follow-up Options

- "Activate / release this once it looks right?" → `SAPActivate`, then `SAPTransport(action="release")`.
- "Who breaks if I change this CDS?" → `SAPContext(action="impact")` (or re-run with `+impact`).
- "Document these objects properly?" → [sap-object-documenter](../sap-object-documenter/SKILL.md).
- "Clean-core readiness of the changed objects?" → [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md).
