---
name: modernize-abap-cap-service
description: Generate a CAP service definition (`srv/service.cds` + handler skeletons) from a Z* package's function modules, function groups, and reports. Maps ABAP signatures to CAP service actions, classifies bound vs unbound, generates TypeScript handler stubs with ABAP source context as TODOs. Use when asked to "convert this ABAP FM to a CAP service", "generate CAP service from Z report", "expose Z business logic as OData V4", or as sub-skill of `modernize-abap-to-btp-cap`.
---

# Modernize ABAP → CAP Service

Produces `<target>/srv/service.cds` + handler skeletons from a Z* package's function modules (`FUGR`), reports (`PROG`), and class methods. Greenfield CAP service exposing equivalent business logic as OData V4 actions.

Sub-skill of [`../modernize-abap-to-btp-cap/SKILL.md`](../modernize-abap-to-btp-cap/SKILL.md). Usable standalone when only the service layer needs migration (existing CAP schema, new service on top).

## Input

```
<Z-package> <target-dir> [--service-name=MyService] [--ts|--js]
```

## Defaults

| Aspect | Default |
|---|---|
| Service definition | `<target>/srv/service.cds` |
| Handler file | `<target>/srv/service.ts` (TypeScript; `--js` to opt out) |
| Service exposure | OData V4 |
| Bound vs unbound | bound if FM signature has a "key" parameter; unbound otherwise |
| Auth | `@requires: 'authenticated-user'` (refine in `services-auth.cds` later) |
| Logging | `cds.log('<service-name>')` per handler |
| Error handling | central `rejectSafe` helper (created if absent) |

## ABAP → CAP signature mapping

| ABAP | CAP service | Handler |
|---|---|---|
| `FUNCTION ZFM_X IMPORTING iv_id` | `action callX(id : String) returns Result;` | `srv.on('callX', async (req) => …)` |
| `FUNCTION ZFM_X CHANGING ct_items` | `action callX(items : array of Item) returns array of Item;` | mutating param → returned shape |
| `FUNCTION ZFM_X RAISING zcx_my_error` | `action callX() returns Result;` + `req.reject(…)` | exception class → HTTP code (table below) |
| Report `ZRPT_X SUBMIT` | `function callX() returns Report;` | trigger via Kyma CronJob or BTP Job Scheduler |
| `METHOD <class>.<method>` | bound action `action <method>(…)` | route via class wrapper |

Exception class → HTTP code defaults:

| ABAP exception | HTTP |
|---|---|
| `CX_SY_*` (system) | 500 |
| `ZCX_NOT_AUTHORIZED` | 403 |
| `ZCX_NOT_FOUND` | 404 |
| `ZCX_BUSINESS_*` (business rule) | 409 |
| `ZCX_INVALID_INPUT` | 400 |

## Workflow

### Step 1 — Enumerate

`SAPSearch(tadir_lookup, devclass=<pkg>, object IN ('FUGR','PROG','CLAS'))`.

Filter out:
- Helper / utility classes already covered by `migrate-custom-code` (those rewrite in-place, not exposed).
- Pure data classes (no business method).
- Test classes (`ZCL_*_TEST`).

### Step 2 — Read source + signatures

Per FM / method / report:
- `SAPRead(type='FUNC', name=<fm>)` — I/O parameters + raising classes.
- `SAPRead(type='CLAS', name=<cls>)` — public methods + types.
- `SAPContext(action='impact', target=<obj>)` — caller fan-in.

### Step 3 — Decide service shape

| Caller pattern | Decision |
|---|---|
| Called only by UI / external system | Expose as OData action |
| Called only by other Z code | Don't expose; inline into the consuming action OR keep ABAP-side |
| Heavy read, light return | OData function (read-only) instead of action |
| Mutating + returns updated entity | Bound action |
| Pure utility (no entity context) | Unbound action under service root |

### Step 4 — Generate `srv/service.cds`

```cds
using { com.example.<pkg> as my } from '../db/schema';

@path: '/odata/v4/<service-name>'
service <ServiceName> @(requires: 'authenticated-user') {
  entity Items as projection on my.Items actions {
    action approve(reason : String)              returns Items;
    action reject (reason : String not null)     returns Items;
  };

  function searchVendors(query : String)         returns array of Vendor;
  action   importBatch  (items : array of Item)  returns BatchResult;
}
```

Carry `@Common.Label` from FM short text. `@Core.LongDescription` from FM detailed documentation if present.

### Step 5 — Generate `srv/service.ts` handler skeletons

```typescript
import cds from '@sap/cds';

const LOG = cds.log('<service-name>');

export default class <ServiceName>Service extends cds.ApplicationService {
  override async init() {
    this.on('approve',       this.approveItem);
    this.on('reject',        this.rejectItem);
    this.on('searchVendors', this.searchVendors);
    this.on('importBatch',   this.importBatch);
    return super.init();
  }

  async approveItem(req: cds.Request) {
    // TODO: ported from ZFM_APPROVE_ITEM
    // Original: IMPORTING iv_id TYPE … EXPORTING es_result TYPE …
    // Logic notes: <copied from FM documentation>
    LOG.info('approve called', { id: req.params[0] });
    return req.reject(501, 'Not yet implemented');
  }
  // … one stub per action
}
```

Every stub includes a TODO with the source ABAP object name so the developer doing the port has the audit trail.

### Step 6 — Migration notes

Write `<target>/docs/service-notes.md` with:
- FM / method → CAP action mapping table.
- Exception class → HTTP code mapping applied.
- Caller-pattern decisions (exposed vs inlined vs kept ABAP-side).
- Manual-port items: complex business rules requiring re-implementation in TypeScript.

## Gotchas

- **Modifying SAP standard tables in the FM**: CAP runtime cannot. Flag the FM as `extract_to_side_by_side_with_event_subscription` — the new CAP action subscribes to S/4 events and writes to CAP storage.
- **`SUBMIT … RETURN` reports**: refactor to action with explicit parameters. List-display reports → `function` returning `array of`.
- **AMDP / native HANA SQL inside FM**: do NOT port as embedded SQL — model as CDS view + CAP query.
- **Locks / SAP LUW**: explicit ENQUEUE → `cds.tx` + `forUpdate()`.

## When NOT to use

- Schema-only migration → [`../modernize-abap-cap-schema/SKILL.md`](../modernize-abap-cap-schema/SKILL.md).
- Full ABAP rewrite in source system → [`../migrate-custom-code/SKILL.md`](../migrate-custom-code/SKILL.md).
- New RAP service in the source ABAP system → [`../generate-rap-service/SKILL.md`](../generate-rap-service/SKILL.md).

## References

- [SAP CAP — Providing Services](https://cap.cloud.sap/docs/guides/providing-services)
- [SAP CAP — Custom Handlers (Node.js)](https://cap.cloud.sap/docs/node.js/core-services)
- [CAP capire — OData V4 Actions / Functions](https://cap.cloud.sap/docs/advanced/odata)
