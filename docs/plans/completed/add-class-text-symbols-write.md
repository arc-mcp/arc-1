# Add class text-symbol + selection-text read/write

> **As shipped (2026-07-02):** narrowed to **text symbols only**. Live testing during implementation
> proved class *selection texts* don't exist — a class has no selection screen, so `source/selections`
> is always empty and writes return SAP 406. Selection texts move to the program follow-up. Surface:
> `SAPRead type=CLAS include=text_symbols` + `SAPWrite action=edit_text_symbols`. Verified end-to-end
> on a4h 758 (unit + live integration round-trip). See the dossier addendum.

## Overview

ARC-1 cannot read or write the **text pool** (Textelemente) of global ABAP classes. When a
developer converts a class to text symbols (`'Text'(001)`), the inline reference alone leaves an ATC
finding *"Textsymbol 001 nicht definiert"* — the maintained text-symbol entries are missing, and
today those can only be edited in SE24/Eclipse. This plan adds read **and** write for a global
class's text symbols and selection texts over the ADT `textelements` service.

The core is small: two thin `AdtClient` methods (read GET, write lock→PUT→unlock) reusing the
existing `lockObject`/`unlockObject` engine and the stateful session. The read surface reuses the
existing free-string `include` param on `SAPRead type=CLAS`; the write surface adds two `SAPWrite`
actions. No new config flag, no new dependency, no new abstraction — laziest change that fully works.

Key design decisions (success criteria — all must hold):
- Read: `SAPRead type=CLAS name=Z include=text_symbols` (and `selection_texts`) returns the pool body.
- Write: `SAPWrite action=edit_text_symbols` / `edit_selection_texts` with `{type:CLAS, name, source}`
  persists the pool and is immediately active (no separate `SAPActivate`).
