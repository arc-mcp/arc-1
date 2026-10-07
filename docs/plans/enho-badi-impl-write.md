# Plan: create BAdI enhancement implementations (`ENHO/XHB`) via SAPWrite

## Finding (2026-10-07)

In a project on S/4HANA (SAP_BASIS 816, on-prem), ARC-1 could not
create a BAdI implementation. The whole development was one released BAdI (`SD_APM_SET_APPROVAL_REASON`,
interface `IF_SD_APM_SET_APPROVAL_REASON`, C1) plus one implementing class:

| Step | Done by | Result |
|---|---|---|
| Package, transport, implementing class `ZCL_MY_APPROVAL_REASON` (ABAP Cloud) | ARC-1 (`SAPManage`, `SAPTransport`, `SAPWrite`, `SAPActivate`) | ✅ |
| Enhancement implementation `ZMY_ENH_APPROVAL_REASON` + BAdI implementation `ZMY_BADI_APPROVAL_REASON` on spot `ES_SD_SLS_EXTEND` | **manually in Eclipse ADT** | ARC-1 has no write path |
| Verification after the manual step | ARC-1 `SAPRead type=ENHO` + `BADIIMPL_ENH` query | ✅ |

So the agent had to stop and hand the last step to the user, even though everything else in the
clean-core flow (released BAdI → class → ENHO) was automated.

### Current state in `main` (v1.5.1)

- `src/adt/enhancements.ts` only **reads** ENHO: `GET /sap/bc/adt/enhancements/{enhoxhb|enhoxhh|enhoxh}/{name}`.
- `SAPWrite` has no `ENHO` type in its enum.
- `objectBasePath` (`src/handlers/object-types.ts`) has no ENHO case. `SAPActivate`, `SAPTransport check/history`,
  the write `objectUrl` and the package gate are URI-based, so for ENHO they fall back to
  `/sap/bc/adt/programs/programs/<name>`.
