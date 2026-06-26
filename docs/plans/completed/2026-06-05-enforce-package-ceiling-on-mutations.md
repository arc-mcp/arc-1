# Enforce the `allowedPackages` Ceiling on All Mutating Operations

## Overview

A white-box security review (2026-06) found two mutating operations that skip the `allowedPackages`
safety ceiling that every create/update/delete path enforces:

1. **`SAPActivate`** (single + batch) and **`publish_srvb`/`unpublish_srvb`** build the object URL
   from `type`+`name` and call `activate()`/`activateBatch()`/`publish*ServiceBinding()` — gated only
   by `checkOperation(Activate)` (which requires `allowWrites=true` but **never** consults
   `allowedPackages`). A write-scoped user confined to e.g. `allowedPackages=['$TMP']` can therefore
   activate a pre-existing inactive draft of an object in a restricted package — a write-class state
   change in a package they cannot write to. (MEDIUM; the dominant impact is in shared-service-account
   / no-Principal-Propagation deployments where `allowedPackages` is the sole package boundary.)

2. **`SAPManage(action="change_package")`** gates the caller-supplied `oldPackage` and `newPackage`
   strings, but never resolves the object's **real** package. A user could move an object that actually
   lives in a restricted package into an allowed one by lying about `oldPackage`, if SAP relocates by
   `objectUri`+`newPackage`. The ARC-1-side asymmetry (gating attacker-controlled strings instead of the
   object's true package) is a real authorization gap regardless of SAP's behavior.

Both share one root cause: package isolation is enforced via the object's **real** package on
create/update/delete/surgery (`enforcePackageForExistingObject` → `resolveObjectPackage` + `checkPackage`,
fail-closed), but these two name/URI-keyed mutating operations skip that resolution. This plan introduces a
single shared module-level helper and applies it to both, so every mutating op that targets an existing
object honors the same boundary.

It also hardens the CI policy validator (`scripts/validate-action-policy.ts`), which currently asserts only
that every action *exists* in `ACTION_POLICY` (a too-low tool-level fallback satisfies it). Adding an
opType↔scope consistency assertion turns a latent future-regression hole — a state-changing action silently
falling back to a `read`-default tool's scope — into a CI error.

## Context

### Current State
- `enforcePackageForExistingObject()` (a closure inside `handleSAPWrite`, `src/handlers/intent.ts:3743-3754`)
  is the correct, fail-closed pattern: `if allowedPackages empty → skip; pkg = resolveObjectPackage(objectUrl);
  if !pkg → throw AdtSafetyError; checkPackage(pkg)`. It is used by update/delete/edit_method/surgery only.
- `handleSAPActivate` (`src/handlers/intent.ts:5657-5893`) has **no** `checkPackage`/`enforcePackageForExistingObject`
  call in the single path, the batch path, or the publish/unpublish SRVB blocks.
- `change_package` (`src/handlers/intent.ts:7556-7635`) gates `oldPackage`/`newPackage` (both from `args`,
  lines 7559-7560, 7572-7573) but never `resolveObjectPackage(objectUri)`.
- `scripts/validate-action-policy.ts` Pass 1 (line 80) only errors when **both** the specific and tool-level
  keys are absent; it never checks that a mutating opType maps to a write-family scope.

### Target State
- A module-level helper `enforceAllowedPackageForObjectUrl(client, objectUrl, label)` performs the
  resolve-and-gate, fail-closed, no-op when unrestricted.
- `handleSAPActivate` gates the activated object's real package before single activation, before batch
  activation (every object; abort the whole batch if any is outside), and before publish/unpublish SRVB.
- `change_package` gates the object's **real** package (resolved from `objectUri`) in addition to `newPackage`.
- `validate-action-policy.ts` fails CI if any `ACTION_POLICY` entry pairs a mutating opType with a
  non-write-family scope, a `Query` opType with less than `data`, or a `FreeSQL` opType with less than `sql`.

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `handleSAPActivate`, `change_package`, `enforcePackageForExistingObject`; add the shared helper + the new gate call sites |
| `src/adt/client.ts` | `resolveObjectPackage(objectUrl): Promise<string>` (returns `''` when undeterminable) — reused, not changed |
| `src/adt/safety.ts` | `checkPackage`, `OperationType`, `SafetyConfig.allowedPackages` — reused; the validator imports `OperationType` |
| `src/authz/policy.ts` | `ACTION_POLICY` (opType+scope per action), `allPolicyKeys()` — read by the validator |
| `scripts/validate-action-policy.ts` | CI validator — add opType↔scope consistency pass |
| `tests/unit/handlers/intent.test.ts` | Unit tests for activate/change_package package gating |
| `tests/unit/authz/policy.test.ts` | Add a test mirroring the validator's consistency invariant |

### Design Principles
- **Reuse the fail-closed pattern.** The new helper is the same logic as `enforcePackageForExistingObject`,
  hoisted to module scope and parameterized by object URL + a label for the error message.
- **No extra HTTP when unrestricted.** The helper early-returns when `allowedPackages` is empty, so the
  default (unrestricted) deployment pays nothing — matching the existing write-path behavior.
- **Fail closed.** If the object's package cannot be resolved from ADT metadata, refuse the operation.
- **Gate the real package, never the caller-claimed one.** For `change_package`, authorization is based on
  the package resolved from `objectUri`, not the user-supplied `oldPackage`.
- **Abort batches atomically.** Batch activation gates every object before activating any; one out-of-bounds
  object fails the whole call (no partial activation).
- **Defense-in-depth is preserved.** This is the ARC-1 ceiling; under principal propagation SAP's native
  `S_DEVELOP` package check still applies independently.

## Development Approach

Implement the shared helper first, then wire it into the three call sites, then harden the validator, then
docs. Each code task adds unit tests using the existing `vi.mock('undici', ...)` + `mockResponse()` pattern
(`tests/helpers/mock-fetch.ts`) and a client built with a **restricted** `allowedPackages` to exercise the
gate (mirror existing `checkPackage` tests in `tests/unit/handlers/intent.test.ts`). The package-resolution
GET is mocked to return an `adtcore:packageRef adtcore:name="..."` body. These are code-only authorization
changes → unit tests only (no integration/E2E needed; activation against the live system is already covered).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run validate:policy`

### Task 1: Add the shared `enforceAllowedPackageForObjectUrl` helper

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Hoist the existing fail-closed package-gate logic into a module-level helper so activation and
`change_package` can reuse it (today it is a closure inside `handleSAPWrite`).

- [ ] Add a module-level `async function enforceAllowedPackageForObjectUrl(client: AdtClient, objectUrl: string, label: string): Promise<string | undefined>` near the other intent.ts helpers. Body: `if (client.safety.allowedPackages.length === 0) return undefined;` → `const pkg = await client.resolveObjectPackage(objectUrl);` → `if (!pkg) throw new AdtSafetyError(\`${label} blocked: ARC-1 could not determine the object's package from ADT metadata (no adtcore:packageRef/containerRef). Fail-closed because allowedPackages is restricted.\`);` → `await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());` → `return pkg;`
- [ ] Refactor the existing closure `enforcePackageForExistingObject()` (`src/handlers/intent.ts:3743-3754`) to delegate: `return enforceAllowedPackageForObjectUrl(client, objectUrl, \`Operations on ${type} '${name}'\`);` — keep its existing call sites and return semantics intact.
- [ ] Confirm `AdtSafetyError`, `checkPackage`, and `client.getPackageHierarchyResolver` are already imported/in-scope in intent.ts (they are — used by the closure today).
- [ ] Add unit tests (~3 tests): (a) returns `undefined` and makes no HTTP call when `allowedPackages` is empty; (b) resolves the package and passes when the object's package matches the allowlist; (c) throws `AdtSafetyError` when the resolution GET returns a body with no `packageRef`/`containerRef` (fail-closed). Use a client with restricted `allowedPackages` and mock the GET via `mockResponse(200, '<...adtcore:packageRef adtcore:name="ZALLOWED"/>...')`.
- [ ] If any existing test asserts the exact old `enforcePackageForExistingObject` error string, update it to the new wording.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Package-gate `SAPActivate` (single, batch, publish/unpublish SRVB)

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`handleSAPActivate` (`src/handlers/intent.ts:5657-5893`) currently activates any object the caller names,
ignoring `allowedPackages`. Gate every activation target by its real package using the Task 1 helper.

- [ ] **Single path:** immediately after `objectUrl` is built (~line 5874, before `const result = await activate(...)`), add `await enforceAllowedPackageForObjectUrl(client, objectUrl, \`Activation of ${type} '${name}'\`);`. The thrown `AdtSafetyError` is formatted by `handleToolCall`'s outer error handler — no local catch needed (matches how other safety errors surface).
- [ ] **Batch path:** after the `objects` array is built (~line 5811, before `const result = await activateBatch(...)`), gate every object: `for (const o of objects) { await enforceAllowedPackageForObjectUrl(client, o.url, \`Activation of ${o.type} '${o.name}'\`); }`. One out-of-bounds object aborts the whole batch before any activation.
- [ ] **publish/unpublish SRVB — intentionally NOT gated here.** The SRVB binding URL
  (`/sap/bc/adt/businessservices/bindings/<name>`) returns JSON, not ADT XML with `adtcore:packageRef`
  (see `client.getSrvb`), so `resolveObjectPackage` returns `''` for it — a fail-closed gate would wrongly
  block ALL legit publish/unpublish when packages are restricted. Leave publish/unpublish ungated in this
  task and add a brief follow-up note in the docs task (SRVB package gating needs an SRVB-specific package
  lookup). The primary exploit (activating a draft in a restricted package) is fully covered by gating
  single + batch activation.
- [ ] Add unit tests (~4 tests): with a client restricted to `allowedPackages=['$TMP']` and the
  package-resolution GET mocked to return `adtcore:packageRef adtcore:name="ZRESTRICTED"`: (a) single
  `SAPActivate(type=CLAS, name=...)` is blocked with a safety error and never calls the activate endpoint;
  (b) single activation in an allowed package (`packageRef="$TMP"`) proceeds; (c) batch activation with one
  restricted object is blocked and activates nothing; (d) with **unrestricted** `allowedPackages` (default),
  activation proceeds with no extra package-resolution GET (assert the activate endpoint is reached). Mirror
  the existing activate tests in `tests/unit/handlers/intent.test.ts`.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Package-gate `change_package` by the object's real package

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`change_package` (`src/handlers/intent.ts:7556-7635`) gates the caller-supplied `oldPackage`/`newPackage`
but never the object's actual package, so a caller can lie about `oldPackage`. Gate the resolved real package.

- [ ] After `objectUri` is resolved (after the search block that ends ~line 7591, before the transport pre-flight / `changePackage` call ~line 7622), add a real-package gate: `await enforceAllowedPackageForObjectUrl(client, objectUri, \`change_package of ${objectName}\`);`. This resolves the object's true package and runs `checkPackage` on it (fail-closed if undeterminable). Keep the existing `checkPackage(newPackage)` call (gates the target). The existing `checkPackage(oldPackage)` may remain as defense-in-depth but is no longer the authoritative source gate — add a one-line comment that the real-package check is the authoritative one.
- [ ] Since `enforceAllowedPackageForObjectUrl` throws `AdtSafetyError` (surfaced by the outer handler), no local catch is required; do not convert it to `errorResult` unless an existing `change_package` test expects a non-error tool result for the blocked case.
- [ ] Add unit tests (~3 tests): with a client restricted to `allowedPackages=['ZALLOWED']`: (a) `change_package` is blocked when the object's resolved real package is `ZSECRET` even though `oldPackage="ZALLOWED"` and `newPackage="ZALLOWED"` are passed (the resolution GET on `objectUri` returns `packageRef="ZSECRET"`), and the `changePackage` endpoint is never called; (b) it proceeds when the resolved real package is `ZALLOWED` and `newPackage="ZALLOWED"`; (c) with unrestricted `allowedPackages`, no extra real-package GET is made. Provide `objectUri` directly in the args to bypass the search step in tests.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Harden the policy validator with an opType↔scope consistency pass

**Files:**
- Modify: `scripts/validate-action-policy.ts`
- Modify: `tests/unit/authz/policy.test.ts`

The validator (`scripts/validate-action-policy.ts`) asserts key existence only. Add a pass that catches a
state-changing action mapped to a too-low scope (e.g. a future action that silently inherits a `read`
tool-level default).

- [ ] In `scripts/validate-action-policy.ts`, import `OperationType` from `../src/adt/safety.js`. Add a Pass (after Pass 2) iterating `allPolicyKeys()` → `ACTION_POLICY[key]`: define `MUTATING = new Set([OperationType.Create, OperationType.Update, OperationType.Delete, OperationType.Activate, OperationType.Workflow, OperationType.Transport])`, `WRITE_FAMILY = new Set(['write','transports','git','admin'])`. For each entry: if `MUTATING.has(opType)` and `!WRITE_FAMILY.has(scope)` → push error; if `opType === OperationType.Query` and `!['data','sql','admin'].includes(scope)` → error; if `opType === OperationType.FreeSQL` and `!['sql','admin'].includes(scope)` → error. Error text should name the key, opType, and scope.
- [ ] Verify the current matrix passes: run `npm run validate:policy` — it must still exit 0 (all existing entries are already consistent). If it flags an entry, that is itself a real finding — fix the policy entry.
- [ ] Add a unit test in `tests/unit/authz/policy.test.ts` (~1-2 tests) asserting the invariant directly over `ACTION_POLICY`: every entry with a mutating opType has a write-family scope; every `Query` entry has `data`/`sql`/`admin`; every `FreeSQL` entry has `sql`/`admin`. This locks the invariant even outside the CI script.
- [ ] Run `npm test` and `npm run validate:policy` — both must pass.

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/authorization.md` (and/or `docs_page/security-guide.md` if present)
- Modify: `docs/research/2026-06-05-security-audit-2026-06-oauth-and-scope.md`

Record the new enforcement so the model and operators know activation and `change_package` honor
`allowedPackages`.

- [ ] In `CLAUDE.md`, update the package-allowlist row(s) in the Key Files / config area to note that the
  `allowedPackages` ceiling is enforced on activation and `change_package` (not just create/update/delete),
  via the shared `enforceAllowedPackageForObjectUrl` helper.
- [ ] In `docs_page/authorization.md`, update the package-allowlist section to state that activation and
  package-change operations are gated by the activated/moved object's real package, fail-closed.
- [ ] Append a short "Package-ceiling enforcement on activation & change_package" note to
  `docs/research/2026-06-05-security-audit-2026-06-oauth-and-scope.md` summarizing the two findings and the fix
  (cross-reference this plan).
- [ ] Run `npm run lint` — no errors (docs changes shouldn't trip lint, but confirm).

### Task 6: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run `npm run validate:policy` — exits 0.
- [ ] Confirm the activation and `change_package` paths reach `enforceAllowedPackageForObjectUrl` (grep the call sites) and that the unrestricted-deployment path makes no extra package-resolution HTTP call.
- [ ] Move this plan to `docs/plans/completed/`.
