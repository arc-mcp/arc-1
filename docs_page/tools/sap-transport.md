# SAPTransport

Inspect and manage CTS transport requests. Start with `list`, `get`, or `check`; mutations also require `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_TRANSPORT_WRITES=true`.

```text
SAPTransport(action="list")
```

In multi-target v1, only the read-only `list`, `get`, `check`, and `history` actions are listed and
accepted. Transport mutations and topology actions remain structurally unavailable; `diff` is also
excluded there because it fans out many source reads per call.

## `action="diff"` — reviewing what a transport changed

Returns, per object, a unified diff between the revision written under the transport and the one
immediately before it. LIMU entries (methods, class includes) are rolled up to their owning class,
and a class is diffed across the includes the transport actually touched.

Every part carries the evidence behind its diff — read `baselineStatus` before summarising:

| `baselineStatus` | Meaning |
|---|---|
| `prior-revision` | The diff is what this transport changed. |
| `prior-revision-unverified` | A predecessor exists, but the "after" side was only guessed — it may belong to another change. |
| `no-prior-snapshot` | Created in this transport. |
| `baseline-ambiguous` | No usable baseline. An all-additions block is **not** proof of creation. |
| `baseline-unavailable` | The read failed. Never report this as unchanged. |

Objects with no source revision feed (domains, data elements, function-group sources, …) are returned
with an `inventoryReason` instead of parts: they are in scope, just not diffable. Long diffs are
truncated per part with `diffTruncated: true`; `added`/`removed` still reflect the full change.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `list`, `get`, `diff`, `create`, `release`, `delete`, `remove_object`, `reassign`, `release_recursive`, `check`, `history`, `layers`, or `targets` (the last two are advertised only when transport support is enabled) |
| `id` | string | No | Transport request ID, e.g. `A4HK900123` (for get/diff/release/delete/remove_object/reassign/release_recursive) |
| `offset` | number | No | For `diff`: index of the first object to diff (default 0). Page with `limit`. |
| `limit` | number | No | For `diff`: objects per call (default 20, max 40 — the same ceiling SAP's own transport-diff tool uses). |
| `description` | string | No | Transport description text (required for create) |
| `name` | string | No | Object name (for check/history/remove_object actions, e.g. `ZCL_ORDER`) |
| `package` | string | No | Package name. For `create`: optional — defaults to `$TMP`; an explicit package influences the route/target while the request remains Workbench type K. For `check`: required. |
| `target` | string | No | Explicit create target (`C11`, `C11.021`, or `/TRG/`). SAP validates it; system.client/group forms require extended transport control, and 7.50 does not support the target-setting ADT action. Discover valid values with `action="targets"`; never invent one. |
| `transportLayer` | string | No | Advanced create override for SAP's consolidation-route resolution. Omit normally so the package chooses the route; discover valid values with `action="layers"`. |
| `user` | string | No | SAP username to filter by (for list). Defaults to the current SAP user. Use `*` to list all users. |
| `status` | string | No | Transport status filter (for list). `D`=modifiable (default), `L`=modifiable/protected, `O`=release started, `P`=release preparation, `R`=released, `N`=released with import protection, `*`=all statuses. |
| `type` | string | No | Object type for `check`/`history`/`remove_object` actions (`PROG`, `CLAS`, `DDLS`, etc.). For `remove_object` it is the CTS/E071 object type exactly as shown by `get` (e.g. `PROG`, `DEVC`). Not used by `create`, which creates a Workbench (K) request. |
| `operation` | string | No | For `check`: `create` (default, sends ADT operation `I`) or `modify` (sends the empty modify operation). |
| `pgmid` | string | No | Program ID for `remove_object`: `R3TR` (whole object) or `LIMU` (sub-object). Required for `remove_object` — the object type alone does not determine `pgmid`. |
| `owner` | string | No | New owner SAP username (required for reassign) |
| `recursive` | boolean | No | Apply recursively to child tasks (for delete/reassign). `release_recursive` always recurses. |
| `removeLockedObjects` | boolean | No | For delete: remove locked object entries from each task before deleting when SAP would otherwise reject the request as containing locked objects. This mutates request contents. |
| `summary` | boolean | No | For `list` only. **Default `true`** — headers-only: omits each transport's (and task's) `objects[]`, keeping `id`/`description`/`owner`/`status`/`target` plus an `objectCount`. Pass `false` for full object lists (~5x larger). |
| `maxResults` | number | No | Maximum list rows or check/history assignment candidates (defaults: list/history 50, check 10; max 1000). |
| `resultFormat` | string | No | For `release`/`release_recursive`: `legacy` text (default) or `structured` JSON with outcome, per-ID confirmation evidence, polls, elapsed time, and SAP reports. |
| `timeoutSeconds` | number | No | For `release`/`release_recursive`: terminal-state verification budget; default `300`, range `1..1800`. |

## Actions

