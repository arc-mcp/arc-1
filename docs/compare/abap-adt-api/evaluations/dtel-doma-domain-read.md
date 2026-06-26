# abap-adt-api v8.2.0 — DTEL/DOMA structured read parity

> **Priority**: Low (informational)
> **Source**: marcellourbani/abap-adt-api commits `9b419ed` / `17b754a` (PR #45, 2026-04-25)
> **ARC-1 component**: `src/adt/client.ts` (`getDomain`, `getDataElement`)

## What they added

Added `getDomainProperties()` and `getDataElementProperties()` to read structured DOMA/DTEL metadata (parallel to existing `setDomainProperties()` / `setDataElementProperties()`). Also removed the `typeKind: "domain" | "datatype"` field from `DataElementProperties` (breaking change — they apparently decided typeKind was redundant given `typeName`/`dataType`).

The new readers parse:

- DOMA: typeInformation (datatype/length/decimals), outputInformation (length/style/conversionExit/signExists/lowercase/ampmFormat), valueInformation (valueTableRef/appendExists/fixValues), full metadata header.
- DTEL: identical pattern — fieldLabels, references to typeKind/dataType/length/decimals, search help.

## ARC-1 current state

ARC-1 has structured DOMA/DTEL **read** since v0.x:

- `getDomain(name): Promise<DomainInfo>` (`src/adt/client.ts:334`) → parses XML to `DomainInfo` via `parseDomainMetadata` (in `xml-parser.ts`).
- `getDataElement(name): Promise<DataElementInfo>` (`src/adt/client.ts:341`) → parses to `DataElementInfo`.

ARC-1 keeps `typeKind: 'domain' | 'predefinedAbapType'` (`src/adt/ddic-xml.ts:33`, `src/handlers/schemas.ts`) — used by the metadata write path to choose between `<dtel:typeKind>domain</dtel:typeKind>` (refers to a domain) vs `predefinedAbapType` (uses raw ABAP datatype). The default is inferred from whether `dataType` is present (`src/adt/ddic-xml.ts:233`). This is the right modelling — abap-adt-api removed it because they didn't have it correctly wired, but it's a real ADT distinction.

## Decision

**no-action** — ARC-1 reached this design point earlier. Note the divergence on `typeKind`: abap-adt-api dropped it, ARC-1 keeps it. ARC-1's modelling is correct; the field controls the actual XML element ADT expects.

If we ever copy any of their reader patterns, double-check the XML attribute names match what we already extract — they parse `doma:` / `dtel:` namespaces with `xmlNode`/`xmlNodeAttr` from a custom utility, while ARC-1 uses fast-xml-parser. Different shapes, same data.
