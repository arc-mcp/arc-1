# DRTY support — reviewed implementation plan

## Decision and evidence

Keep #832 and its shared-engine registry entry. DRTY is a separate CDS type object at
`/sap/bc/adt/ddic/drty/sources`, not DDLS. Metadata is `blue:blueSource` with
`application/vnd.sap.adt.blues.v1+xml`, subtype `DRTY/STY`; source writes are `text/plain`.
The existing stateful SDO engine supplies CRUD, package gates and activation without another layer.
See the [wire contract and independent verification](../research/2026-09-18-drty-cds-type-adt-contract.md).

Independent probes on 2026-09-23 found the collection on SAP_BASIS 758 SP02 and 816 SP01,
and absent on 750 SP02. SAP's feature table independently lists scalar and enum CDS types on 7.58.
Dispatcher lifecycles on both 758 and 816 verified scalar and enum creation, active/draft separation,
invalid-source activation refusal, and deletion followed by 404.

## Changes

1. Retain the one registry entry, shared type-table derivation, existing scope/package gates,
   and discovery gating. Merge current main to retain the create replay protection from #830.
2. Replace the package-specific integration fixture search with a bounded DRTY object search.
   Add focused dispatcher regression coverage for the actual URL/body/content type, unavailable
   collections, and write/package refusals. Test malformed source through SAP activation, not an
   invented local DRTY parser.
3. Correct documentation to include 7.58; explain canonical `type=DRTY`, plain `define type`
   source, unversioned developer reads, inactive saves, separate activation, and deletion order.
   Keep measured wire-contract evidence; remove duplicated narrative and stale test claims.
4. Narrow FEAT-73 to DRAS/DSFI. Preserve ARCH-02's unimplemented generic diagnostics/transport
   routing gap. Do not imply DRTY is supported by every tool that accepts a free-text type.

## Plan review

- No new abstraction, format switch, automatic repair, dependency crawler or release pin is needed.
- The original integration test did not pin the write MIME type: the shared reader attempts JSON
  parsing regardless of the registry format. Pin the real source PUT instead of overstating coverage.
- `version=active/inactive` is currently ignored by SDO reads. Document this existing contract;
  explicit version support needs a separate coherent change across SDOs.
- `DRTY/STY` slash alias support stays out of scope with the other SDO aliases; show `DRTY` in examples.
- The contributor's 816 dependent-delete orphan finding is material. Document child-first deletion
  and track the shared-engine gap in #839; do not intentionally orphan an object during routine tests.
- No BTP runtime claim follows from an on-prem cloud-language object or a generated BTP schema.

## Acceptance

Run full unit tests, typecheck, lint, policy, build, file/schema budgets and strict docs. Exercise
scalar and enum CRUD through the dispatcher on disposable test objects, verify active/draft state,
invalid activation, safety refusals, and cleanup. Run the focused integration read on 758/816 and
verify the unavailable path on 750. Record exact coverage and remaining gaps in the PR.
