# ADR 0011 — Broader built-in mutations on pinned PP targets (shared-handler revision)

**Status:** Proposed. Replaces the per-resource adapter design of draft [PR #1142](https://github.com/arc-mcp/arc-1/pull/1142) and supersedes ADR-0010's CLAS/INTF adapter. Not accepted; needs security review.
**Date:** 12 November 2026 (revised 13 November 2026 after review and the first live run).
**Builds on:** [ADR-0010](0010-pinned-pp-multi-target-writes.md) — its access gates (who may write where) stay; its dedicated adapter is removed.
**Evidence:** implementation on `main` at `0698468a6` (uncommitted worktree, 13 November 2026):
**+169/−905 production lines (net −736)** in 17 `src/` files, six of them deleted (the ADR-0010
adapter, its request policy and the pinned mutation-context/facade layer). Unit tests: three new files
(704 lines) replace four deleted ones; tracked tests +142/−1,125. 267 per-family mock tests
(67 operations × package / request / no-replay checks), 7 HTTP-barrier tests, dispatch-recheck and
admission tests. First live run of `896320813` (A4H 758, pinned PP route, real XSUAA token): 12 pass,
2 fail, 3 not run; every refusal held. The two failures (text-pool activation, plain-403 resend) and
three review findings (lock request, `activationExecuted="false"`, `edit_content`) are fixed in
follow-up commits with mock tests; a re-run is pending.
**Plan:** [pinned writes through the shared handlers](../plans/2026-11-12-pinned-writes-shared-handlers.md).

## Context

The goal is single-target parity for built-in writes on opted-in pinned strict-PP targets. PR #1142
reaches it with a second pipeline: one dedicated adapter per resource family, each with its own
preflight, evidence parsing, read-back and outcome state machine. Measured against `main`:
+18,283 production lines, +32,156 unit-test lines, 78 `pinned-*` files (513 lines on `main`).
The cost grows with every admitted action, and every native rule the single-target handlers
already know has to be re-implemented and re-qualified.

Most of that code is general write hardening, not multi-target logic. Once a request is bound to
one target under the caller's own SAP identity, the write is the single-target PP case that ARC-1
already ships.

## Decision

Serve pinned writes with the existing single-target handlers: same actions, types, fields and
results. Multi-target adds six controls, each enforced at one place every handler passes through:

| Control | Where it lives |
|---|---|
| Who may write where: pinned route, strict PP, raw write scope, exact read and write target grants, destination opt-in | HTTP gate and `isOperationAllowed`, as in ADR-0010 |
| Admission: an explicit list of `Tool.action` keys (not `edit_content`); unknown fields and `preaudit=false` refused | `multi-target-write-surface.ts`; `handleToolCall` repeats the gate's decision for every tool |
| Package ceiling: server and destination rules, each against the real package | `checkPackage` / `enforceAllowedPackageForObjectUrl` (already dual on `main`) |
| Request ceiling: server and destination transport allowlists for every request ID ARC-1 sends or SAP returns from a lock | Caller-supplied requests at admission; every `corrNr` sent in `AdtHttpClient.request()`; the lock's `CORRNR` in `lockObject` |
| No transient replay: POST/PUT/DELETE are not resent after 503, 429 or a lost DB connection; definitive rejections (401, a 403 carrying SAP's CSRF challenge, 406/415) keep their single retry; a plain authorization 403 is not resent | `AdtHttpClient.request()` |
| Activation scope: objects SAP adds in its preaudit answer are refused unless requested or a sub-resource of a requested object; caller `preaudit=false` is refused | `confirmPreaudit` in `devtools.ts`; the `SAPActivate` handler |

This replaces ADR-0010's "explicit action/type/input allowlists" with an explicit **action**
allowlist, for CLAS/INTF too. Types and inputs are those of the single-target schema; they are not
authority, because package, request and activation scope are checked independently of them.
A new single-target action is still not writable on a pinned target until it is listed.

Aggregate, Copilot, shared Basic, read-only destinations, Git and custom plugins stay
mutation-free. No new switch, scope or destination property.

## What this gives up

These were provided by ADR-0010's adapter (and promised by PR #1142) and are **not** provided now:

- Read-back comparison after save, and the JSON `state`/`phase` result. Callers get the
  single-target success text or error.
- Re-checking package and recording under the lock, and again before the final send.
- Recording preflight: local-versus-transportable evidence, task-to-parent resolution, and the
  modifiable-request check. A task ID is refused unless it is itself on both lists.
- Positive activation-execution evidence: activation reports the single-target result. An explicit
  `activationExecuted="false"` without errors is reported as a warning, not as success (all modes).
- Native XML identity evidence, per-call attempt and response-byte budgets, release coverage profiles.
- A mandatory source hash. `expectedSourceHash` is optional, as in single-target.

Pinned writes therefore get the same assurance as single-target writes plus the six controls
above. If a stricter guarantee is wanted, add it to the shared path so every mode gets it.

## Maintainer decisions (13 November 2026)

- **Request-less saves.** ARC-1 does not prove that an object is local. Every request ID ARC-1 sends
  or SAP returns from a lock must be on both lists; a save with no request at all is decided by SAP,
  which refuses a transportable object without one. `resolveCreateTransport` continuing without a
  request when the recording lookup is unavailable is part of this boundary.
- **Internal text-pool activation.** After `edit_text_symbols` saves, ARC-1 activates exactly that
  text-pool URI with `preauditRequested=false`, so SAP adds nothing. Switching it to preaudit would be
  refused whenever SAP proposes the owner program and leave the same stranded draft. Callers cannot
  reach this path: admission, the dispatch recheck and the `SAPActivate` handler refuse
  `preaudit=false`.
- **`edit_content` stays excluded** from pinned routes until it is reviewed and qualified there.

A hybrid that kept the ADR-0010 adapter for CLAS/INTF main source was implemented first and
rejected in review: its routing predicate and the admission check saw different spellings
(`type: 'clas'`, `CLAS/OC`, `include: 'MAIN '`), so a call could take the shared path without the
hash the adapter required, while CLAS delete and `batch_create` already used the shared path. One
path with one rule is easier to reason about than two with a seam.

## Implementation notes

- **Admission** (`multi-target-write-surface.ts`): `SHARED_PINNED_ACTIONS` (15 `SAPWrite` actions +
  `SAPActivate.activate`); keys must exist in the single-target Zod schema (the runtime contract;
  `target` is never one); `preaudit=false` refused; `transport` and `objects[].transport` on both
  lists. A test fails when an `ACTION_POLICY` row for `SAPWrite`/`SAPActivate` is neither admitted
  nor explicitly not admitted (`publish_srvb`, `unpublish_srvb`, `edit_content`).
- **Dispatch recheck for every tool:** with the adapter gone, `isOperationAllowed` allows every
  mutation on a write-enabled pinned target, so `handleToolCall` repeats
  `multiTargetInvocationDecision` whenever `config.targetId` is set. Package/CTS management,
  `set_sql_trace_state`, Git, formatter settings and `publish_srvb` are refused before any request
  even on direct dispatch (tested).
- **Request ceiling** (`isPinnedTransportAllowed` in `safety.ts`, used by admission and the HTTP
  barrier): the destination list must allow the request (empty refuses); the server list must allow
  it (empty = unrestricted, as `SAP_ALLOWED_TRANSPORTS` in single-target). The wire check inspects
  every `corrNr` parameter, in any case, so a duplicated parameter cannot smuggle a second request.
  `lockObject` checks the `CORRNR` SAP returns and unlocks on refusal, because a save without
  `corrNr` is recorded in the request the object is locked in.
- **Barrier scope:** only when `pinnedWrite.enabled`; `retryTransientErrors: false`, and a 403 is
  resent only when SAP sends `x-csrf-token: Required` (live: a plain 403 was sent twice). 401 session
  retry and 406/415 negotiation still work (needed on older releases). There is no network-error
  retry to disable. Single-target keeps refreshing on any 403. `buildAdtConfig` → `AdtClient` attaches the policy by
  construction (tested).
- **Activation scope:** a preaudit reference with a query, fragment or dot segment is treated as
  foreign. The ED064 single-object retry re-applies control 6 per object.
- **Per-type result:** every family resolved its real package before mutating and carried its
  request only as the `corrNr` query, so no type is refused at admission.
- **Advertised schema:** the single-target `SAPWrite`/`SAPActivate` definition with the action enum
  filtered, `preaudit` and the `edit_content` fields/guidance removed, plus one sentence. The
  `multi-target-pinned-write` schema budget uses the write wall with a 23,650-byte per-tool wall
  (measured 58,953 / 23,565 bytes after the `main` merge; approved by the maintainer).

## Open before acceptance

1. **Security review** of the narrowed admission rule above.
2. **Live qualification** on a pinned strict-PP route — the executable
   [checklist](../plans/2026-11-12-pinned-writes-shared-handlers.md#live-qualification-checklist)
   covers every family, a transportable package, refused and lock-derived requests, a preaudit
   expansion and a second writer. The first run is recorded above; the fixes need a re-run, and the
   preaudit-expansion step stays open until a live fixture produces one. The per-family tests use a
   generic SAP mock, so type-specific SAP response shapes (for example ENQU, TABL/DTT, SKTD, ENHO
   bodies) stop some flows before the save in tests.
3. **Request cancellation.** Shared saves do not observe the caller's abort signal, as in
   single-target; ADR-0010's adapter did. Add it to the shared lifecycle if needed, for all modes.

## Rollout

PR 1: all `SAPWrite` actions except `edit_content`, and `SAPActivate activate` (single and batch). Then package and CTS
management, which needs the transport check in `safety.ts` made dual and body-carried requests
covered. Then service publication. Quickfix, formatter settings, trace control and FLP wait for a
request; ST05 SQL trace affects all application-server instances, not only the pinned client.

## Alternatives

- **Finish PR #1142.** Keeps every guarantee listed above. Costs about 18,000 production lines in an
  experimental default-off mode, with matching qualification effort per family.
- **Shared handlers (this ADR).** Net −736 production lines for the PR 1 surface, including
  admission, the barrier, activation scope, schema projection and removal of the ADR-0010 adapter.
- **Separate instances per system.** Already supported and the stronger isolation; no code.
