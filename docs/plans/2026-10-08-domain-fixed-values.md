# Domain fixed-value loss (#943)

## Reproduction and cause

Baseline: `c7bbfb5376c90a172538fb440c30b7b41405732f` (current main).
No existing PR for #943 on 2026-10-08. Checked the roadmap; no roadmap impact.

Using the built dispatcher against SAP_BASIS 758 SP02 over HTTPS/Basic, a disposable
`$TMP` CHAR(30) domain accepted `STORAGELOCATIONDATA`, an eleven-character range,
and a 61-character description. Creation and activation succeeded. Both ADT read-back
and active DD07L/DD07T rows showed truncated values. DD03L independently confirms
DOMVALUE_L/H are CHAR(10) and DDTEXT is CHAR(60). Deleted the domain and verified 404.

The XML builder preserves the input; SAP truncates it. The shared runtime fixed-value
schema and both advertised JSON schemas currently admit those lossy inputs.

## Plan and review

1. Bound low/high to ten characters and description to sixty in the existing shared
   runtime schema. Keep omitted high/description, empty values, and empty arrays valid.
2. Advertise the same bounds in top-level and batch tool schemas and document them.
3. Prove oversized create/update/batch inputs cause zero HTTP calls, including a batch
   whose earlier object is valid. Cover on-prem and BTP schema variants and exact limits.
4. Review snapshot changes; run all local gates and live valid/invalid round trips.

Reviewed alternative: truncating in the XML builder would retain silent data loss.
A post-write comparison would detect the error only after mutation. Shared input
validation is smaller and protects the whole batch before creating its first object.
No new release heuristics, backend probes, or generic validation framework are needed.

## Verification

- The regression file has 33 tests: 27 fail against main, all pass with the fix.
  The complete suite passes (7,977 tests), as do typecheck, lint, policy, build, and
  file/schema budgets. Five writable tool snapshots change only the three bounds
  in their two fixed-value schemas. The tools.ts line budget increases by four lines
  because Biome expands the batch properties after adding their bounds.
- The built candidate dispatcher on 758 SP02 rejects all nine oversized field/action
  combinations with zero HTTP calls. Exact 10/10/60 values survive create + activation
  + read-back. Partial updates preserve CHAR(30); clearing the values still works.
  Deleted the fixture and verified 404. Review found no remaining actionable issue.
- NPL 750 SP02 returns 404 for both freestyle SQL and the domain collection; the
  attempted reproduction created no object. No live 750 domain-write coverage is
  claimed. 816 is unavailable because of its previously confirmed license error.
  BTP and principal propagation were not retested; BTP input schemas have unit coverage.
- Rechecked the roadmap before publication: no roadmap impact.
