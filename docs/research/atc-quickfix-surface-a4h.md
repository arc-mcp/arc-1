# ATC + Quickfix + Autoqf surface — live findings on A4H

> **What:** A live smoke-test of the ABAP Test Cockpit (ATC), the quickfix engine, and the auto-quickfix batch endpoint against the A4H test system, to ground the "Semi-Automated Fixes of Clean Core ATC Findings" roadmap feature (Joule Feature 2) in what the SAP backend actually does.
> **System:** A4H — S/4HANA 2023, SAP_BASIS 758, on-prem ABAP-cloud developer trial.
> **Method:** `arc1-cli` tool calls + raw ADT `curl` (CSRF-authenticated), 2026-06-03. Built on top of [PR #336](https://github.com/arc-mcp/arc-1/pull/336), which fixed `runAtcCheck` so ATC returns findings at all.
> **Status:** All rows below are live-verified; quotes are actual responses.

---

## TL;DR

| Question | Answer (live) |
|----------|---------------|
| Does ATC produce findings on A4H? | **Yes**, after #336. `SAPDiagnose(atc, variant=PERFORMANCE_DB)` → 1 finding; system-default → 3. ATC content is rich (493 check variants). |
| Do ATC findings carry quickfixes? | **No.** Every finding tested carries `<atcfinding:quickfixes manual="false" automatic="false" pseudo="false"/>` → `hasQuickfix=false`. The Clean-Core "replace SQL with released CDS" autofix content is not installed/configured on this trial. |
| Does the quickfix engine offer anything? | **Yes — refactorings.** `getFixProposals` (`/sap/bc/adt/quickfixes/evaluation`) at an identifier position returns 8–10 proposals: Rename, Convert to attribute / importing / returning / changing / exporting parameter, Assign-to-new-variable, Extract local variable. |
| Can those refactoring proposals be applied via `apply_quickfix`? | **No — HTTP 500.** Their URIs are under `/sap/bc/adt/quickfixes/proposals/providers/refactoring/...`; they ride the separate `/sap/bc/adt/refactorings` multi-step flow, not the generic `proposalRequest` apply. |
| Is the native batch endpoint `/atc/autoqf/worklist` driveable? | **Not without reverse-engineering the step sequence.** GET → 405; POST without a `step` query param → 400 `Parameter step could not be found`. It's a `step=`-parameterized multi-stage protocol (same family as `/refactorings`), and with no auto-fixable findings on A4H there is nothing for it to operate on. |

**Bottom line for Feature 2:** the *analyze* half (run ATC, get findings) is delivered and verifiable (#336). The *auto-fix* half is **not verifiable on this trial** — there are zero quickfix-bearing findings, the universal refactoring quickfixes don't apply through `apply_quickfix`, and the native autoqf endpoint is an opaque multi-step protocol with nothing to fix. Skills should route to LLM-generated fixes when SAP quickfixes are absent or are refactorings.

---

## 1. ATC produces findings (post-#336)

The three-step worklist flow (`POST /atc/worklists?checkVariant=<v>` → `POST /atc/runs?worklistId=<id>` → `GET /atc/worklists/<id>`) returns real findings:

```
SAPDiagnose(action=atc, type=PROG, name=Z_CREATE_BOOKING_SAMPLES, variant=PERFORMANCE_DB)
  → 1 finding: priority 2, line 86, "Search DB Operations: DB Operation INSERT for /DMO/BOOKING found."
SAPDiagnose(action=atc, type=PROG, name=Z_CREATE_BOOKING_SAMPLES)   (system default variant)
  → 3 findings (priority 3)
```

Two gotchas (documented in the `sap-clean-core-atc` / `migrate-custom-code` skills):
- **ATC skips `$TMP`/local objects** — the object set resolves empty → 0 findings. Run against a transportable package.
- **The check variant must exist.** A4H has `S4HANA_READINESS_2023`, `PERFORMANCE_DB`, `SECURITY_*`, `SAP_CLOUD_PLATFORM_DEFAULT`, … but **not** literally `ABAP_CLOUD_READINESS` (that's the BTP/Cloud name). Omitting `variant` uses the system default.

`S4HANA_READINESS_2023` returns `Check not executable, due to missing prerequisites` — the simplification-DB content isn't set up on the trial.

## 2. ATC findings carry no quickfixes on A4H

`hasQuickfix` was `false` for every finding across `PERFORMANCE_DB`, `SECURITY_GENERIC_DB_ACCESS`, `VERI_CLOUDIFICATION_REPOSITORY`, `SAP_CLOUD_PLATFORM_DEFAULT`:

```
PERFORMANCE_DB                 -> total=1 withQuickfix=0
SECURITY_GENERIC_DB_ACCESS     -> total=0 withQuickfix=0
VERI_CLOUDIFICATION_REPOSITORY -> total=0 withQuickfix=0
SAP_CLOUD_PLATFORM_DEFAULT     -> total=3 withQuickfix=0
```

The captured finding XML carries `<atcfinding:quickfixes atcfinding:manual="false" atcfinding:automatic="false" atcfinding:pseudo="false"/>` (see `tests/fixtures/xml/atc-worklist-findings.xml`). The Clean-Core remediation content that would set `automatic="true"` is not present on this trial.

## 3. The quickfix engine returns refactorings, not finding-fixes

`getFixProposals` is independent of ATC — it evaluates `/sap/bc/adt/quickfixes/evaluation?uri=<src>#start=line,col` against a source position. Against a probe class (`MOVE` / `x = x + 1` / `CONCATENATE`):

- On the statement **keyword** (e.g. `MOVE` at col 4) → **0 proposals**.
- On an **identifier** (e.g. `lv_a` at col 9, or `lv_a = lv_a + 1` at col 4) → **8–10 proposals**, all refactorings:

```
Rename 'lv_a'
Convert 'lv_a' to attribute            (.../providers/refactoring/quickfixes/promote_local_to_member)
Convert 'lv_a' to importing|returning|changing|exporting parameter
Assign statement to new local variable | new attribute
Extract local variable [ (replace all occurrences) ]
```

So `getFixProposals` *does* return proposals on A4H, but they are the universal Ctrl+1 **refactorings**, position/identifier-triggered — not finding-specific fixes.

## 4. Refactoring proposals 500 on `apply_quickfix`

Applying "Convert 'lv_a' to attribute" via `apply_quickfix` (POST the proposal URI with a `<quickfixes:proposalRequest>` body):

```
POST /sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/promote_local_to_member
  → HTTP 500 (Application Server Error)
```

Refactoring quickfixes ride the Eclipse LTK / `/sap/bc/adt/refactorings` multi-step framework, which the generic `proposalRequest` apply path does not drive. **The tell is the URI: `/providers/refactoring/`.** Non-refactoring "fix" quickfixes (pseudo-comment, statement replacement, Clean-Core remediation) *do* apply through `apply_quickfix` — but A4H has none to test with.

**Skill guidance added (`migrate-custom-code`):** match the proposal to the finding (don't apply `proposals[0]` blindly); skip `/providers/refactoring/` proposals for automated apply (they 500); fall back to LLM-generated fixes.

## 5. The native autoqf batch endpoint is a `step=` multi-stage protocol

`/sap/bc/adt/atc/autoqf/worklist` (discovery title "Autoquickfix") accepts four content types:
`objectreferences.v1`, `autoqf.proposal.v1`, `autoqf.selection.v1`, `genericrefactoring.v1`.

Live probes:
```
GET  /sap/bc/adt/atc/autoqf/worklist                          → HTTP 405 (POST-only)
POST /sap/bc/adt/atc/autoqf/worklist  (objectreferences body) → HTTP 400
   <exc:exception><type id="ExceptionParameterNotFound"/>
   <message>Parameter step could not be found.</message>
```

The required `step` query parameter confirms a **multi-stage state machine** (same family as `/sap/bc/adt/refactorings`): references → proposal → selection → generic-refactoring deltas. Fully driving it would require reverse-engineering the `step` sequence *and* having auto-fixable findings to feed it — neither is available on A4H. There is no reference implementation in `abap-adt-api` (it wraps `quickfixes/evaluation` and `refactorings`, not autoqf).

---

## Implications for Feature 2 (Clean-Core ATC fixes)

1. **`runAtcCheck` fix (#336)** delivered the analyze half — verifiable, shipped.
2. **The auto-fix half cannot be built to the live-verified bar on A4H.** No quickfix-bearing findings, refactoring quickfixes don't apply via the generic path, and the native autoqf endpoint is opaque + has nothing to operate on.
3. **A faithful Feature 2 build needs a system with the Clean-Core remediation/cloudification content** (BTP ABAP, S/4HANA Cloud, or an on-prem system with the readiness content set up) so that `hasQuickfix=true` findings + applicable fix proposals exist to drive and verify.
4. **Skills now degrade gracefully:** `sap-clean-core-atc` + `migrate-custom-code` document the `$TMP`-skip, variant-naming, refactoring-vs-fix, and quickfix-availability realities, and fall back to LLM-generated fixes when SAP quickfixes are absent.

## Reproduction

All findings are reproducible with `arc1-cli` + the `.env` A4H credentials. The ATC three-step flow and the captured findings format are unit-pinned in `tests/unit/adt/devtools.test.ts` (fixture `tests/fixtures/xml/atc-worklist-findings.xml`) and integration-guarded in `tests/integration/adt.integration.test.ts` ("runAtcCheck (worklist + variant flow)").
