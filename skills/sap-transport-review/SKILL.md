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
| **Reviewing a transport** (senior dev / approver) | one transport id | Diff every diffable object **+ impact + ATC by default** — risk-focused. The chat / whole-transport twin of Eclipse ADT 3.6's "Object Changes" tab (same per-object diffs, **same coverage boundary**). |
| **Checking your own recent work** (dev) | your modifiable transports | "What have I changed since my last release?" — diff each object's last-released version → current. Light: skip impact/ATC unless asked. |

For a **system-wide inventory of every open transport** (basis: who has what open, how big, conflicts —
*no diffs*) that's a different job → [sap-transport-overview](../sap-transport-overview/SKILL.md).

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Transport scope | current user, modifiable (`status="D"`) | The work in progress, not released history |
| Overview first | `summary=true` when listing | Cheap scan before pulling any object list in full |
| Diff direction (in-flight) | `from="active"`, `to="inactive"` | "What I'm about to activate" — the reliable diff (no snapshot needed) |
| Diffable types | PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, BDEF, SRVD, DDLX, TABL | The plain-text source types `action="diff"` supports |
| Object-diff cap | ~40 | Above that, summarize counts and ask which to expand |
| Impact / ATC | **ON** in transport-review mode; off in the quick "what did I change" pass | A reviewer needs "what breaks / quality"; a dev glancing at their own drafts doesn't |

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

## Step 2: Classify the objects

Split the object list into:

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
| **In-flight** ("what I'm about to activate/release") | `active` → `inactive` | The reliable diff. No draft → "no pending changes" (clean). |
| **Since my last release** (dev's recent work) | `<last released revision id>` → `active` (or `inactive` if still draft) | "What changed after my last request." Last-released revision = newest `VERSIONS` entry carrying a transport title; captures both activated-since-release and pending edits. |
| **Released transport** ("what did this TR change") | `<pre-transport revision id>` → `active` | Get ids from `SAPRead(type="VERSIONS", name=…)`; SAP only snapshots on **release**. |
| **Specific revisions** | `<id\|uri>` → `<id\|uri\|active>` | From a VERSIONS response. |

**Snapshot-sparsity reality (important):** ABAP cuts a version snapshot only when a transport is
*released*. So for an open/unreleased transport, objects usually have just the active version (+ maybe
an inactive draft) — there is no "before" revision to diff against. Handle it honestly:

1. For each object, `SAPRead(type="VERSIONS", name=…, objectType=…)`. If ≥2 revisions exist, diff the
   pre-change revision → `active`.
2. If only 1 revision (the common case for unreleased work), fall back to `active` → `inactive` (shows
   the pending edit) and label it "pending (unactivated)".
3. If active == inactive and only 1 revision, report "no diff available (object created in this
   transport, or no prior snapshot)" — for a brand-new object, note it's an **add**, not a change.

## Step 4 (optional): impact + quality — only when asked or the change is risky

- **Impact** (a changed `DDLS`/`BDEF`/`SRVD` can break consumers): `SAPContext(action="impact", type="DDLS", name="<view>")` → projection views, BDEFs, service defs/bindings, ABAP consumers that depend on it.
- **Quality**: `SAPDiagnose(action="atc", ...)` per changed object → new ATC findings the change introduces; or `SAPLint(action="lint", name=…)` for a fast local pass.
- **Pre-release validity**: for unactivated work, `SAPActivate` (or `SAPDiagnose action="syntax"`) confirms the draft even compiles before you stake a release on it.

## Step 5: Write the report

```markdown
# Change review — <transport id or "pending drafts"> on <SID>

_<owner> · <status> · <description>_

## Summary

| Object | Type | Change | +/− | Flags |
|---|---|---|---|---|
| ZCL_ORDER | CLAS | changed | +12 −3 | |
| ZI_ORDER  | DDLS | changed | +4 −0  | impacts 3 consumers |
| ZNEW_REPORT | PROG | added  | —      | new in this transport |
| ZSTATUS   | DOMA | changed | —      | metadata — no source diff |
| ZHELPER   | PROG | $TMP   | —      | ⚠ local — will NOT transport |

## Diffs

### ZCL_ORDER (CLAS)  active → inactive  (+12 −3)
```diff
<the unified-diff hunks from SAPRead action="diff">
```
…one block per diffable object…

## Risk flags
- ⚠ ZHELPER is in $TMP — it will not travel with this transport.
- ⚠ ZI_ORDER (DDLS) has 3 downstream consumers — re-activation order matters (see impact).
- ⚠ ZCL_BP locked in 2 transports — possible import-sequence conflict.

## Verdict
<2–3 lines: what this change set does, what to review first, what's risky / not yet activated.>
```

Write to disk (default `docs/reviews/transport-<id>-<date>.md`) only if asked; otherwise return inline.

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `action="diff"` → "not supported for type X" | Metadata type (DOMA/DTEL/MSAG/SRVB/VIEW/…) | Expected — list it as "metadata — no source diff", don't diff |
| "No differences between active and inactive" | No unactivated draft for that object | Report "no pending changes"; it's already activated |
| "Revision-id diff is not available for type X" | FUGR/DDLX have no revisions feed | Use `active`/`inactive` or a full `/sap/bc/adt/` URI instead of a bare id |
| VERSIONS returns 1 revision | Snapshot only cut on release (sparsity) | Fall back to active→inactive; label new objects as adds |
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
