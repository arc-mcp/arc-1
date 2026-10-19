# Bounded syntax checks: extraction from #1011

## Outcome

Check a short list of stored ABAP objects in one SAP request. Keep per-object failures and
missing evidence visible. This is a syntax check, not ATC, activation or transport approval.

## Small public contract

- Extend `SAPDiagnose(action="syntax")` using its existing `objects: [{type,name}]` input.
  Keep SAPRead and both single-object/proposed-source routes unchanged. Reusing the bounded
  ATC object input avoids another list schema or a second batch entry point.
- One to twenty CLAS/INTF/PROG/DDLS objects; PROG stays excluded on BTP. Normalize known
  type aliases and ASCII names, reject duplicate identities and arbitrary URLs.
- Batch calls accept only action, objects and version (active/default or inactive).
  Preserve harmless strict-client defaults; reject ambiguous single/batch inputs and supplied source.
- Return results in input order: passed, failed or not-checked, with native messages.
  Missing/duplicate/unprocessed reports, unknown severity and unowned messages make the
  overall response incomplete. Preserve known failures even when another object is unchecked.
- Report the requested source version and check time. SAP does not supply an immutable
  source hash or independent version confirmation; do not infer either or reuse this as
  proof about a historical transport snapshot.

## Implementation

Extract the bounded native checkObjectList request and report reconciliation from #1011.
Reuse the existing native message mapper directly instead of converting parsed XML back to
XML and parsing it again. Keep ownership/reconciliation local to the batch module and use the
existing dispatcher, read policy, per-user HTTP client, cancellation and byte/deadline controls.
Limit the operation to 30 seconds and 512 KiB; no cache, source collector, scheduler or retries
for missing reports. Explicit errors allow the caller to choose a smaller/single check.

## Spike and checks

1. Recheck the native list contract on A4H/001, HTTPS 443, existing objects only. Compare
   native batch reports with single checks; include one nonexistent object and explicit
   inactive requests. Record release/auth route, returned reports and limits without source.
2. Replay the original 758 fixture. Add regression tests for reordered/missing/duplicate/
   foreign reports, later sibling errors, unknown severity, malformed/oversized XML, request
   bounds, cancellation, scope/deny rules, aliases/namespaces and single-object compatibility.
3. Verify BTP and multi-target surfaces and request identities without claiming live PP coverage.
4. Measure a bounded local-model single-vs-batch task if the local model service is available.
   Count correct results and actual calls; preserve failed trials and do not claim universal gains.
5. Full unit tests, build/typecheck/lint/policy/schema budgets, documentation checks and CI.
   Concise tools guide: example, result interpretation and limits. Keep detailed evidence separate.
6. Review the plan and implementation, fix findings, then Claude Code Opus 5.5 Max review
   (GUI requested; awaiting the macOS assistive-access fix). Create a draft PR with exact evidence.
   Close #1011 only after this extraction preserves the remaining useful work and deferred evidence.

## Plan review

Reuse the existing SAPDiagnose object-list schema and normalization. Avoid the umbrella
diagnostic-input framework and a second batch entry point.
A valid empty native envelope cannot mean success. Messages belong to the triggering object
report; a linked message location is not a replacement owner. Namespace normalization must not
accept arbitrary URI suffixes. Preserve single-object output exactly and stay within main's
catalog ceiling; any wording changes need focused regression coverage.

## Validation record

See the [live evidence, model comparison and review](../research/2026-10-19-bounded-syntax-extraction.md).
