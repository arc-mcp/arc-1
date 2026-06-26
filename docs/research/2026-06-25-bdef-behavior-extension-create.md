# BDEF behavior-extension create — SOLVED (tier-3 #10)

Status: **shipped.** `SAPWrite create type=BDEF` with an `extend behavior for …` source creates a RAP
behavior extension. Full create → activate lifecycle live-verified on a4h 758 + 816. Parity with
sapcli `bdef extend` (commit `2337844`).

## The mechanism (live reverse-engineered on a4h 816, confirmed against sapcli)

A behavior extension is **`adtcore:type="BDEF/BDO"`** at the same `/sap/bc/adt/bo/behaviordefinitions/`
endpoint as a definition — the type does NOT discriminate. Two things make it an extension:

1. **The create POST carries `<adtcore:adtTemplate>`** with `<adtcore:adtProperty adtcore:key="base_bdef">BaseBdef</adtcore:adtProperty>`, and it **MUST precede `<adtcore:packageRef>`** in the
   `blue:blueSource` body — the elements are schema-ordered (sapcli declares them in that order via
   `OrderedClassMembers`). A *trailing* template is silently ignored and SAP scaffolds a plain
   definition. This single ordering detail was the whole puzzle.
2. **The base BDEF must be `extensible`** (`strict(2)` + `extensible` in the header + `extensible` on
   the entity + `mapping … corresponding extensible`). Otherwise the create 400s with "Behavior
   Definition X is not marked as extensible". This is the base author's responsibility, not ARC-1's.

Given those, the POST scaffolds `extension implementation in class zbp_<name> unique; extend behavior
for <Base> { }`, and a normal source PUT writes the real extension body. The extension source needs the
`extension implementation in class … unique;` header (a plain `extend behavior …` alone → "extension
was expected, not extend").

## ARC-1 implementation

- `src/handlers/write/create.ts`: detect `\bextend behavior for (Name)` in the BDEF source → set
  `behaviorExtension` + `baseBdef = Name` (a BDEF shares its root entity's name, so the name in
  `extend behavior for <X>` IS the base BDEF). No new parameter — extracted from the source.
- `src/handlers/write-helpers.ts` `buildCreateXml('BDEF')`: when `behaviorExtension`, emit the
  `adtcore:adtTemplate(base_bdef)` immediately before `packageRef`. The rest (POST scaffold → PUT
  source → activate) is the existing BDEF create flow unchanged.

## Verification

Full lifecycle (extensible base RAP BO → extension create → read-back `extend behavior for` → activate)
on **a4h 758 AND a4h-2025 816**. Unit: `write-ddic.test.ts` (template emitted+ordered for an extension;
omitted for a definition). Integration: `adt.integration.test.ts` builds the whole base BO live + the
extension. Dead ends ruled out on the way: `type="BDEF/BDE"` (normalized to BDO), trailing adtTemplate
(ignored), plain BDO + `extend` source (parser rejects).
