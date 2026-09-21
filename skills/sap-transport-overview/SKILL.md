---
name: sap-transport-overview
description: System-wide inventory of open transport requests — every visible modifiable request, who owns it, how big it is, and supported risk signals such as empty/local requests, explicit locks, and confirmed manifest overlaps. Headers-only and cheap; NO source diffs. Use when asked "what transports are open in the system", "show all open transports", "transport backlog", "what is everyone working on", "basis transport overview", "which requests are ready to release", or "find import-order conflicts".
---

# SAP Transport Overview (system-wide)

A basis-/lead-oriented **register of every open transport** in the system: who owns what, how large
each request is, and where the risks are — without ever pulling source or diffs. It's deliberately
breadth-first and token-cheap, built on one call:

- `SAPTransport(action="list", summary=true, user="*", status="D")` — every modifiable request, all
  users, with `objects[]` omitted and an `objectCount` kept. (On a busy system the full object-laden
  list is ~25K tokens; summary cuts it to a few KB — see ARC-1 PR #448.)

This is the **breadth** companion to [sap-transport-review](../sap-transport-review/SKILL.md) (which is
**depth** — diffs of one transport's objects). Overview answers "what's open and risky across the
landscape"; review answers "what exactly changed in this one." Don't diff here.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Users | all (`user="*"`) | Basis cares about the whole system, not one developer |
| Status | modifiable (`status="D"`) | Open/unreleased work; pass `status="R"` for released, `"*"` for both |
| Payload | `summary=true` | Inventory needs counts + headers, never source — keeps a 100-request list cheap |
| Diffs | never | That's [sap-transport-review](../sap-transport-review/SKILL.md)'s job; this skill stays breadth-only |
| Grouping | by owner | The basis mental model: "whose requests, how many, how big" |

## Input

Optional narrowing — apply if given, else default to the whole system:

- **Owner / user** — one developer's open requests.
- **Status** — `D` (default), `R` (released), `*` (all).
- **Description / size / target filter** — e.g. "matching 'migration'", "more than 20 entries", or
  "without a target". The current transport payload has no age or object-package field, so do not
  offer age/package filtering without a separate authoritative data source.

**Scope guard:** the system-wide list can be hundreds of requests. Always start with `summary=true`.
If it's still large, aggregate (counts per owner, top-N by `objectCount`) and offer to filter — never
expand every request's object list unprompted.

## Step 1: The register (cheap, always)

```
SAPTransport(action="list", summary=true, user="*", status="D")
```

Returns one row per request: `id`, `description`, `owner`, `status`, `target`/`targetDesc`,
`objectCount` (+ per-task counts). That alone answers "what's open and how big" for the whole system.

## Step 2: Expand only what matters (still no diffs)

For requests the user flags (or the suspicious ones from Step 3), pull the full object list:

```
SAPTransport(action="get", id="<id>")
```

This lists CTS entries (`pgmid`, `type`, `name`, `wbtype`, `locked`) — the *contents*, not source or
package metadata. Only `get` the handful in focus; do not `get` the whole system.

## Step 3: Risk / health flags (the basis value)

These are what an overview is *for*. Derive from the data already gathered:

- **Confirmed exact overlap** — after explicitly expanding the in-scope requests, the same exact CTS
  key (`pgmid`, `type`, `name`) occurs in two manifests. This can create import-order risk. Raw-key
  intersection is conservative: it can miss conceptual overlaps represented once as `R3TR` and once
  as `LIMU`/language subobjects, so label the result "exact CTS-key overlap", not exhaustive conflict
  detection.
- **Empty requests** (`objectCount` 0) — cleanup candidates (delete or release).
- **Explicitly locked objects** (`locked: true` from `get`) — may block other developers. On older
  releases `tm:lock_status` can be absent, so `locked: false` does not prove that an entry is unlocked.
- **No target** (`target` empty) — a *local* request that cannot be transported onward (often a mistake for work meant to ship).

`SAPTransport(action="history", type=…, name=…)` is **current assignment status**, despite the legacy
action name: `relatedTransports` contains at most the current lock request, while
`candidateTransports` are requests the object could be assigned to. Candidates do not contain the
object and are not conflict/history evidence. Full historical membership requires E071/E070 access;
the standard ADT endpoints used here do not provide it.

Do not infer `$TMP` from a transport manifest: CTS entries do not expose package, and local-package
objects normally are not transport contents. Resolve package separately before making such a claim.

## Step 4: Report

```markdown
# Open transports — <SID>  (<N> requests, <M> objects, <K> owners)

## By owner
| Owner | Requests | Objects | Notable |
|---|---|---|---|
| MARIAN | 6 | 41 | 1 empty, 1 local request |
| ANNA   | 2 | 8  | |

## Register
| Request | Owner | Description | Objects | Target | Flags |
|---|---|---|---|---|---|
| A4HK900123 | MARIAN | Sales order RAP | 12 | LOCAL | ⚠ no target — won't ship |
| A4HK900200 | ANNA   | Pricing fix     | 3  | C11   | ⚠ ZCL_PRICE also in A4HK900123 |

## Needs attention
- ⚠ Exact CTS key R3TR/CLAS/ZCL_PRICE is in 2 expanded requests (A4HK900123, A4HK900200) → possible import-order conflict; sequence or consolidate.
- ⚠ A4HK900155 (MARIAN) is empty → delete or release.
- ⚠ A4HK900123 has no target → local request; confirm it is not intended for downstream import.
```

Write to disk only if asked; otherwise return inline.

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `list` returns very many requests | Busy system | Keep `summary=true`; aggregate per owner + top-N by size; offer to filter |
| `user="*"` returns only my requests | Backend ignored the unfiltered query / scope limits | Confirm the SAP user may see others' requests (`S_TRANSPRT`); some systems restrict cross-user listing |
| `get` slow across many requests | Expanding too much | Only expand the flagged/in-focus requests, never the whole system |
| `history` returns many candidates | Candidates are assignment choices, not containing requests | Do not use them as history/overlap evidence; compare explicitly expanded manifests |
| Need released requests too | Default is `D` only | Re-run `list` with `status="R"` or `status="*"` |

## When to use this skill

- Basis / release manager: "what's open across the system, and what's risky to import?"
- Team lead: "what is everyone working on right now?" / backlog and cleanup review.
- Pre-import / pre-go-live: find object overlaps and local-only requests before a transport wave.

## When NOT to use this skill

- **What exactly changed in a request** (source diffs) → [sap-transport-review](../sap-transport-review/SKILL.md).
- **One object's complete history** ("which transports touched ZCL_X") → not available from the
  standard ADT history action; use an authorized E071/E070 data workflow or an external CTS report.
- **One object's current lock/assignment status** → `SAPTransport(action="history", type=…, name=…)`.
- **Cross-system** (is DEV ahead of QAS) → out of scope: ARC-1 binds one system per instance; run the CLI against each system and compare.

## Follow-up Options

- "Review the actual changes in one of these?" → [sap-transport-review](../sap-transport-review/SKILL.md).
- "Release the ready ones?" → `SAPTransport(action="release")` / `release_recursive`.
- "Clean up the empty ones?" → `SAPTransport(action="delete")`.
