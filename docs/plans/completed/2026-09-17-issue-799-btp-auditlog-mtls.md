# Issue #799 — make the BTP Audit Log sink genuinely usable

**Status:** Completed and verified on 2026-09-17.

## Goal

Make ARC-1 enable the BTP Audit Log sink only for a complete X.509 binding, perform the token
exchange with actual mTLS, send schema-valid data events, and make later delivery failures visible
without flooding application logs.

Verified evidence and the root-cause analysis are in
[`docs/research/issues/799-btp-auditlog-mtls.md`](../../research/issues/799-btp-auditlog-mtls.md).

## Design constraints

- Reuse the existing `@sap/xssec` dependency; do not implement TLS or OAuth ourselves.
- Preserve fire-and-forget tool-call behavior. A temporary Audit Log outage must not fail an SAP
  tool call.
- Keep the premium BTP service optional and inactive in the shipped MTA.
- Do not add a new strict-mode environment variable in this fix.
- Preserve the existing audit-event payload mapping except for SAP-system subject attribution on
  data-access and data-modification records.

## Plan

1. Harden binding parsing and token acquisition.
   - Validate the selected binding's base URL and X.509 UAA strings.
   - Throw one actionable, secret-free startup error listing missing fields.
   - Replace the hand-written token request/cache with `XsuaaService.getClientCredentialsToken()`.
   - Track pending sends in a `Set` so settled work is removed immediately.

2. Make failures operationally visible.
   - Have the sink invoke an injected error reporter at most once per minute.
   - In server startup, route that reporter through the structured logger at `warn` level.
   - Log invalid selected bindings at `error` and never print `sink enabled` for them.

3. Complete the data-event payload contract.
   - Add one `data_subject` to data-access and data-modification records only.
   - Identify the SAP system by public target, destination name, or a stable single-target fallback.
   - Keep security and configuration payloads unchanged.

4. Provide correct optional deployment wiring.
   - Add an inactive `arc1-auditlog` premium resource to `mta.yaml`.
   - Put SAP's X.509 parameters on both the service instance and module binding.
   - Show the single `active: true` override in `mta-overrides.mtaext.example`.
   - Add descriptor assertions so later edits cannot silently remove either half.

5. Update operator documentation.
   - Add MTA and manual CF setup examples to the canonical BTP runbook.
   - Verify the materialized binding type/field presence without printing credentials; do not trust
     `cf bind-service` returning `OK` by itself.
   - Explain certificate validity, rotation by rebinding/restaging, startup errors, and rate-limited
     runtime warnings.
   - Correct the security guide's activation description.

6. Verify and review.
   - Run the focused sink and descriptor tests first.
   - Run typecheck, lint, all unit tests, strict docs build, and MTA validation/build.
   - Review the complete diff for secret exposure, accidental default service activation, payload
     changes, and unnecessary configuration surface.

## Plan review

The plan intentionally does not add `@sap/audit-logging`, a custom Undici dispatcher, a startup
network probe, retries, or `SAP_AUDIT_REQUIRED`. Each would add policy or lifecycle behavior beyond
the validated bug. `@sap/xssec` already supplies the exact mTLS client-credentials operation and
token cache. The optional MTA resource is necessary because an extension can activate a base
resource but cannot add a new one; leaving it inactive preserves every existing deployment.

## Acceptance criteria

- A selected non-X.509 binding produces one actionable startup error and no enabled message.
- A valid binding reaches the Audit Log API using an X.509-authenticated token.
- Data-access records carry the required SAP-system `data_subject`; data-modification records use
  the same attribution. Security and configuration records do not carry it.
- Repeated delivery failures produce at most one structured warning per minute.
- The base MTA does not create Audit Log Service; the documented override creates and binds it with
  X.509 parameters.
- Existing event categories and payload fields remain unchanged except for data-subject attribution.
- Focused and full validation gates pass.

## Verification result

- 37 focused sink and MTA descriptor tests pass.
- All 6,798 unit tests, typechecking, lint, file/schema budgets, and strict docs build pass.
- All shipped MTA descriptor variants validate; base and Audit-Log-enabled MTAR builds pass.
- The us10 smoke verified the fixed sink's token acquisition and security-event delivery. The issue
  author's eu10 probe verified mTLS on the first PR commit and independently tested the exact
  data-subject shape adopted here: all four categories returned HTTP 201 and the data-access record
  was retrievable. The latest PR head has not had a separate live four-category rerun.
- Review found no secret output, default service activation, payload change outside data-subject
  attribution, new dependency, or unnecessary configuration surface.

## Final maintainability review

- Removed the redundant token wrapper; the send path now calls SAP's token client directly.
- Kept the implementation to binding validation, one token client, one pending-write set, and one
  warning timestamp. No additional auth abstraction, queue, retry layer, or configuration was needed.
- Strengthened regressions for client-secret exclusion, supported binding aliases, invalid key
  values, token failures, HTTP rejection, target precedence, and settled-write cleanup without
  calling `flush()`.
- Corrected the documentation to distinguish the required data-access subject from consistent
  attribution on modifications, and to identify whose live probe established each result.
- No blocking findings remain. Shared CI test jobs are excluded from this assessment as requested;
  the local validation above is the merge-readiness evidence.