- On-prem only (a4h 758 + a4h-2025 816). The service is **absent on 7.50** → fail clean there.
- Text-pool bodies are not ABAP source → they bypass pre-write lint and abaplint entirely.
- Writes ride the existing write scope + package allowlist (enforced against the class's real package).
- `npm test`, `npm run typecheck`, `npm run lint` all green; tool-definition snapshots regenerated.

## Context

### Current State
- `AdtClient.getTextElements(program)` (`src/adt/client.ts:~1386`) calls
  `/sap/bc/adt/programs/programs/{name}/textelements`. **This endpoint returns 404 on every tested
  release** (7.50 and 758) even for programs that have text symbols — it is a dead path, covered only
  by a mocked unit test (`tests/unit/adt/client.test.ts:~682`). Reached via `SAPRead type=TEXT_ELEMENTS`
  (`src/handlers/read.ts:~669`). **Fixing/removing that program path is OUT OF SCOPE** (follow-up).
- There is no read or write path for **class** text elements.
- `SAPWrite` dispatches on `action` in a switch (`src/handlers/write.ts:~241`); per-action handlers
  live in `src/handlers/write/` (`update-delete.ts`, `create.ts`, `rap.ts`, `class-surgery.ts`).
- The lock→modify→unlock engine is `lockObject`/`unlockObject`/`safeUpdateSource` in `src/adt/crud.ts`.
- `http.put(path, body, contentType?, headers?)` (`src/adt/http.ts:~250`) accepts a 4th `headers`
  arg — used to set the required `Accept` header.

### Target State
- `AdtClient.getClassTextElements(name, segment)` and `writeClassTextElements(name, segment, source, transport?)`.
- `SAPRead type=CLAS include=text_symbols|selection_texts` → read.
- `SAPWrite action=edit_text_symbols|edit_selection_texts` → write.
- Clean, release-aware error on 7.50 (service not in discovery).

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | Add `getClassTextElements` + `writeClassTextElements` (near `getTextElements` ~1386); media-type constants; discovery gate |
| `src/adt/crud.ts` | Source of `lockObject`/`unlockObject` reused by the write method |
| `src/adt/http.ts` | `http.put(...headers)` for the Accept header; `discoveryAcceptFor()` (~218) + discovery-loaded accessor (~214) for the release gate |
| `src/handlers/read.ts` | CLAS read branch (~225) — intercept `include=text_symbols|selection_texts` before the generic include path |
| `src/handlers/write.ts` | Action switch (~241) — add `edit_text_symbols` / `edit_selection_texts` cases |
| `src/handlers/write/update-delete.ts` | Home for the new `writeActionEditTextElements(ctx, segment)` handler (mirror `writeActionUpdate`) |
| `src/handlers/write/context.ts` | `SapWriteContext` — already exposes `enforcePackageForExistingObject`, `objectUrl`, `transport`, `source`, `hasSource` |
| `src/handlers/schemas.ts` | SAPWrite onprem action enum (~455) — add the two actions (NOT the btp enum ~549) |
| `src/handlers/tools.ts` | SAPWrite action enum (JSON schema) + descriptions; SAPRead CLAS `include` doc |
| `tests/fixtures/tool-definitions/onprem-*.json` | Snapshot-locked LLM tool surface — regenerate for the new onprem actions |
| `docs_page/tools.md`, `docs_page/roadmap.md`, `CLAUDE.md` | Docs |

### Verified Live Evidence

Full dossier: `docs/research/2026-07-02-class-text-symbols-textpool.md` (repro commands + captured bodies).

- **2026-07-02, a4h 758** — full write round-trip on a throwaway `$TMP` class `ZCL_ARC1_TESPIKE`:
  `POST /sap/bc/adt/textelements/classes/{n}?_action=LOCK&accessMode=MODIFY` → `<LOCK_HANDLE>…`,
  `IS_LOCAL=X`; `PUT .../source/symbols?lockHandle=…` with Content-Type **and** Accept
  `application/vnd.sap.adt.textelements.symbols.v1`, body `"@MaxLength:10\n001=Servus\n"` → **200**;
  `UNLOCK` → 200; read-back → `@MaxLength:10\r\n001=Servus` ✓. Missing `Accept` on the PUT → **400**
  "Accept header missing"; one `@MaxLength` shared by two symbols → **406** "Text elements contain
  errors" (rejected, not persisted).
- **2026-07-02, a4h 758** — `GET /sap/bc/adt/textelements/classes/cl_gui_alv_grid/source/symbols` →
  **200**, `Content-Type: application/vnd.sap.adt.textelements.symbols.v1; charset=UTF-8`, body
  `@MaxLength:13\r\n003=Einblenden...\r\n\r\n@MaxLength:18\r\n005=Ausblenden…`. Metadata GET on the
  object returns `rept:textElement` with a `rept:subobject name="symbols"` `atom:link`
  `rel="…/relations/source" type="…symbols.v1"`.
- **2026-07-02, a4h-2025 816** — same class-symbols GET → **200**, identical shape (service present).
- **2026-07-02, npl 7.50** — `textelements/classes/…` → **404 ResourceNotFound**, and the discovery
  document contains **zero** `textelements/*` collections (`grep -c textelements/classes` = 0). The
  base `programs/programs/{n}/source/main` returns 200, proving only the textelements service is
  absent → hard release gate.

### Design Principles
1. **Reuse, don't rebuild.** The write method uses `lockObject`/`unlockObject` from `crud.ts` inside
   `http.withStatefulSession(...)` — the exact pattern of `safeUpdateSource`. The only deltas vs a
   normal source write: lock target is the *textelements* object (`/sap/bc/adt/textelements/classes/{n}`),
   PUT URL is `.../source/{symbols|selections}`, and the PUT carries Content-Type **and** `Accept` =
   the segment media type. Do NOT call `updateSource` (it hard-codes `text/plain` and no Accept).
2. **Two media types.** `symbols` → `application/vnd.sap.adt.textelements.symbols.v1`; `selections`
   → `application/vnd.sap.adt.textelements.selections.v1`. Define as named constants.
3. **Release gate via discovery, not a new probe.** Gate on
   `http.discoveryAcceptFor('/sap/bc/adt/textelements/classes')` — mirror the CDS-test-doubles
   precedent in `src/adt/devtools.ts` (`if (!http.hasDiscoveryData()) return undefined; return
   http.discoveryAcceptFor(...) !== undefined;`). Only block when discovery is *loaded* (guard with
   `http.hasDiscoveryData()`, `src/adt/http.ts:~213`) so a not-yet-loaded discovery map does not
   false-block 758/816; when unloaded, proceed and let the 404 surface. On 7.50 the collection is
   absent → clean `AdtApiError` "Class text elements require the ADT textelements service (SAP_BASIS
   ≥ 7.51; not available on this system)".
