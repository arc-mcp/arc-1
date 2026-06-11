# PR #403 — fix(adt): make SRVB publish/unpublish content negotiation 758-proof

- **PR**: https://github.com/marianfoo/arc-1/pull/403 (branch `claude/wonderful-buck-c8e366`, same-repo, not a fork)
- **Reviewed**: 2026-06-11, after rebasing onto `origin/main` @ `bc5cfc46` (post-#402 handler split) per maintainer request
- **Verdict**: **APPROVE (after rebase + one added commit)** — see "What the rebase surfaced" below; the PR as originally pushed did *not* fix the reported bug on current main and was extended with the real root-cause fix during this review.

## Scope

Reported symptom: `SAPActivate action=publish_srvb` → HTTP 406 "The message content is not acceptable"
against a4h (S/4HANA 2023, SAP_BASIS 758), publishing SRVB `ZSSI_UI_S_ORD_O4`.

The PR (commit 1) hardens the `publishjobs`/`unpublishjobs` POST content negotiation in
`src/adt/devtools.ts`. The review-added commit 2 fixes the package-gate metadata read in
`src/handlers/{activate,write-helpers}.ts`, which turned out to be the actual production failure.

## What the rebase surfaced (the real root cause)

Re-running the live verification on the rebased branch immediately failed — but **not** on the
publish POST. The failing request was the **package-gate metadata read** introduced by
[#394 "fix: enforce SRVB package gate"](https://github.com/marianfoo/arc-1/pull/394) (shipped in
**0.9.14**, merged after this PR's original live verification):

```
GET /sap/bc/adt/businessservices/bindings/ZARC1_UI_TRAVELDEMO_O4
Accept: application/vnd.sap.adt.businessservices.servicebinding.v2+xml; charset=utf-8
→ 406 SADT_RESOURCE 037 ("The message content is not acceptable", NO accepted-types list)
```

Isolated by header bisection (curl, both live systems):

| Accept on `GET /businessservices/bindings/{name}` | 758 (a4h) | 816 (a4h-2025) |
|---|---|---|
| `…servicebinding.v2+xml; charset=utf-8` | **406** (T100 037) | **406** |
| `…servicebinding.v2+xml` (bare) | 200 | 200 |

- The backend rejects **any media-type parameter on the Accept** for this resource, on **both**
  on-prem releases.
- The 406 body names no accepted type (T100 037 has no V1 param), so the generic HTTP-layer
  negotiation retry (`inferAcceptFromError`) cannot infer a fallback; its `application/xml`
  fallback is also not renderable by this resource → double 406 → tool call fails.
- The gate runs whenever `allowedPackages` is restricted — **the default is `['$TMP']`**, so on
  0.9.14 `publish_srvb`/`unpublish_srvb` fail on virtually every real deployment **before the
  publish POST is ever sent**. `SAPRead type=SRVB` still works (reads are never package-gated),
  which makes the failure look publish-specific — matching the original report.
- The original report's error text "The message content is not acceptable" is the T100 **037**
  message from this gate read; the quoted "Accepted content types: application/vnd.sap.as+xml"
  (T100 **044**) is the *publishjobs* 406 shape, reproducible only by sending the
  `…odatav4.v1+xml` Accept to the POST (e.g. via manual repro experiments). Two distinct 406s,
  conflated into one narrative — the PR's first commit fixed the second, rarer one.

## Commits under review

### Commit 1 — `fix(adt): make SRVB publish/unpublish content negotiation 758-proof` (`src/adt/devtools.ts`)

Verified facts (curl matrix on a4h 758, publish/unpublish POST):

| Content-Type | Accept | Result |
|---|---|---|
| `application/xml` | `application/*` | 200 |
| `…odatav4.v1+xml` | `application/*` | 200 |
| `application/xml` | `…odatav4.v1+xml` | **406** T100 044, names `application/vnd.sap.as+xml` |
| anything | `application/vnd.sap.as+xml` (bare, composite, or with `dataname=` ) | 200 |

- The POST 406 is **Accept-driven**; request Content-Type isn't validated on 758.
- 758 renders the job status only as `application/vnd.sap.as+xml`. All four
  `dataname=com.sap.adt.businessservices.{odatav2|odatav4}.{publishjob|unpublishjob}` types
  verified live → 200.
- Discovery is structurally unable to pick the right type here: 758 has no publishjobs entries
  (shallow-match falls back to the parent collection's `…odatav4.v1+xml` — exactly the type that
  406s); 816 lists publishjobs only as `templateLink`s without accepts.

Change: primary Accept → `application/vnd.sap.as+xml, application/*;q=0.8`; self-scoping
406/415→dataname-qualified-as+xml retry (`postPublishJob`). Correct, evidence-backed, and the
right shape (mirrors the `crud.ts` lock Accept; ADR-0002-style narrow quirk).

### Commit 2 (added during this review) — `fix(handlers): SRVB publish package-gate read must send a parameter-less Accept`

- New `SERVICEBINDING_V2_ACCEPT` (bare type) in `src/handlers/write-helpers.ts:69`; both gate
  calls in `src/handlers/activate.ts` (publish + unpublish) use it. The `; charset=utf-8` form
  remains for PUT/POST **Content-Type** (where it is correct and long-verified).
- Checked all other `enforceAllowedPackageForObjectUrl` call sites: only the two publish/unpublish
  gates passed a parameter-carrying Accept. SDO gates pass the parameter-less blues type
  (fine); update/delete/activate/change_package pass no Accept (discovery-negotiated bare type
  — fine).

## Gates (run on the rebased branch, `bc5cfc46` base)

- `npm run typecheck` ✓ · `npm run lint` ✓ (485 files) · `npm run check:sizes` ✓ (file-size ratchet)
- `npm test` ✓ **3719 passed** (3718 post-refactor + 1 new gate regression test)

## Live verification (this review, rebased code, restricted allowlist `Z*,$TMP`)

- **a4h 758**: V4 `ZARC1_UI_TRAVELDEMO_O4` unpublish→republish ✓; V2 `ZTEST_MCP_SB_FLIGHT`
  (serviceType auto-detected) unpublish→republish ✓ — `published` readback confirmed each step.
- **a4h-2025 816**: `ZSB_ARC1_SMOKE` unpublish→republish ✓.
- **Deny path** (allowlist `$TMP`, binding in `Z_RAP_VB_BC26`): clean
  `AdtSafetyError: Operations on package 'Z_RAP_VB_BC26' are blocked by safety configuration
  (allowed: [$TMP])` — the gate now resolves the real package and denies properly instead of
  surfacing the 406.
- All test bindings restored to their original **published** state on both systems.

## Invariant checklist

- [x] Safety guard: publish/unpublish keep `checkOperation(…, OperationType.Activate, …)`;
      gate read goes through `resolveObjectPackage` (`OperationType.Read`). No unguarded HTTP.
- [x] Scope policy: no new tool/action — `ACTION_POLICY` untouched, nothing to add.
- [x] Package gating: **strengthened** — the #394 gate now actually works on 758/816 instead of
      failing closed with a misleading 406; fail-closed semantics preserved (no-packageRef →
      `AdtSafetyError`).
- [x] Three-file schema sync: no schema surface change (no new params) — N/A.
- [x] Per-user auth: untouched.
- [x] stdout sacred: only `logger.debug` (stderr) added.
- [x] Typed errors: fallback rethrows original `AdtApiError` when not the as+xml complaint;
      no error shapes changed.
- [x] `withSafety()` clone: no new `AdtClient` instance fields — N/A.

## Test adequacy

- `tests/unit/adt/devtools.test.ts`: 6 new cases using the **verbatim a4h 406 body** — fallback
  fires with the right dataname per serviceType×job; 406 without the as+xml mention not retried;
  non-negotiation errors not retried; failing retry surfaces without looping. 2 existing header
  assertions updated to the composite Accept.
- `tests/unit/handlers/intent.test.ts`: new test runs `publish_srvb` with a **restricted**
  allowlist (gate active) and pins the gate GET's wire Accept to the bare media type
  (`expect(gateHeaders.Accept).not.toContain('charset')`).
- Slow E2E `rap-write.slow.e2e.test.ts` (create→activate→publish→unpublish→delete) still covers
  the full lifecycle path end-to-end.

## Residual notes (non-blocking)

1. ~~An equivalent unpublish-gate test would be symmetric polish.~~ **Implemented** (review
   follow-up commit): `intent.test.ts` now pins the gate GET's bare Accept for both
   `publish_srvb` and `unpublish_srvb`. (Background: the `DEFAULT_CONFIG`-based publish tests
   run with an *unrestricted* allowlist, so the gate path was previously untested — that blind
   spot let #394 ship the 406.)
2. ~~`resolveObjectPackage` could defensively strip media-type parameters at the choke point.~~
   **Implemented** (review follow-up commit): `resolveObjectPackage` sends only the bare media
   type from any caller-supplied Accept (`src/adt/client.ts`), with a unit test. Call sites keep
   passing the bare `SERVICEBINDING_V2_ACCEPT` for clarity; the choke point now protects future
   callers.
3. The published-state readback after publish parses `getSrvb` JSON and only checks
   `published === false` — fine, but it means a readback parse failure silently passes. Existing
   behavior, unchanged by this PR.