- Roadmap item [FEAT-03](../../docs_page/roadmap.md#feat-03) tracks enhancement authoring.
- `docs/research/abap-types/types/enho.md`: *"There is no public slash alias or enhancement write operation."*
- No open issue asks for ENHO write. Closed: #896 (ENHO read subtypes), #162 (gating types by release).

### ADT supports it

Eclipse ADT creates BAdI enhancement implementations (*New → BAdI Enhancement Implementation*, then add a
BAdI implementation with its implementing class in the form editor). Eclipse uses the same REST resource
ARC-1 already reads: `/sap/bc/adt/enhancements/enhoxhb`, content type
`application/vnd.sap.adt.enh.enhoxhb.v4+xml`. Creating it is a POST to the collection; adding or changing BAdI
implementations is a lock + PUT of the same XML. The gap is in ARC-1, not in ADT.

### Live reference object (read back with the current ARC-1)

`SAPRead type=ENHO name=ZMY_ENH_APPROVAL_REASON` returns:

```json
{
  "name": "ZMY_ENH_APPROVAL_REASON",
  "description": "Approval Reason BAdI",
  "package": "ZMY_APPROVAL",
  "technology": "BADI_IMPL",
  "switchSupported": false,
  "badiImplementations": [{
    "name": "ZMY_BADI_APPROVAL_REASON",
    "shortText": "",
    "implementingClass": "ZCL_MY_APPROVAL_REASON",
    "badiDefinition": "SD_APM_SET_APPROVAL_REASON",
    "enhancementSpot": "ES_SD_SLS_EXTEND",
    "active": true,
    "default": false
  }]
}
```

This is the target shape a create should produce. The raw XML of this GET is the best starting
template for the POST/PUT payload. Capture it as a fixture first (namespaces and `adtcore:type`
included).

## Proposed scope

Only `ENHO/XHB` (BAdI implementations, the clean-core case). Leave hook (`XHH`) and class/legacy (`XH`)
enhancements read-only. They are classic-ABAP only and out of clean-core scope.

### SAPWrite

Follow ENQU (#877): **no new tool arguments**. `source` takes the JSON that `SAPRead type=ENHO` returns.
Read-only keys are ignored and unknown keys are rejected. This keeps the schema budget unchanged
(`tools.ts` and `write.ts` are at their line budgets).

- `type: "ENHO"`, `action: "create"`: `name`, `description`, `package`, `transport`, and in `source`:
  - `enhancementSpot` (e.g. `ES_SD_SLS_EXTEND`)
  - `badiImplementations: [{ name, badiDefinition, implementingClass, shortText?, active? (default true), default? (default false) }]`
- `type: "ENHO"`, `action: "update"`: replace the BAdI implementation list. Omitted flags of known entries
  keep their stored values.
- `type: "ENHO"`, `action: "delete"`.
- Then `SAPActivate type=ENHO`.
- Filter values are out of scope until the spike captures their XML.

### Validation before write

Implemented locally: JSON shape, names, one spot per implementation, no spot change on update, discovery gate,
package allowlist. ARC-1 has no ENHS (spot) reader yet. These checks are left to SAP until the spike shows
whether its errors are clear enough:

- The BAdI definition exists in the spot.
- The implementing class implements the BAdI interface.
- On BTP / ABAP Cloud packages, the BAdI interface is released (C1).
- A filter-dependent BAdI has a filter.

## Implementation steps

1. **Spike against a live system** (an SAP_BASIS 816 test system, in `$TMP`):
   - GET the XML of an existing XHB ENHO → fixture `tests/fixtures/xml/enho-xhb-badi-impl.xml`.
   - Find the create template: Eclipse ADT communication log (*Window → Show View → ABAP Communication Log*)
     while creating an ENHO by hand. Record the POST URL, headers, content type and body.
   - Check whether create is one POST with the BAdI implementations inside, or POST of an empty
     container followed by lock + PUT.
   - Write the result to `docs/research/<date>-enho-xhb-write-spike.md`.
2. New `src/adt/enhancement-impl.ts`, modelled on `src/adt/lock-object.ts`: parse/validate the JSON, merge
   for update, build the XML. Escape with `escapeXmlAttr` (`xml-parser.ts`; `xml-entities.ts` only decodes).
   There is no `OperationType.Write`: the CRUD helpers in `src/adt/crud.ts` already check
   Create/Update/Delete/Lock.
3. Wire the metadata-write branch in `src/handlers/write-helpers.ts` (`isMetadataWriteType`, content type,
   `getMetadataWriteProperties`, `mergeMetadataWriteProperties`, `buildCreateXml`) and the discovery gate +
   container POST followed by a locked PUT of the implementations (the Eclipse sequence) in
   `src/handlers/write/create.ts` (single and batch create).
4. `src/handlers/object-types.ts`: `objectBasePath('ENHO')` → `/sap/bc/adt/enhancements/enhoxhb/` and add ENHO
   to `KNOWN_BASE_TYPES`. Activation is URI-based (no `adtcore:type`), so this fixes activation, transport,
   delete and the package gate together.
5. `src/handlers/tool-registry.ts`: `{ type: 'ENHO', btp: false }` for SAPWrite; one compressed line in
   `tool-descriptions.ts`; regenerate the tool-definition snapshots.
6. Docs: `docs_page/tools.md`, `docs/research/abap-types/types/enho.md`, `01-inventory.md`, roadmap FEAT-03,
   dev guide + AGENTS.md rows. Release notes are annotated while the release-please PR is open.

## Tests

1. Unit: XML builder for XHB, with one and with several BAdI implementations, escaping, and active/default flags.
2. Unit: handler validation (invalid JSON, missing spot, spot change), discovery gate, package allowlist
   refusal with no POST/PUT, activation URI.
3. Unit: schema + schema-key-sync + tool-definitions snapshot.
4. Integration: create ENHO with one BAdI implementation for an existing class → read back → update →
   activate → delete. Uses the `ZARC1_` cleanup namespace and `TEST_ENHO_SPOT`/`TEST_ENHO_BADI`/`TEST_ENHO_CLASS`.
5. Gates: `npm run typecheck`, `lint`, `test`, `validate:policy`, `check:sizes`, `build`, `docs:build`.

## Open questions

- Which BAdI on A4H to use for the integration test? It must be released, have no filter, and live in a
  spot that ships on A4H.
- Is enhancement implementation creation allowed on BTP ABAP Environment, or only on-prem / private cloud?
  Read is "on-prem only" today; check whether that's a real limit or only untested.