4. **No lint / no activation.** Text-pool bodies are not ABAP source: the new write actions must NOT
   run `SAP_LINT_BEFORE_WRITE`, abaplint, RAP preflight, or a post-write syntax check, and require no
   `SAPActivate` (the pool is active on PUT). Because they are dedicated actions (not `create`/`update`
   of a source object) they naturally bypass those paths — keep it that way.
5. **Safety + scope unchanged.** `getClassTextElements` guards with `checkOperation(this.safety,
   OperationType.Read, …)`; `writeClassTextElements` with `OperationType.Update`. The write action
   calls `ctx.enforcePackageForExistingObject()` first — `ctx.objectUrl` is the class URL
   `/sap/bc/adt/oo/classes/{n}`, so the allowlist checks the class's real package. Write scope + the
   existing `SAP_ALLOW_WRITES` ceiling apply; no new opt-in flag.
6. **Scope boundary.** CLAS only. Program/function-group text elements and repairing the broken
   `SAPRead type=TEXT_ELEMENTS` program path are explicitly out of scope (follow-ups). On-prem only —
   nothing touches the BTP action/type enums or BTP fixtures.
7. **`withSafety()` clone (#333) unaffected.** The new surface adds only prototype methods + two
   module-level media-type constants — **no new AdtClient instance fields** — so the
   `Object.assign(Object.create(prototype), this, {safety})` clone in `client.ts` needs no change.
8. **Line numbers are worktree-relative.** This branch is cut from `fd2bbc3a` (release 0.9.24); a
   sibling checkout of the same repo has diverged. All `~NNN` line hints below are approximate —
   confirm every anchor by grepping the symbol name, per ralphex Rule 6.

## Development Approach

TDD, red→green per task. Unit tests mock `undici` via `mockResponse()` (`tests/helpers/mock-fetch.ts`)
and assert the **request URL + headers** the client emits (this is the whole point — the old program
endpoint shipped untested-against-reality). For the write method, assert the PUT URL contains
`/source/symbols`, the `lockHandle`, and that `Content-Type` **and** `Accept` are the symbols media
type; assert a lock POST and an unlock POST bracket it.

Failure paths are mandatory: the 406 "contains errors" branch (malformed body), the not-found/404
branch, the release-gate branch (discovery loaded but collection absent → clean error), and a
polluted-payload test for the new write actions (irrelevant optional fields present, wrong-type
fields). LLM clients over-populate optional fields — model that.

The integration round-trip (Task 5) is the highest-value test: create a `$TMP` class with a
`'x'(001)` reference, write symbol `001`, read it back, assert; then a malformed-body write asserts
the SAP failure class. It hard-fails without `TEST_SAP_URL` (`requireSapCredentials()` throws) — so
it lives only in Task 5 and Final verification, never in Validation Commands.

Fixture provenance: any captured ADT body committed under `tests/fixtures/` is real (from the
dossier's live runs) — do not hand-edit shapes.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `getClassTextElements` + `writeClassTextElements` to AdtClient

**Files:**
- Modify: `src/adt/client.ts` (add both methods near `getTextElements` at ~1386; add two media-type
  constants and a private release-gate helper)
- Modify: `tests/unit/adt/client.test.ts` (new tests in the text-elements `describe` block near ~682)

Context: these two methods are the whole feature core. Mirror the read shape of `getTextElements`
and the lock/unlock shape of `safeUpdateSource` (`src/adt/crud.ts:~218`). Verified contract and
media types are in the dossier / Verified Live Evidence above.

- [ ] Add constants near the top of the text-elements section:
      `const TEXT_SYMBOLS_CT = 'application/vnd.sap.adt.textelements.symbols.v1';`
      `const TEXT_SELECTIONS_CT = 'application/vnd.sap.adt.textelements.selections.v1';`
      and a helper `const textElementsSegmentCt = (s: 'symbols' | 'selections') => s === 'selections' ? TEXT_SELECTIONS_CT : TEXT_SYMBOLS_CT;`
- [ ] Add `import { lockObject, unlockObject } from './crud.js';` to `client.ts` — it does NOT
      currently import from crud (its only `.put` is the stateless `setApiReleaseState`). This is
      safe: `crud.ts` does not import `client.ts` (no circular dependency), and `src/adt/server-driven.ts`
      already establishes the adt-layer→crud import pattern. `AdtApiError`, `checkOperation`,
      `OperationType` are already imported.
- [ ] Add a private gate. If `this.http.hasDiscoveryData()` is true (`http.ts:~213`) **and**
      `this.http.discoveryAcceptFor('/sap/bc/adt/textelements/classes')` is `undefined`, throw
      `new AdtApiError('Class text elements require the ADT textelements service (SAP_BASIS ≥ 7.51; not available on this system).', 404, '')`.
      If discovery is not loaded (`!hasDiscoveryData()`), do nothing (let a real 404 surface).
- [ ] Implement `async getClassTextElements(name: string, segment: 'symbols' | 'selections'): Promise<string>`:
      `checkOperation(this.safety, OperationType.Read, 'GetClassTextElements')`; run the gate; then
      `const ct = textElementsSegmentCt(segment);`
      `const resp = await this.http.get('/sap/bc/adt/textelements/classes/' + encodeURIComponent(name) + '/source/' + segment, { Accept: ct });`
      `return resp.body;`
- [ ] Implement `async writeClassTextElements(name: string, segment: 'symbols' | 'selections', source: string, transport?: string): Promise<void>`:
      `checkOperation(this.safety, OperationType.Update, 'WriteClassTextElements')`; run the gate;
      then, mirroring `safeUpdateSource` (and `server-driven.ts:~233`, which calls `lockObject`
      with NO release arg — there is **no `abapRelease` field on AdtClient**; the release arg is
      optional and only tunes an HTML-conflict error message):
      ```
      const obj = '/sap/bc/adt/textelements/classes/' + encodeURIComponent(name);
      const ct = textElementsSegmentCt(segment);
      await this.http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, this.safety, obj, 'MODIFY');
        const corr = transport ?? (lock.corrNr || undefined);
        try {
          let url = obj + '/source/' + segment + '?lockHandle=' + encodeURIComponent(lock.lockHandle);
          if (corr) url += '&corrNr=' + encodeURIComponent(corr);
          await session.put(url, source, ct, { Accept: ct });   // Accept is REQUIRED (400 without it)
        } finally {
          await unlockObject(session, obj, lock.lockHandle);
        }
      });
      ```
- [ ] Add unit tests (~6) in the text-elements `describe`:
      - `getClassTextElements('ZFOO','symbols')` → mock 200 with a captured symbols body; assert the
        GET path is `/sap/bc/adt/textelements/classes/ZFOO/source/symbols` and the request `Accept`
        is the symbols media type; assert the returned body equals the mock.
      - `getClassTextElements('ZFOO','selections')` → asserts the `selections` path + media type.
      - `writeClassTextElements('ZFOO','symbols','@MaxLength:10\n001=Hi\n')` → mock the lock POST
        (returns `<LOCK_HANDLE>H1</LOCK_HANDLE>`), the PUT (200), the unlock POST; assert the PUT URL
        contains `/source/symbols` and `lockHandle=H1`, and that the PUT `Content-Type` **and**
        `Accept` are the symbols media type.
      - Failure: `writeClassTextElements` when the PUT returns 406 → assert it rejects with
        `AdtApiError` (406) and that unlock is still called (finally).
      - Release gate: with a discovery map loaded that lacks `textelements/classes`,
        `getClassTextElements` rejects with the clean "not available" `AdtApiError` and makes no GET.
- [ ] Run `npm test` — all tests pass

### Task 2: Wire the read surface — `SAPRead type=CLAS include=text_symbols|selection_texts`

**Files:**
- Modify: `src/handlers/read.ts` (CLAS branch, `case 'CLAS':` at ~225 — add an early intercept)
- Modify: `src/handlers/tools.ts` (SAPRead CLAS `include` description — document the two new values)
- Modify: `tests/unit/handlers/read.test.ts` (new tests near the existing TEXT_ELEMENTS test ~676)

Context: the CLAS read already dispatches on the free-string `include` param
(`schemas.ts` `include: z.string().optional()` — **no schema enum change needed**). Add an early
branch that intercepts the two new values before the generic `client.getClass(name, include)` path,
so they route to `getClassTextElements`.

- [ ] In the `case 'CLAS':` block, before the grep/method/include handling reaches
      `client.getClass(...)`, add:
      ```
      const inc = (args.include as string | undefined)?.toLowerCase();
      if (inc === 'text_symbols' || inc === 'selection_texts') {
        const segment = inc === 'selection_texts' ? 'selections' : 'symbols';
        return textResult(await client.getClassTextElements(name, segment));
      }
      ```
      Place it so it wins over the generic include path but does not interfere with `grep`/`method`
      (those combos need no text-symbol handling — if both `grep` and a text_symbols include are set,
      the text-symbol branch may take precedence; keep it simple).
- [ ] Update the CLAS `include` description in `tools.ts` to mention `text_symbols` and
      `selection_texts` (read the class's maintained text pool / selection texts).
- [ ] Add unit tests (~3) in `read.test.ts`: `type:CLAS, include:text_symbols` returns the mocked
      symbols body and calls `getClassTextElements(name,'symbols')`; `include:selection_texts` →
      `'selections'`; and a regression assert that `type:CLAS` with **no** include still reads full
      class source (the existing path is unchanged).
- [ ] Run `npm test` — all tests pass

### Task 3: Wire the write surface — `edit_text_symbols` / `edit_selection_texts` actions

**Files:**
- Modify: `src/handlers/schemas.ts` (SAPWrite **onprem** action `z.enum` at ~455 — add both actions; do NOT touch the btp enum ~549)
- Modify: `src/handlers/tools.ts` (SAPWrite action enum in the JSON schema + a short description of the two actions)
- Modify: `src/handlers/write.ts` (action switch ~241 — add two cases)
- Modify: `src/handlers/write/update-delete.ts` (add `writeActionEditTextElements(ctx, segment)`)
- Modify: `tests/unit/handlers/write.test.ts` (new tests) and, if action lists are asserted there, `tests/unit/handlers/schemas.test.ts`

Context: no existing action fits (a class `update` goes to `/source/main`). Add two dedicated
actions. Mirror `writeActionUpdate` (`update-delete.ts:~53`) for the handler; `SapWriteContext`
already carries everything needed.

**BLOCKER to handle (parity test):** `zod-jsonschema-parity.test.ts` iterates `btp ∈ {false,true}`
and compares the `tools.ts` action enum against the Zod schema for each. In `tools.ts` the SAPWrite
action `enum` is a **single shared array** (not branched on `btp` — only `type` branches). If you add
the two actions to that flat array unconditionally, the **btp=true** case fails (hand enum has them,
`SAPWriteSchemaBtp` doesn't). So the tools.ts action enum must become **conditional on `!btp`** —
append `'edit_text_symbols'`/`'edit_selection_texts'` only when `!btp`, mirroring the split Zod enums.

- [ ] Add `'edit_text_symbols'` and `'edit_selection_texts'` to the SAPWrite **onprem** action
      `z.enum` in `schemas.ts` (the onprem `SAPWriteSchema`, ~467) — NOT the BTP `SAPWriteSchemaBtp`
      (~563).
- [ ] In `tools.ts`, make the SAPWrite action `enum` array conditional: append the two actions only
      when `!btp` (e.g. build the array then `if (!btp) actions.push('edit_text_symbols','edit_selection_texts')`,
      or a spread). This keeps the btp=true parity test green and guarantees Task 4's "no btp-* fixture
      change" outcome.
- [ ] Add `'edit_text_symbols'` and `'edit_selection_texts'` to `NAME_CASE_GUARD_ACTIONS`
      (`src/handlers/write-helpers.ts`, referenced from `write.ts` ~85) so a lowercase class name gets
      the same clean early "use uppercase TADIR name" error as `update`/`delete` (these actions target
      existing uppercase-TADIR classes).
- [ ] Implement in `update-delete.ts`:
      ```
      export async function writeActionEditTextElements(
        ctx: SapWriteContext,
        segment: 'symbols' | 'selections',
      ): Promise<ToolResult> {
        const { client, type, name, source, hasSource, transport, enforcePackageForExistingObject, invalidateWrittenObject } = ctx;
        if (type !== 'CLAS') {
          return errorResult(`action edit_${segment === 'selections' ? 'selection_texts' : 'text_symbols'} requires type=CLAS`);
        }
        if (!hasSource) {
          return errorResult('source is required — the text-pool body, e.g. "@MaxLength:20\\n001=Label\\n" (one @MaxLength per symbol).');
        }
        await enforcePackageForExistingObject();          // checks the class's real package vs allowlist
        await client.writeClassTextElements(name, segment, source, transport);
        invalidateWrittenObject();                         // pool read may be cached elsewhere; safe no-op otherwise
        return textResult(`Updated text ${segment === 'selections' ? 'selection texts' : 'symbols'} for class ${name}.`);
      }
      ```
      (Import `errorResult`/`textResult` as the file already does.)
- [ ] Add to the `write.ts` action switch:
      `case 'edit_text_symbols': return writeActionEditTextElements(ctx, 'symbols');`
      `case 'edit_selection_texts': return writeActionEditTextElements(ctx, 'selections');`
      and import the new handler alongside `writeActionUpdate`.
- [ ] Confirm the new actions do NOT enter any lint/preflight/syntax-check path (they route straight
      to the handler above). If `write.ts` runs a pre-write lint gate ahead of the switch for certain
      actions, ensure these two are excluded.
- [ ] Add unit tests (~5) in `write.test.ts`:
      - `action:edit_text_symbols, type:CLAS, name:ZFOO, source:'@MaxLength:10\n001=Hi\n'` → calls
        `client.writeClassTextElements('ZFOO','symbols',...)` and returns success text; assert
        `enforcePackageForExistingObject` was consulted (package gate rides the write).
      - `action:edit_selection_texts` → `'selections'`.
      - Failure: `type:PROG` (not CLAS) → error result, no client write call.
      - Failure: missing `source` → error result, no client write call.
      - Polluted payload: `edit_text_symbols` with irrelevant optionals set (e.g. `odataVersion`,
        empty-string `include`, `abstract:true`) → still succeeds and writes symbols (irrelevant
        fields ignored), OR is cleanly rejected — assert the deterministic behavior, not a crash.
- [ ] Run `npm test` — all tests pass

### Task 4: Regenerate the tool-definition snapshots + keep sync tests green

**Files:**
- Modify: `tests/fixtures/tool-definitions/onprem-*.json` (regenerate — the new onprem SAPWrite actions appear here)
- Verify: `tests/unit/handlers/tool-definitions-snapshot.test.ts`, `registry-sync.test.ts`, `schema-key-sync.test.ts`, `zod-jsonschema-parity.test.ts` all pass

Context: the LLM-visible tool surface is frozen by the `onprem-*` fixtures. Adding two onprem
actions is an intentional surface change → regenerate and eyeball the diff. The BTP fixtures must
**not** change (actions are onprem-only).

- [ ] Run `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts -u` to regenerate.
- [ ] Inspect the fixture diff: exactly the two new SAPWrite actions (+ description text) added to the
      `onprem-*` files; **no** change to any `btp-*` file. If a btp fixture changed, the actions
      leaked into the BTP enum — fix Task 3.
- [ ] Run `npm test` — snapshot + `registry-sync` + `schema-key-sync` + `zod-jsonschema-parity` all
      green.

### Task 5: Integration round-trip on a live class

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (add a text-symbols round-trip block, using `generateUniqueName()` and `getTestClient()`)

Context: the definitive correctness check. Requires `TEST_SAP_URL` — `requireSapCredentials()` throws
without it, so this is NOT in Validation Commands. Mirror an existing CRUD lifecycle test that
creates a `$TMP` class. Verified live in the dossier; this locks it into CI-with-creds.

- [ ] Add a test that: creates a `$TMP` class `<unique>` whose method body references a text symbol
      (`rv = 'x'(001).`), activates it, then `client.writeClassTextElements(name,'symbols','@MaxLength:10\n001=Hello\n')`,
      then `client.getClassTextElements(name,'symbols')` and asserts the body contains `001=Hello`.
      Clean up the class in a `finally` (`// best-effort-cleanup`).
- [ ] Add a failure-path assertion: writing a malformed body (one `@MaxLength` for two symbols, e.g.
      `'@MaxLength:10\n001=A\n002=B\n'`) rejects — assert with `expectSapFailureClass(err, [406], [/inconsisten|error/i])`.
- [ ] Add a selection-texts happy-path write+read on the same class (`'selections'`).
- [ ] Document run command in the test header comment: `npm run test:integration` (needs `TEST_SAP_URL`).
- [ ] Run `npm test` — unit suite still green (integration runs separately with creds).

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md` (Key Files table — add a class-text-symbols row; nothing for the config table — no new flag)
- Modify: `docs_page/tools.md` (SAPRead CLAS `include` values; the two new SAPWrite actions)
- Modify: `docs_page/roadmap.md` (mark class text-symbol read/write done, or add an entry + current-state row)
- Verify: `.claude/commands/*.md` — check `implement-feature.md` / any ABAP-editing skill for a place that should mention text-symbol maintenance; update only if it references the old gap

Context: docs run last so they describe as-shipped behavior. Be explicit about the release gate and
the class-only scope — do not imply program/funcgroup support.

- [ ] `CLAUDE.md`: add a Key-Files row, e.g. *"CLAS text symbols / selection texts (read+write) |
      `src/adt/client.ts` (`getClassTextElements`/`writeClassTextElements`), `src/handlers/read.ts`
      (CLAS include=text_symbols), `src/handlers/write/update-delete.ts` — top-level
      `/sap/bc/adt/textelements/classes/{n}/source/{symbols|selections}`; PUT needs Content-Type AND
      Accept; on-prem only, absent on 7.50 (discovery-gated); no activation needed"*.
- [ ] `docs_page/tools.md`: under SAPRead document `include=text_symbols|selection_texts` for CLAS;
      under SAPWrite document `edit_text_symbols` / `edit_selection_texts` (body format:
      `@MaxLength:NN` per symbol then `NNN=text`; on-prem; immediately active).
- [ ] `docs_page/roadmap.md`: reflect the new capability.
- [ ] Note the out-of-scope follow-up in `docs_page/roadmap.md` or the dossier: the program
      `SAPRead type=TEXT_ELEMENTS` path is broken (404 on all releases) and should be migrated to the
      same `textelements` service.
- [ ] Run `npm test` — all tests pass (docs-only edits, sanity check).

### Task 7: Final verification

- [ ] `npm test` — all pass
- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — no errors
- [ ] `npm run build` && `npm run check:sizes` — no file-size ratchet breach (client.ts grew; lower/raise budget in the same task if needed)
- [ ] Live verification on **a4h 758** (creds per `INFRASTRUCTURE.md`): build the CLI, create a
      `$TMP` class with a `'x'(001)` reference + activate; `arc1-cli call SAPWrite --json -` with
      `{action:edit_text_symbols,type:CLAS,name:...,source:"@MaxLength:10\n001=Hello\n"}` → success;
      `arc1-cli call SAPRead --type CLAS --name ... --include text_symbols` → body contains `001=Hello`;
      then delete the class. Throwaway smoke scripts must not be committed.
- [ ] Live re-check on **a4h-2025 816** (read at minimum): `SAPRead type=CLAS include=text_symbols`
      on a standard class returns a non-empty pool (service present on 816).
- [ ] Confirm the release gate: on **npl 7.50**, `SAPRead type=CLAS include=text_symbols` returns the
      clean "not available" error (not a raw 404) — the discovery gate fired.
- [ ] Move this plan to `docs/plans/completed/` and fix any relative links inside it (paths gain one `../` level).
