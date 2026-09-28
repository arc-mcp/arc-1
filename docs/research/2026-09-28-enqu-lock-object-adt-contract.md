# ENQU (lock objects) — ADT wire contract

Verified 2026-09-28 against an on-premise S/4HANA development system (SAP_BASIS 8.16, S4CORE 109),
Basic auth, both with raw ADT requests and end to end through ARC-1's own code path
(`arc1-cli call SAPRead|SAPWrite|SAPActivate`), and on a BTP ABAP Environment trial through
`handleToolCall` with a named-user token. All test objects were deleted afterwards.

## Discovery

| Collection | Title | Accept |
|---|---|---|
| `/sap/bc/adt/ddic/lockobjects/sources` | Lock Object | `application/vnd.sap.adt.lockobjects.v1+xml` |

Also advertised: `…/lockobjects/sources/validation`, `…/lockobjects/lockmodes`, `…/tables`,
`…/adjustment`, `…/validation`. A lock object is a classic DDIC form object: one XML document, no
`source/main`.

## ENQU (lock object)

GET `…/lockobjects/sources/{name}` (Accept `lockobjects.v1+xml`), optional `?version=active|inactive`:

```xml
<enqu:lockobject adtcore:name="EMEKKOE" adtcore:type="ENQU/DL" adtcore:version="active" …>
  <adtcore:packageRef adtcore:name="ME" …/>
  <enqu:content>
    <enqu:allowRFC>false</enqu:allowRFC>
    <enqu:primaryTable><enqu:tableName>EKKO</enqu:tableName><enqu:lockMode>E</enqu:lockMode></enqu:primaryTable>
    <enqu:secondaryTables><enqu:secondaryTable><enqu:tableName>EKPO</enqu:tableName><enqu:lockMode>E</enqu:lockMode></enqu:secondaryTable></enqu:secondaryTables>
    <enqu:lockParameters>
      <enqu:lockParameter><enqu:parameterWanted>true</enqu:parameterWanted><enqu:parameterName>EBELN</enqu:parameterName><enqu:tableName>EKKO</enqu:tableName><enqu:fieldName>EBELN</enqu:fieldName></enqu:lockParameter>
      …
    </enqu:lockParameters>
    <enqu:lockModules><enqu:lockModule adtcore:name="ENQUEUE_EMEKKOE" adtcore:type="FUGR/FF" …/>…</enqu:lockModules>
  </enqu:content>
</enqu:lockobject>
```

| Step | Observation |
|---|---|
| Create POST without `<enqu:content>` | 400 `SDDIC_ADT_ENQU/201` "Primary table name must not be empty" |
| Create POST with only `primaryTable` | 201, inactive, empty `lockParameters` and `lockModules` |
| Activate after that create | parameters derived from the key fields with `parameterWanted=true`; `ENQUEUE_`/`DEQUEUE_` generated |
| Create POST with explicit `lockParameters` | honored as sent (incl. `parameterWanted=false`) — no follow-up PUT needed |
| Update: LOCK → PUT full document (no `lockModules`) → UNLOCK | 200; description, `allowRFC`, lock modes and `parameterWanted` round-trip through activation |
| Update changing the primary table with an **empty** parameter list | activation re-derives the parameters, but with `parameterWanted=false` for every field |
| `batch_create` with only `primaryTable` | created and activated; parameters derived with `parameterWanted=true` |
| Delete (LOCK → DELETE → UNLOCK) | 200, subsequent GET 404 `SDDIC_ADT_ENQU/200` |

Design consequences in ARC-1 (`src/adt/lock-object.ts`):

- `SAPRead type=ENQU` returns the parsed JSON; `SAPWrite` takes the same JSON in `source`
  (read-only keys ignored, unknown keys rejected).
- `update` merges over the stored definition; a change of the table set without explicit
  `lockParameters` is refused, because SAP's update-time re-derivation silently drops every parameter
  from the `ENQUEUE_` interface.
- `ENQU` is offered on-prem and on BTP (verified on both, see below).

## BTP ABAP Environment (trial, 2026-09-28)

Browser OAuth with a named user; objects in a new `ZLOCAL` sub-package, all through `handleToolCall`:
create with only a primary table → activate → update (lock mode) → activate → read → delete all
succeed, parameters derived with `parameterWanted=true`. The on-prem create body needs no
cloud-specific change; the owner comes from the JWT.
