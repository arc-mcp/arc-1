# Transport Safety: Pre-Release Inactive-Objects Check + Fix K/W/T Create Claim (FEAT-63 + COMPAT-05)

## Overview

Two transport-correctness fixes, both in the SAPTransport surface:

1. **FEAT-63 — pre-release inactive-objects check.** Releasing a transport that still contains
   **inactive** objects makes SAP's release pipeline (which activates before exporting) **hang** — the
   agent sees "operation timed out" with no useful detail (verified rationale from dassian-adt
   `4cfd841`). ARC-1 already has the data to prevent this (`getInactiveObjects()` returns each inactive
   object's `transport`/`parentTransport`) but the release path never consults it. This plan adds a
   read-only pre-check to `SAPTransport action=release|release_recursive` that fails fast with the
   blocking list before attempting the release.

2. **COMPAT-05 — fix the false K/W/T create claim.** `tools.ts` advertises
   `create (K=Workbench, W=Customizing, T=Transport of Copies)`, but the `create` handler has **no
   `type` parameter** — `createTransport` (CreateCorrectionRequest) and `createTransportWithTarget`
   (`tm:type="K"` hardcoded) only ever produce a Workbench (K) request. Correct the tool description to
   match reality (Workbench requests; W/T not supported). Implementing true ToC/Customizing creation is
   a separate, larger feature (noted as a follow-up) — a false capability claim is worse than an honest
   limitation.

Ponytail: the check is a pure filter over data ARC-1 already fetches (no new ADT endpoint, no new
scope — `getInactiveObjects` is Read, release is `transports`); fail-fast (no auto-activate) keeps the
write surface untouched and lets the agent call the existing `SAPActivate` then retry.

Success criteria (plain bullets):
- Releasing a transport containing inactive objects returns a clear error listing them, instead of
  hanging.
- A clean transport releases exactly as before (no behavior change on the happy path).
- If the inactive-objects probe itself fails, the release proceeds (graceful degradation — never block
  a legitimate release on a diagnostic error).
- `tools.ts` no longer claims unsupported W/T transport creation.

## Context

### Current State

- `src/handlers/transport.ts` — `case 'release'` (~`:231`) calls `releaseTransport(client.http,
  client.safety, id)` directly; `case 'release_recursive'` (~`:295`) calls
  `releaseTransportRecursive(...)`. Neither consults inactive objects.
- `src/adt/transport.ts` — `releaseTransport(http, safety, id)` (leaf release);
  `releaseTransportRecursive(http, safety, id)` enumerates `transport.tasks`, releases each then the
  parent. `createTransport(...)`/`createTransportWithTarget(...)` only create type-K requests.
- `src/adt/client.ts:1007` — `getInactiveObjects(): Promise<InactiveObject[]>` (Read-scoped).
- `src/adt/types.ts:876` — `InactiveObject { name; type; uri; description?; user?; deleted?;
  transport?; parentTransport? }`.
- `src/handlers/tools.ts:~240,249` — the transport tool description's create line claims K/W/T.

### Target State

- A pure helper `inactiveObjectsForTransport(objects: InactiveObject[], transportId: string):
  InactiveObject[]` in `src/adt/transport.ts`.
- The `release`/`release_recursive` handler cases run the pre-check and fail fast with the blocking
  list (graceful on probe error).
- `tools.ts` create description corrected.

### Verified Live Evidence

- **2026-06-24, a4h (S/4HANA 2023 / 758): the ADT inactive-objects response carries the transport
  assignment.** `node dist/cli.js call SAPRead --arg type=INACTIVE_OBJECTS --output json` returned 35
  objects; entries assigned to a transport show e.g.
  `{ "name":"ZC_FbClubTP", "type":"BDEF/BDO", "transport":"A4HK901087",
  "parentTransport":"/sap/bc/adt/cts/transportrequests/A4HK901086" }`.
  → `transport` = the **task** id; `parentTransport` = the parent **request** URI (last segment =
  request id). `$TMP`/unassigned objects omit both fields. This is the exact correlation key the
  pre-check uses. (Capture a trimmed copy of this real response as a fixture under
  `tests/fixtures/xml/` or build `InactiveObject[]` literals from it for the pure-function test — do
  NOT hand-invent the shape.)
- **2026-06-24: `InactiveObject` already exposes `transport`/`parentTransport`**
  (`src/adt/types.ts:876`); `parseInactiveObjects` (`src/adt/xml-parser.ts:~1231`) populates them from
  `transport/ref/@_name` and `@_parentUri` (optional — hence the live confirmation above that they are
  actually present).
- **2026-06-24: COMPAT-05 confirmed in code.** The `create` handler case (`src/handlers/transport.ts`)
  accepts only `description`/`target`/`transportLayer`; there is no `type` arg and `createTransport`
  has no type parameter — so K/W/T is a false claim. (Verify there is likewise no `type` in the
  transport create Zod schema in `src/handlers/schemas.ts`; if present-but-ignored, remove it.)
- **No new ADT endpoint** is introduced — the pre-check reuses `getInactiveObjects` (already
  integration-tested). Release-hang behavior is SAP-side and consistent across releases; the
  integration test verifies the *correlation + fail-fast* behavior, which is release-invariant.

### Design Principles

1. **Read-only, no new scope.** The pre-check calls `getInactiveObjects` (Read) inside a path already
   gated by the `transports` scope + `checkTransport` safety. No write, no activation.
2. **Fail-fast, not auto-activate.** Default = block + list the inactive objects + tell the agent to
   run `SAPActivate` then retry. (Auto-activate is a write, cross-cuts the activate tool/scope, and is
   a deliberate non-goal for v1.)
3. **Graceful degradation.** If `getInactiveObjects` throws, log and **proceed** with the release —
   never fail a legitimate release because the diagnostic probe failed.
4. **Correlation rule.** An inactive object belongs to the release target `T` if
   `obj.transport === T` (case-insensitive) OR `obj.parentTransport` ends with `/${T}` (the object's
   parent request is `T`). This catches both "release a request" (objects on its child tasks carry
   `parentTransport = request URI`) and "release a task" (`transport = task id`).
5. **Release-invariant.** The behavior is pure correlation + early return; not DDIC/lock/activation
   semantics. Still smoke on 7.50 and 758/816 to confirm `getInactiveObjects` returns the field shape
   on each (it is a stable endpoint; 7.50 writes need the abapfs_extensions fix per INFRASTRUCTURE.md).
6. Honest docs: correct the K/W/T claim; do not implement W/T here.

## Development Approach

TDD: write the pure-`inactiveObjectsForTransport` tests first against the **real** captured shape
(request id, task id, parentTransport URI, `$TMP` object with no transport), implement, then wire the
handler. Cover failure paths: probe throws → release proceeds (spy/mock `getInactiveObjects` to reject
and assert `releaseTransport` is still called); blocking objects present → handler returns an error and
`releaseTransport` is NOT called.

Integration (needs `TEST_SAP_URL`): create a transportable object on a child task, leave it inactive,
attempt `release` → expect the fail-fast error listing it; then activate + release succeeds. Use
`generateUniqueName()`; clean up the transport + object in `finally`. Run on 758 and 816; on 7.50 gate
with `requireOrSkip` if transportable writes are unavailable.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Pure correlation helper + unit tests

**Files:**
- Modify: `src/adt/transport.ts` (add exported `inactiveObjectsForTransport`)
- Modify: `tests/unit/adt/transport.test.ts` (or create if absent — verify first)

- [ ] Add `export function inactiveObjectsForTransport(objects: InactiveObject[], transportId: string):
      InactiveObject[]`. Normalize `transportId` to upper-case. Return objects where
      `(o.transport ?? '').toUpperCase() === id` OR `(o.parentTransport ?? '').toUpperCase()` ends with
      `'/' + id`. Import `InactiveObject` from `./types.js`.
- [ ] Unit tests (~6) built from the REAL shape in Verified Evidence: object on a child task matches
      its **request** id via `parentTransport`; object matches its **task** id via `transport`; a
      `$TMP` object (no transport fields) never matches; case-insensitive id; an unrelated transport id
      returns `[]`; empty input → `[]`.
- [ ] Run `npm test`.

### Task 2: Wire the pre-release check into the handler (fail-fast + graceful)

**Files:**
- Modify: `src/handlers/transport.ts` (`release` ~`:231`, `release_recursive` ~`:295`; ADD `import { logger } from '../server/logger.js';` — it is NOT currently imported there)
- Modify: `tests/unit/handlers/transport.test.ts` (exists; mocks at the **undici `mockFetch`** layer via `./setup-undici-mock.js` with a real `AdtClient` — NOT method spies)

Mirror the existing handler error style (`errorResult`). The check must run BEFORE `releaseTransport`/
`releaseTransportRecursive`. In both cases `id` is already `const id = String(args.id ?? '')`.

- [ ] Add `import { logger } from '../server/logger.js';` to `src/handlers/transport.ts`.
- [ ] Add a local async helper `precheckInactive(client: AdtClient, id: string): Promise<InactiveObject[]>`
      that calls `await client.getInactiveObjects()` and returns `inactiveObjectsForTransport(list, id)`;
      wrap in try/catch returning `[]` on error (graceful degradation) + `logger.warn(...)`.
- [ ] In `case 'release'` and `case 'release_recursive'`, before the release call: `const blocking =
      await precheckInactive(client, id);` if `blocking.length > 0` return `errorResult(...)` listing
      `type name` per object + guidance: "These objects are inactive and would hang the release.
      Activate them first (SAPActivate), then retry." Do NOT proceed to release. For `release_recursive`,
      run the probe **once with the parent request `id`** — the matcher catches child-task objects via
      `parentTransport` (no per-task fetch).
- [ ] Tests (mock at the `mockFetch` layer, matching the existing harness — do NOT spy on the
      module-level `releaseTransport`): (a) the inactive-objects GET returns XML containing a
      transport-matching inactive object → handler returns the error AND the release POST
      (`/newreleasejobs`) is **never sent** (assert via the mockFetch call log). (b) the inactive-objects
      GET rejects/500 → the release POST **is** sent (graceful degradation; `logger` is already spied in
      this test file). (c) inactive GET returns only non-matching/`$TMP` objects → release proceeds
      unchanged (regression guard).
- [ ] Run `npm test`.

### Task 3: Fix the K/W/T create claim (COMPAT-05)

**Files:**
- Modify: `src/handlers/tools.ts` — the K/W/T claim appears in **TWO** strings: `SAPTRANSPORT_DESC_ONPREM` (~`:240`) AND `SAPTRANSPORT_DESC_BTP` (~`:249`). Edit both.
- Verify only (do NOT change): `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/tool-definitions-snapshot.test.ts` fixtures (regenerate via `vitest -u`)

- [ ] In **both** `SAPTRANSPORT_DESC_ONPREM` (~`:240`) and `SAPTRANSPORT_DESC_BTP` (~`:249`), change
      `create (K=Workbench, W=Customizing, T=Transport of Copies)` to reflect reality, e.g.
      `create (Workbench/correction request; optional explicit transport target). Customizing (W) and
      Transport-of-Copies (T) creation are not yet supported.`
- [ ] **Do NOT remove the schema's `type` field.** `SAPTransportSchema` (`schemas.ts:~725`) has
      `type: z.string().optional()`, but it is **load-bearing** — consumed by `remove_object`
      (`transport.ts:~264`), `check` (`~:304`), and `history` (`~:336`). The `create` case never reads
      `args.type` (verified), so it is correctly not a create param. No schema change.
- [ ] Regenerate the snapshot: `npx vitest run -u tests/unit/handlers/tool-definitions-snapshot.test.ts`.
      The diff touches the **6** fixtures that embed the SAPTransport description
      (`onprem-full-git-off`, `onprem-full-textsearch-on`, `onprem-readonly-textsearch-off`,
      `onprem-full-unrestricted-packages`, `btp-full-textsearch-on`, `btp-readonly-textsearch-off`);
      `onprem-full-transport-off` omits it (tool hidden). Review that the only change is the description.
- [ ] Run `npm test`.

### Task 4: Integration tests (live) + docs

**Files:**
- Modify: `tests/integration/transport.integration.test.ts` — the **fail-fast** assertion (it does NOT release: create inactive object on a transport, attempt release, expect the error naming it; then clean up by activating/deleting).
- Modify: `tests/integration/transport-release.slow.integration.test.ts` — the **destructive** happy path (activate → real release succeeds). This suite is gated by `TEST_TRANSPORT_RELEASE_TESTS=true` because a release is permanent on the shared system; do not move it elsewhere.
- Modify: `docs_page/roadmap.md` (FEAT-63 → done; note COMPAT-05 fixed), `compare/00-feature-matrix.md`
  (transport-safety row), `AGENTS.md` (transport row gotcha if warranted)

- [ ] Fail-fast integration test (guarded by `TEST_SAP_URL`, in `transport.integration.test.ts`): create
      a transportable object on a fresh transport's task, leave inactive, `SAPTransport release` → assert
      the fail-fast error names the object. `generateUniqueName()`; cleanup (activate or delete +
      transport) in `finally`. The activate-then-real-release happy path goes in
      `transport-release.slow.integration.test.ts` behind `TEST_TRANSPORT_RELEASE_TESTS=true`.
      Per release: 758 + 816; `requireOrSkip` on 7.50 if transportable write is unavailable.
- [ ] Docs: roadmap FEAT-63 completed + COMPAT-05 resolved; feature-matrix transport row. State the
      verified per-release behavior.
- [ ] Run `npm test`.

### Task 5: Final verification

- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — all green.
- [ ] Live: on a4h (758) drive a real `SAPTransport release` against a transport with a known inactive
      object (creds per INFRASTRUCTURE.md) — confirm the fail-fast error; then activate + release.
      Repeat the smoke on 816 and (read-only fallback) 7.50. Do not commit throwaway scripts.
- [ ] Move this plan to `docs/plans/completed/`.
