# DRTY (CDS Type) read and write

## Plan

`DRTY` is a plain "blue" server-driven object, structurally identical to `DSFD`. The SDO engine in
`src/adt/server-driven.ts` already implements metadata read, source read, create, source update and
delete generically, `SAPActivate` already routes SDO types, and the `SAPRead`/`SAPWrite` type tables
in `src/handlers/tool-registry.ts` derive from `SDO_TYPES`. Registering the type is therefore the
only functional step; there is no new code path.

Append `'DRTY'` to `SDO_TYPES` and add the entry:

```ts
DRTY: {
  href: '/sap/bc/adt/ddic/drty/sources',
  label: 'CDS Type (scalar type / enum)',
  createType: 'DRTY/STY',
  metadataContentType: BLUES_V1,
  ...BLUE_METADATA,
  sourceFormat: 'text',
},
```

Scope is the registry entry only. No `DRTY/STY` slash alias, no `SAPContext` dependency walking, no
lint integration, and no hardcoded minimum release. The wire contract behind every field is recorded
in [docs/research/2026-09-18-drty-cds-type-adt-contract.md](../research/2026-09-18-drty-cds-type-adt-contract.md).

## Why it looked unsupported

Earlier attempts read DRTY through the DDLS endpoint, which 404s: a CDS type is not a DDL source.
The real collection is `/sap/bc/adt/ddic/drty/sources`, advertised in ADT discovery under the
`Dictionary` workspace with the generic title `Type` — which is why searching the discovery document
for "DRTY" or "CDS type" does not surface it. The sibling sub-resources (`$metadata`, `$formatter`,
`$elementinfo`, …) name DRTY explicitly and confirm the identity.

## The roadmap blocker is stale

`docs_page/roadmap.md` records DRTY as blocked on the tool-schema budget, with `WRITE_WIRE_WALL` at
68 000 bytes and the surface at 67 986 — 14 bytes of headroom. That ceiling is now 74 000 in
`scripts/ci/check-tool-schema-budget.ts`, and the worst write scenario measures 72 525 bytes
(`standard-full-git`, `SAPWrite` 22 021 against a per-tool wall of 23 000). That leaves 1 475 bytes
of total headroom and 979 for `SAPWrite`, against an expected DRTY cost of roughly 150–200 bytes.
Correct the entry in the same change: left alone it will cause the next reader to discard the
feature again.

## Source format is the one place a slip breaks runtime

Four description strings in `src/handlers/tools.ts` — the `SAPRead` and `SAPWrite` type descriptions,
each in a BTP and an on-prem variant — enumerate the server-driven types and call out which take DDL
text rather than AFF JSON (today `DTSC/DSFD/DTDC`). DRTY belongs to the text group. An LLM told
otherwise sends JSON and SAP answers with a hard 415. Keep the wording terse to stay inside the
budget headroom above.

`sourceFormat: 'text'` is not inferred from the family: a PUT with `application/json` under a valid
lock returns 415 `ExceptionUnsupportedMediaType`, and the collection's `$formatter` sub-resource
advertises `text/plain`.

## One subtype covers scalar types and enums

Both report `adtcore:type="DRTY/STY"`. Six objects sampled live cover a type over a builtin, over a
data element, over another CDS type, and three enums with int1, char and numc base types; all carry
the same subtype. Create needs no subtype routing, unlike TABL `/DT` versus `/DS` (#285). The probe
object created in `$TMP` on on-prem 816 came back `abapLanguageVersion="standard"`, so DRTY is not
restricted to ABAP Cloud.

## Inactive drafts need no special handling

The SDO read path never sends a `version` parameter; it GETs the plain URL. That is the behaviour
KTD had to be corrected *to* — `getKtd()` omits `version` so inactive drafts accumulate — so DRTY
inherits it correctly by construction. Verified live: after a source PUT the read returned the new
source while the object was still inactive.

## Availability

No minimum release is pinned. The SDO engine is discovery-gated per type, so a system that does not
expose `/sap/bc/adt/ddic/drty/sources` degrades with a clean unavailable error. This matches the
module's documented posture of gating on discovery rather than a hardcoded release. The full write
round trip is verified on 8.16; `docs_page/roadmap.md` additionally records a 758 read probe.

## Slash alias stays out of scope

`SAPSearch` returns `objectType: "DRTY/STY"`, which `SAPRead` rejects. The gap is shared by every SDO
type — `DSFD/SCF` behaves identically today — so fixing it for DRTY alone would be inconsistent, and
fixing it for all of them is a separate cross-cutting change. The validation error already lists the
accepted types, so a model recovers on the next call.

## Verification

Unit coverage mirrors the existing DTDC and DSFD blocks in `tests/unit/adt/server-driven.test.ts`:
type recognition, object URL construction, `createType`, metadata content type, and
`serverDrivenSourceContentType('DRTY') === 'text/plain'`. `tests/unit/handlers/registry-sync.test.ts`
needs no change; it validates the derivation itself.

Adding a type changes the frozen LLM surface in `tests/fixtures/tool-definitions/` (9 files, locked
by `tool-definitions-snapshot.test.ts`). Regenerate with `vitest -u` and review the diff: it must
contain the DRTY enum members and the prose additions and nothing else.

Then run the full round trip through ARC-1's own code path against the live trial — create, update,
activate, read, delete — not only the by-hand HTTP probe already recorded in the research document.

Documentation to update: `docs_page/tools.md` (type tables and the server-driven writes section,
where DRTY joins the DDL-text list), `docs_page/btp-abap-environment.md` (SAPRead type inventory),
and the roadmap entry above.

## Live facts

On SAP_BASIS 8.16 the full cycle was verified by hand: create POST returned 201 with
`version="inactive"` and an empty source; lock, PUT `text/plain`, unlock stored the DDL and echoed it
back; the generic activation endpoint returned `activationExecuted="true"` and the metadata flipped
to `version="active"`; delete under a lock returned 200 and the subsequent GET 404. The probe object
was removed and its absence confirmed.

Lock, modify and unlock require `X-sap-adt-sessiontype: stateful`. Without it the LOCK still returns
200 with a handle and the PUT then fails 423 `ExceptionResourceInvalidLockHandle`. ARC-1's
`withStatefulSession` already sends it; the behaviour is recorded because it misleads anyone probing
the contract by hand.

The trial carries 384 `DRTY` objects in TADIR. Read fixtures live in `SABAP_DEMOS_ABAP_CDS_CLOUD`
(`DEMO_SIMPLE_TYPE`, `DEMO_CDS_ENUM_WEEKDAY`, …), `SD_CDS_TYPES` (`DD_DRTY_ST_ENUM_*`) and
`SABAP_DEMOS_ABAP_LANGU_CLOUD`.
