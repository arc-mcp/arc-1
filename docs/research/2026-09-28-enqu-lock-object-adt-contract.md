# ENQU (lock objects) — ADT wire contract

Verified 2026-09-28 against an on-premise S/4HANA development system (SAP_BASIS 8.16, S4CORE 109),
Basic auth, both with raw ADT requests and end to end through ARC-1's own code path
(`arc1-cli call SAPRead|SAPWrite|SAPActivate`), and on a BTP ABAP Environment trial through
`handleToolCall` with a named-user token. All test objects were deleted afterwards. Independent 2026-09-30 checks are recorded below.

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

## Independent review — 2026-09-30

The existing XML adapter remains the implementation. ENQU uses the shared metadata update path:
resolve the real package, lock, read the developer view in the same session, merge supplied
**top-level** keys, PUT, unlock. No separate transaction abstraction or new tool arguments were added.

Two input defects were reproduced and corrected:

- Nested typos such as `lockmode` and `parameterwanted` silently selected defaults. Unknown keys
  are now rejected inside tables and parameters, as well as at the root.
- The original validator accepted `O` and rejected an explicit empty mode. On both 758 and 816,
  activation rejected `O`; an empty secondary-table mode activated and round-tripped. Definition
  defaults are `E`, `S`, `X` or empty (traverse a foreign-key link without locking that table).
  Optimistic `O` is a runtime request mode. The ADT `lockmodes` list also includes runtime and
  reserved modes, so it is not proof that each value is valid in a repository definition.

| Target / route | Observation |
|---|---|
| 750 / NPL, HTTPS Basic | Collection absent; single and batch create refused before mutation. |
| 758 / a4h, HTTPS Basic | 56 dispatcher steps passed, including create/activate/read, repeated inactive edits, E/S/X modes, false flags, explicit empty parameters, table changes, competing edit before LOCK, lock contention, package refusals, secondary tables, batch create and verified deletion. |
| 816 / a4h-2025, HTTPS Basic | The same 56-step lifecycle passed. |
| BTP trial / 920 SP04, named-user OAuth | 61 dispatcher steps passed in a disposable `ZLOCAL` sub-package, including the same mutation, version, contention and refusal checks, secondary tables, batch activation and deletion. Private data-element/table fixtures supplied the foreign-key relationship. |

On update, an explicit empty parameter list re-derived parameters with `parameterWanted=false`;
omitting the list preserved existing values. This distinction remains deliberate and documented.
A read through the shared client instead of the locked session fails the new ENQU row in the
existing metadata concurrency test. Nested-key and mode tests fail on the contributor's parser.
On BTP, activation removed a redundant child-table parameter already joined to the parent's key;
read back SAP's canonical parameter list before editing it. The fixture needed a data element for
its foreign-key field, as SAP refused a built-in field type. Neither observation required an ARC-1
workaround. All fresh cloud lock objects, tables and the data element were deleted with GET 404
confirmation, including those from failed fixture attempts. The shared temporary package has a
separate [cleanup limitation](2026-09-28-aplo-sajc-sajt-adt-contract.md) that remains unresolved.

Small private tables made the lifecycle probes fast. A `T000`-based control was slow even on direct
metadata reads, before an update; an 816 lifecycle still completed. The backend cause was not
profiled, and ARC-1 has no special retry or timeout workaround. All objects from the completed and
interrupted on-prem probes were deleted, including a temporarily retained lock after interruption.
No generated enqueue/dequeue module was invoked, and no business rows were inserted or changed.
MCP transport, principal propagation and transport-assigned writes were not exercised.

Primary references: [SAP ADT creation (since 7.53)](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/f762e6c90e61480ca03a2a3227004f0d.html),
[Dictionary creation and empty table modes](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/ec1c9c8191b74de98feb94001a95dd76/cf21eef3446011d189700000e8322d00.html),
and [runtime mode parameters](https://help.sap.com/saphelp_aii710/helpdata/en/cf/21eebf446011d189700000e8322d00/content.htm).