- **`list`** — List transport requests. Defaults to current user, modifiable (status D), all types (Workbench, Customizing, Transport of Copies). Returns a paged envelope `{total, shown, truncated, transports}` — `total` is the full backlog, so a capped page still reports it. Summarised by default (object lists dropped, `objectCount` kept): scan cheaply, then `get` the one you want in full; pass `summary=false` for the object lists. Paged at `maxResults` (default 50, max 1000). Live: 55 requests went 104 KB / ~26K tokens → 23 KB / ~5.7K tokens.
- **`get`** — Get transport details including tasks and objects.
- **`create`** — Create a new Workbench (K) transport request. Requires `description`. Optional `package` (defaults to `$TMP` — pass an explicit package to influence the transport route/target, not the request category). Uses the ADT `CreateCorrectionRequest` endpoint (`POST /sap/bc/adt/cts/transports`); legacy NW 7.50 systems are supported.
- **`release`** — Release a single request or task, then verify terminal CTS evidence. Requests are read back in `R` or `N`; released tasks may disappear from SAP's organizer tree and are then confirmed only after an accepted release report. Timeout, unknown state, or unexplained disappearance is an error. Use `resultFormat="structured"` for convergence evidence.
- **`delete`** — Delete a transport. Use `recursive=true` to delete tasks first. `removeLockedObjects=true` first strips locked entries from each task when necessary; it is not a dry-run option.
- **`remove_object`** — Remove a single object from a request while **keeping the request** (the SE09/SE10 "remove from request" operation). Requires the full CTS object key `pgmid` + `type` + `name` (the object type alone does not determine `pgmid` — e.g. `COMM` is valid under both `R3OB` and `LIMU`). ARC-1 resolves the entry from the request's object list and removes it via the ADT `removeobject` operation; the object itself is **not** deleted. Functional on SAP_BASIS 7.58/8.16; on NW 7.5x the backend ignores `removeobject` (HTTP 400) — clean such requests in SE09/SE10.
- **`reassign`** — Change transport owner. Requires `owner`. Use `recursive=true` for tasks too.
- **`release_recursive`** — Freeze the original parent/task tree, release its unreleased tasks first and then the parent, and verify every frozen ID. Requests must be read back in terminal `R` or `N`; released tasks that SAP folds out of the tree are confirmed by an accepted task release or the terminal parent. An unexplained disappearance, timeout, or unknown state is an error. This action is refused under restrictive exact/prefix `SAP_ALLOWED_TRANSPORTS`; only the legacy empty allowlist or explicit `*` can authorize a live subtree that may gain a concurrent child. Use either only when every current/concurrent child is intended to be released.
- **`check`** — Check whether a transport is required for creating or modifying an object in a specific package. Requires `type`, `name`, and `package`; `operation` defaults to `create`. Returns whether a transport is required, whether a new assignment is required, local-package status, bounded candidate requests, SAP diagnostics, and any existing lock with owner/task details. **Does NOT require `--allow-transport-writes`** — this is a read-only pre-flight check.
- **`history`** — Legacy action name for current object transport status. Given `type` + `name`, it returns at most the request currently holding the object lock in `relatedTransports`, plus bounded `candidateTransports` the object could be assigned to. Candidates do **not** contain the object and are not historical/conflict evidence. Complete history requires an authorized E071/E070 data workflow because the standard ADT endpoints expose only current assignment state. Read-only; does NOT require `--allow-transport-writes`.
- **`layers`** — List the transport layers and their resolved targets where available. Read-only value help for `create.transportLayer`; release-dependent.
- **`targets`** — List valid transport targets (Transportziel / TR_TARGET). Read-only value help for `create.target`; release-dependent.

## Check action output

```json
{
  "operation": "create",
  "package": "ZDEV",
  "transportRequired": true,
  "transportAssignmentRequired": true,
  "isLocal": false,
  "deliveryUnit": "HOME",
  "result": "S",
  "existingTransportTotal": 1,
  "existingTransportsShown": 1,
  "existingTransports": [
    { "id": "A4HK900123", "description": "My transport", "owner": "DEVELOPER" }
  ],
  "existingTransportsTruncated": false,
  "summary": "Package \"ZDEV\" requires a transport assignment for object creation."
}
```

## Current object transport status output (`history` legacy action name)

```json
{
  "object": { "type": "CLAS", "name": "ZCL_ORDER", "uri": "/sap/bc/adt/oo/classes/zcl_order" },
  "relatedTransports": [],
  "candidateTransports": [
    { "id": "A4HK900124", "description": "Refactor", "owner": "DEVELOPER" }
  ],
  "candidateTotal": 1,
  "candidateTruncated": false,
  "summary": "Object ZCL_ORDER has no active lock; 1 transport(s) available for assignment."
}
```

When an object is currently locked, `lockedTransport` is present, `relatedTransports` contains that
one parent request, and `candidateTransports` is empty.

**List defaults:** Without parameters, `list` returns modifiable transports (status D) for the current SAP user, across all transport types (Workbench, Customizing, Transport of Copies). Query params follow sapcli's `workbench_params()` pattern (`requestType=KWT`, `requestStatus`).

**Protocol compatibility:** ARC-1 uses startup ADT service discovery (`/sap/bc/adt/discovery`) to proactively select endpoint MIME types, with endpoint-specific CTS media types and a one-retry 406/415 fallback as defense-in-depth.

**Note:** Transport mutations (`create`, `release`, `release_recursive`, `reassign`, `delete`, `remove_object`) require `write` + `transports` scopes and both `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_TRANSPORT_WRITES=true`. `list`, `get`, `diff`, `check`, `history`, `layers`, and `targets` are read actions and work without `--allow-transport-writes`.


`history` reports current object lock and assignment status; it is not a complete transport history. `create` uses the ADT `CreateCorrectionRequest` endpoint on NetWeaver 7.50 and newer.

[All tools](../tools.md)
