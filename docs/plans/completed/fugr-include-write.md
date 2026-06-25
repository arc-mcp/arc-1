# FUGR Structural-Include Write (update / create / delete) — FEAT-18 sibling

## Overview

ARC-1 reads function-group structural includes (`getFunctionGroupExpanded` BFS) and writes FUNC modules
+ standalone `INCL` programs, but it cannot write a FUGR's **structural** includes — the global-data
`L<grp>TOP`, the form `L<grp>U01…`/`F01…`, and PBO/PAI includes that live *inside* a function group.
fr0ster shipped this in v7.1.0 (`248c851`: read/list + create/update/delete function-group includes).
This plan adds **update** (the high-value 80% — edit an existing structural include's source) and
**create/delete**, mirroring ARC-1's existing class-include write (`safeUpdateClassInclude`, `crud.ts`).

Ponytail scope: lead with **update** (write source to an existing FUGR include) — that is the common
need (edit `LZ…TOP` global data, a form routine). create/delete of new structural includes are rarer
(function groups normally manage their own include set) and ship in the same PR but are secondary.

Success criteria (plain bullets):
- `SAPWrite type=INCL` (or a FUGR-include path) updates an existing `/functions/groups/{grp}/includes/{inc}/source/main`.
- A clean read-back shows the new source; activation succeeds.
- Reads of FUGR includes are unchanged.

## Context

### Current State

- `src/adt/client.ts`: `getInclude`/`getFunctionGroupExpanded` read FUGR includes; `objectBasePath` for
  bare `INCL` → `/sap/bc/adt/programs/includes/{name}` (standalone includes, NOT FUGR-bound).
- `src/adt/crud.ts`: `safeUpdateClassInclude` (the precedent) does lock → `updateSource(.../includes/{type})`
  → unlock, POST-creating a missing include under the class lock.
- FUGR-bound structural includes have **no write path** today.

### Verified Live Evidence (2026-06-24, a4h-2025 816)

- `GET /sap/bc/adt/functions/groups/ZABAPGIT_PARALLEL/includes/LZABAPGIT_PARALLELTOP` → **200**.
- `GET …/includes/LZABAPGIT_PARALLELTOP/source/main` → **200** (the include source lives here).
- So the structural-include resource is `/sap/bc/adt/functions/groups/{grp}/includes/{inc}` with source
  at `…/source/main` — the same shape as class includes. **Update** = lock the include (or the group)
  → `PUT …/source/main` → unlock (mirror `safeUpdateClassInclude`). **Verify the lock target live**
  (group vs include) during implementation — class includes lock the *class*; FUGR includes may lock the
  *group* (`functions/groups/{grp}`) or the include. Capture the working lock→PUT→unlock sequence.
- Create/delete: `POST`/`DELETE` on `…/includes/{inc}` (verify the create envelope live before shipping
  — fr0ster's `handleCreateFunctionInclude` delegates to its adt-clients lib, so the exact POST body is
  not public; capture ARC-1's own working create against a throwaway FUGR).

### Design Principles

1. **Mirror `safeUpdateClassInclude`** — same lock→PUT(`/source/main`)→unlock shape; do not invent a new
   write mechanism.
2. **Update first; create/delete secondary.** Lead with the verified update path.
3. **Live-capture the lock target + create envelope** before shipping (golden rule — fr0ster's exact
   payloads are not public; verify ARC-1's own against a real FUGR on 758 + 816).
4. Release-robust: the endpoint is classic ADT (present on 758 + 816); 7.50 likely too — verify, else a
   clean backend-unsupported error.
5. Routing: decide whether this is a new `SAPWrite type` or an `include=` parameter on FUGR writes —
   prefer reusing the existing FUGR/INCL routing in `object-types.ts` over a new top-level type.

## Development Approach

Live-capture the working update sequence first (a throwaway FUGR on 816: read an include, lock, PUT
modified source, unlock, read-back, activate). Encode that exact sequence; unit-test the URL/lock-handle
plumbing with mockFetch; integration-test the full lifecycle live on 758 + 816 with `generateUniqueName`
and `finally` cleanup. Failure path: a PUT with a stale/invalid lock handle → the existing 423 hint.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Live-capture + client method for FUGR-include source update

**Files:**
- Modify: `src/adt/client.ts` / `src/adt/crud.ts` (`updateFunctionGroupInclude` mirroring `safeUpdateClassInclude`)
- Modify: `tests/unit/adt/crud.test.ts`

- [ ] Live-capture (816 + 758, throwaway FUGR): the exact lock→PUT(`…/includes/{inc}/source/main`)→unlock
      sequence + the correct lock target (group vs include). Record the result in this plan's evidence.
- [ ] Implement `updateFunctionGroupInclude(group, include, source, …)` guarded with
      `checkOperation(...Update...)`, mirroring `safeUpdateClassInclude`.
- [ ] Unit tests (mockFetch): the lock→PUT→unlock URL sequence; a failure path (PUT 423 → lock hint).
- [ ] Run `npm test`.

### Task 2: Wire into SAPWrite (routing + three-file sync if a param is added)

**Files:**
- Modify: `src/handlers/write/update-delete.ts`, `src/handlers/object-types.ts`
- Modify: `src/handlers/{schemas,tools}.ts` IF a new param/type is added (three-file sync + batch item)
- Modify: snapshot fixtures + handler tests

- [ ] Route a FUGR-include update through `updateFunctionGroupInclude` (reuse FUGR/INCL routing; add a
      `group`+`include` addressing for FUGR-bound includes). Keep the three-file sync if a param is added.
- [ ] Handler tests incl. a polluted-payload / wrong-addressing failure path. Regenerate snapshot; bump
      the schema-budget ratchet if it trips.
- [ ] Run `npm test`.

### Task 3: create / delete (secondary) + integration + docs

**Files:**
- Modify: `src/adt/crud.ts` (create/delete), `tests/integration/adt.integration.test.ts`, docs

- [ ] Live-capture + implement create (POST envelope) + delete (DELETE) for a FUGR structural include.
- [ ] Integration (758 + 816): create a throwaway FUGR include (or update an existing one), read-back,
      activate, delete — `generateUniqueName`, `finally` cleanup; 7.50 `requireOrSkip` if unsupported.
- [ ] Docs: tools.md (FUGR include write), AGENTS row, roadmap (FEAT-18 sibling), feature matrix.
- [ ] Run `npm test`.

### Task 4: Final verification

- [ ] `npm test`, `typecheck`, `lint`, `build`, `check:sizes` — green.
- [ ] Live on 758 + 816: full FUGR-include write lifecycle incl. **activate** (the definitive check).
- [ ] Move this plan to `docs/plans/completed/`.
