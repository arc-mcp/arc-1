---
name: modernize-abap-cap-service
description: Generate CAP service definitions (srv/*.cds) and TypeScript handler stubs (srv/handlers/*.ts) from a Z* package's reports (PROG), function modules (FUNC), and classes (CLAS). Maps ABAP signatures to OData V4 action signatures, classifies bound vs unbound actions, embeds ABAP source excerpts as TODO context. Use when asked to "convert this FM to CAP action", "generate CAP service from ABAP", "scaffold CAP handlers from Z program", or as sub-skill of modernize-abap-to-btp-cap.
---

# Modernize ABAP CAP Service

Generate CAP service definitions (`srv/*.cds`) and TypeScript handler stubs (`srv/handlers/*.ts`) from a Z* package's reports (`PROG`), function modules (`FUNC`), and behavior-relevant classes (`CLAS`). Maps ABAP procedural / object-oriented logic to CAP intent: entities exposed as projections, action signatures derived from FM parameters, handler scaffolds with TODO markers for business logic.

Sub-skill of [modernize-abap-to-btp-cap](../modernize-abap-to-btp-cap/SKILL.md). Assumes the schema sub-skill [modernize-abap-cap-schema](../modernize-abap-cap-schema/SKILL.md) has produced `db/schema.cds` (entities + associations exist) before this skill runs.

This skill produces a **scaffold + plan**, not production-ready business logic. Handler bodies are stubs with `// TODO: implement` comments and parameter passing wired up; the user is expected to translate ABAP business logic in a second pass.

## v1 Guardrails (fast path)

- **Read-only ARC-1** — no SAPWrite calls
- **CAP runtime: Node.js** — TypeScript handlers
- **OData V4 only**
- **One service per package by default** — single `srv/service.cds` covers the whole package; user can split later
- **One handler file per service** — `srv/handlers/<service>.ts` aggregates all action handlers
- **No CDS query rewriting** — ABAP SELECT statements appear in handler comments, not auto-translated to CDS-QL

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Service file | `<target>/srv/service.cds` | Single-service per package |
| Service name | derived: `<NamespaceCamelCase>Service` (e.g., `ZSALES_PKG` → `SalesService`) | Drops Z prefix, CamelCase |
| Service namespace | matches schema namespace | Coherent with [modernize-abap-cap-schema](../modernize-abap-cap-schema/SKILL.md) |
| Entity exposure | All entities from schema projected READ-only | Safe default; user adds CRUD where needed |
| Action mapping | FM → unbound action (with first ENTITY param → bound action) | OData V4 convention |
| Handler runtime | Node.js TypeScript | CAP-native |
| Handler file pattern | `srv/handlers/<service>.ts` (one per service) | Easier discovery |
| Action body | `// TODO: implement` stub + parameter destructuring | Compile-clean, runtime-rejected with `req.reject(501)` |
| Error handling | `rejectSafe` pattern | Don't leak `err.message` to client |
| Audit | `@audit-log` annotation on write actions | BTP-native |
| Validation | `@assert.range` / `@assert.format` mirrored from DDIC | Inherit DDIC-level checks |
| Authorization | placeholder `@(restrict: [{ to: 'authenticated-user' }])` | Refined later by [modernize-abap-auth-mapping](../modernize-abap-auth-mapping/SKILL.md) |

## Input

The user provides:

- **Z package name** (required) — same package used in schema step
- **Target directory** (required) — must already contain `db/schema.cds`

Optionally:

- **Service split** — `--split-by entity` (one service per entity) | `--split-by submodule` (use sub-package boundaries)
- **Action policy** — `--actions-only` (skip projections) | `--projections-only` (skip actions)
- **Object scope** — comma list of PROG/FUNC/CLAS names to include
- **Skip classes** — `--skip-class` if user has already migrated class logic separately

## Step 1: Verify Prerequisite

### 1a. Ensure schema exists

```bash
test -f <target>/db/schema.cds
```

If missing, stop and recommend running [modernize-abap-cap-schema](../modernize-abap-cap-schema/SKILL.md) first.

### 1b. Parse entity list from schema

Read `<target>/db/schema.cds` and extract entity names + their associations. Use these for:

- Projection generation in service.cds
- Action parameter typing (e.g., `customer: Association to Customer` ↔ `customerID: UUID` in action signature)

## Step 2: Enumerate Source Objects

### 2a. List PROG/FUNC/CLAS in package

```
SAPRead(type="DEVC", name="<package>")
```

Filter to keep `objectType in (PROG, FUNC, FUGR, CLAS)`. For FUGR (function group), traverse to list contained FUNC objects:

```
SAPRead(type="FUGR", name="<group_name>")
```

### 2b. Classify by intent

| ABAP object | Heuristic | CAP target |
|---|---|---|
| `FUNC` RFC-enabled with `IMPORTING`/`EXPORTING` params | Likely entry-point | Service action (unbound or bound) |
| `FUNC` local (no RFC) | Helper/utility | Handler private function (NOT exposed in service) |
| `PROG` (executable report) | Batch / one-shot job | Service action `runReport(...)` or cron job |
| `PROG` (module pool) | UI flow + business logic | Multiple actions decomposed from flow logic + Fiori-mapped UI |
| `CLAS` with `STATIC` factory methods | Business logic | Handler import + method-by-method to action |
| `CLAS` instance with state | Stateful logic | Refactor: extract pure functions into handler |
| `CLAS` with `ENH_*` prefix | Enhancement | Skip (Clean Core violation; flag in [modernize-abap-clean-core-gap](../modernize-abap-clean-core-gap/SKILL.md)) |

### 2c. Read source for analysis

For each retained object:

```
SAPRead(type="<type>", name="<name>")
```

Cache responses — same object may be analyzed twice (e.g., as entry-point and as called helper).

## Step 3: Extract Action Signatures from Function Modules

For each FUNC retained as entry-point:

### 3a. Parse FM signature

ARC-1 `SAPRead(type="FUNC", name="<name>")` returns a structured response including:

- `importing`: array of `{name, type, optional, default}`
- `exporting`: array of `{name, type}`
- `changing`: array of `{name, type, optional}`
- `tables`: array of `{name, type, structure}`
- `exceptions`: array of `{name, description}`
- `rfcEnabled`: boolean

Build the action signature according to these rules:

#### Importing → action parameters

```cds
// ABAP FM signature (example):
//   IMPORTING iv_customer_id TYPE kunnr
//             iv_company_code TYPE bukrs
//             is_options TYPE zsales_options
//
// CAP action signature:
action getCustomerOrders(
  customerId: String(10),
  companyCode: String(4),
  options: SalesOptionsType
) returns array of Order;
```

#### Type mapping for parameters

Same DDIC → CDS type table as [modernize-abap-cap-schema](../modernize-abap-cap-schema/SKILL.md) Step 3. Additionally:

| ABAP FM parameter type | CAP action target |
|---|---|
| Single field (`TYPE kunnr`) | `: String(10)` (or whatever DDIC maps to) |
| Structure (`TYPE zsales_header`) | `: { ... }` inline type OR `: TypeName` from `srv/types.cds` |
| Internal table (`TABLE OF ...`) | `: array of { ... }` |
| Returning table (in `EXPORTING`) | `returns array of <Entity>` |
| Returning single | `returns <Entity>` |
| Returning structure | `returns <Type>` |
| OK / FAIL pattern (`E_RETURN TYPE bapiret2`) | NOT a return — use `req.reject` or `req.error` pattern in handler |

#### Exceptions → CAP error pattern

ABAP exceptions don't have direct CAP equivalents. Map to handler error handling:

```typescript
// ABAP FM raised exception NOT_FOUND
// CAP handler equivalent:
if (!customer) {
  return req.reject(404, `Customer ${customerId} not found`);
}
```

### 3b. Decide bound vs unbound action

| Heuristic | Decision |
|---|---|
| First parameter is an entity key (e.g., `iv_customer_id` for `Customer`) | **Bound** action on that entity: `entity Customer { ... } actions { action getOrders() returns array of Order; }` |
| All parameters are filters / config | **Unbound** action: `action runReport(...)` |
| Returns a single instance of a known entity | **Bound** action that returns `$self` after modification, or unbound with explicit return |

### 3c. Emit action in service.cds

```cds
service SalesService {
  // Entity projections
  entity Customers as projection on schema.Customer;
  entity Orders    as projection on schema.Order;

  // Bound actions on Customer
  extend entity Customers with actions {
    @audit-log
    action getOrders(filter: SalesFilterType) returns array of Orders;
  }

  // Unbound actions
  @audit-log
  action runMonthlyReport(month: Integer, year: Integer) returns array of ReportLine;
}

// Inline types declared in srv/types.cds
type SalesFilterType : {
  fromDate    : Date;
  toDate      : Date;
  customerId  : String(10) @assert.format: 'KUNNR-pattern';
};

type ReportLine : {
  customerId  : String(10);
  customerName: String(80);
  netAmount   : Decimal(15, 2) @Semantics.amount.amount;
  currency    : String(5)      @Semantics.amount.currencyCode;
};
```

## Step 4: Generate Handler Scaffolds

### 4a. Handler file structure

For each service, emit `srv/handlers/<service>.ts`:

```typescript
import cds from '@sap/cds';
import type { Service, Request } from '@sap/cds';

const LOG = cds.log('sales-service');

export default class SalesServiceImpl extends cds.ApplicationService {
  async init() {
    const { Customers, Orders } = this.entities;

    // Bound action: getOrders on Customer
    this.on('getOrders', Customers, async (req: Request) => {
      const customerId = req.params[0]?.ID;
      const { filter } = req.data;
      
      LOG.info(`getOrders called for customer=${customerId}, filter=${JSON.stringify(filter)}`);
      
      // TODO: implement business logic
      // ABAP source: FUNCTION Z_GET_CUSTOMER_ORDERS (package: ZSALES_PKG)
      //   ABAP signature:
      //     IMPORTING iv_customer_id TYPE kunnr
      //               is_filter      TYPE zsales_filter
      //     EXPORTING et_orders      TYPE TABLE OF zsales_order
      //     EXCEPTIONS not_found     -> req.reject(404)
      //                bad_input     -> req.reject(400)
      //
      //   ABAP business logic excerpt (first 20 lines):
      //     SELECT * FROM zsales_order_h
      //       INTO TABLE @et_orders
      //       WHERE kunnr = @iv_customer_id
      //         AND erdat BETWEEN @is_filter-from_date AND @is_filter-to_date.
      //     IF sy-subrc <> 0.
      //       RAISE not_found.
      //     ENDIF.
      //
      //   CAP equivalent suggestion (CDS-QL):
      //     return SELECT.from(Orders).where({ customer_ID: customerId, ... });
      
      return req.reject(501, 'Not yet implemented');
    });

    // Unbound action: runMonthlyReport
    this.on('runMonthlyReport', async (req: Request) => {
      const { month, year } = req.data;
      
      LOG.info(`runMonthlyReport called month=${month} year=${year}`);
      
      // TODO: implement business logic
      // ABAP source: PROGRAM Z_MONTHLY_REPORT
      //   Excerpt: ...
      
      return req.reject(501, 'Not yet implemented');
    });

    await super.init();
  }
}
```

### 4b. ABAP source excerpt injection

For each TODO comment, include a 10-20 line excerpt from the ABAP source to give the user immediate context when implementing:

- The FM signature (parsed)
- The first 15-20 lines of the FORM/METHOD/main logic
- Any `RAISE` / `EXIT` / `MESSAGE E` statements (these become `req.reject`)
- Major `SELECT` statements (suggest CDS-QL translation in comment)

### 4c. Common ABAP → CAP handler pattern mappings

Embed these as inline guidance comments where relevant:

| ABAP pattern | CAP TypeScript handler |
|---|---|
| `SELECT ... FROM ... INTO TABLE ... WHERE ...` | `await SELECT.from(<Entity>).where({ ... })` |
| `MODIFY <Entity> FROM TABLE ...` | `await UPDATE(<Entity>).set(...).where(...)` or `cds.update(<Entity>, key).with(...)` |
| `INSERT <Entity> FROM TABLE ...` | `await INSERT.into(<Entity>).entries(...)` |
| `DELETE FROM <Entity> WHERE ...` | `await DELETE.from(<Entity>).where(...)` |
| `LOOP AT ... ASSIGNING <fs>` | `for (const item of items) { ... }` |
| `READ TABLE ... WITH KEY ... ` | `items.find(it => it.key === ...)` |
| `CALL FUNCTION 'Z_HELPER_FM'` | Refactor: inline function OR if released SAP API: `await cds.connect.to('<destination>').<method>(...)` |
| `RAISE EXCEPTION TYPE cx_*` | `throw new Error(...)` OR `req.reject(code, message)` |
| `MESSAGE E001(zsales)` | `req.reject(400, '<localized text>')` |
| `COMMIT WORK.` | implicit in CAP: `req.on('succeeded', ...)` post-commit hooks |
| `ROLLBACK WORK.` | `req.on('failed', ...)` |
| `AUTHORITY-CHECK OBJECT 'Z_AUTH'` | `if (!req.user.is('ScopeName')) return req.reject(403)` |
| `WRITE: / ULINE.` | NOT supported — UI rendered by Fiori app, not handler |
| `CALL SCREEN xxx.` | NOT supported — UI flow → Fiori Elements routing |

### 4d. Class method extraction

For `CLAS` retained:

- Each PUBLIC instance/static method that mutates state → handler action or private helper
- Each PRIVATE method → handler private function
- Constructor logic → handler `init()` setup
- Class attributes → handler module-scope state (warn: avoid stateful handlers)

Example for `ZCL_SALES_CALCULATOR.compute_total`:

```typescript
// Imported from class ZCL_SALES_CALCULATOR.compute_total
async function computeTotal(orderId: string): Promise<{ amount: number; currency: string }> {
  // TODO: implement
  // ABAP method signature:
  //   compute_total IMPORTING iv_order_id TYPE zsales_order-id
  //                 RETURNING VALUE(rs_result) TYPE zsales_total.
  //
  //   ABAP excerpt:
  //     SELECT SUM( netwr ) AS amount, waers AS currency
  //       FROM zsales_item
  //       INTO @rs_result
  //       WHERE order_id = @iv_order_id
  //       GROUP BY waers.
  
  throw new Error('computeTotal not yet implemented');
}
```

## Step 5: Generate srv/types.cds (if needed)

If any action signature references a complex inline type, extract to `srv/types.cds`:

```cds
namespace <namespace>;

type SalesFilterType : {
  fromDate   : Date;
  toDate     : Date;
  customerId : String(10);
};

type ReportLine : {
  customerId   : String(10);
  customerName : String(80);
  netAmount    : Decimal(15, 2) @Semantics.amount.amount;
  currency     : String(5)      @Semantics.amount.currencyCode;
};
```

Import in `srv/service.cds`:

```cds
using { <namespace>.SalesFilterType, <namespace>.ReportLine } from './types';
```

## Step 6: Validate

### 6a. CDS compile

```bash
npx cds compile <target>/srv --service all --to edmx > /dev/null
```

Must succeed. Common errors:

| Error | Cause | Fix |
|---|---|---|
| `Cannot resolve entity 'X' in projection` | Entity name mismatch with schema.cds | Re-read schema.cds; verify namespace and exact entity name |
| `Action parameter type 'Y' not found` | Inline type referenced but not declared | Move type definition to `srv/types.cds` |
| `Duplicate action 'foo'` | Same FM name appears in two FUGR | Disambiguate: prefix with FUGR name or refactor |
| `Bound action requires entity context` | First param doesn't match an entity key | Re-evaluate bound vs unbound classification |

### 6b. TypeScript compile

```bash
cd <target> && npx tsc --noEmit srv/handlers/*.ts
```

If errors → most likely typing issue with action parameters. Add explicit type annotations or import types from `@cap-js/cds-types` (auto-generated).

### 6c. Lint (CAP eslint if configured)

```bash
cd <target> && npx eslint srv/
```

## Step 7: Emit Migration Notes

Append at end of `srv/service.cds`:

```cds
// ============================================================================
// Migration notes (ABAP source: <package> → CAP service)
// ============================================================================
//
// - <N> entities exposed as projections
// - <M> bound actions (derived from <P> Function Modules)
// - <Q> unbound actions (derived from <R> reports)
// - <S> handler files generated with TODO stubs
//
// Handlers requiring manual implementation:
//   - <list of action names with ABAP source ref>
//
// ABAP objects SKIPPED:
//   - <list with reason: state-ful class, ENH_* enhancement, etc.>
//
// Suggested follow-up:
//   1. Review each TODO in srv/handlers/*.ts
//   2. Translate ABAP business logic per the inline pattern hints
//   3. Run modernize-abap-fiori-elements to generate UI for these entities
//   4. Run modernize-abap-auth-mapping to refine the @restrict placeholders
// ============================================================================
```

## Re-validate

After user implements handler logic:

```bash
cd <target>
npx cds compile srv --service all --to edmx
npx tsc --noEmit srv/handlers/*.ts
npm test
```

## BTP vs On-Premise Differences

| Aspect | BTP target | On-prem CAP (out of scope v1) |
|---|---|---|
| Handler runtime | Node.js on Cloud Foundry | Node.js on-prem or Cloud Foundry on-prem |
| Logging | `cds.log()` → BTP Application Logging | `cds.log()` → stdout (caller-defined sink) |
| Audit | `@audit-log` → BTP Audit Log Service | `@audit-log` → custom adapter |
| Remote calls | `cds.connect.to('<destination>')` via BTP Destination Service | Same — Destination Service is portable |
| Transactions | `cds.tx(req)` — auto-commit on `req.on('succeeded')` | Same |

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `SAPRead FUNC` returns empty signature | FM has no parameters (only TABLES or LOCAL types) | Treat as unbound action; flag in TODO |
| FM uses `BAPIRET2` for error return | Standard SAP error pattern | Map to `req.reject` in handler; document in TODO |
| Class method calls a deprecated SAP API | Clean Core gap (Level B/C/D) | Skill emits TODO with `// REVIEW: replace with released API per modernize-abap-clean-core-gap report` |
| Program has SY-* dependency (sy-uname, sy-datum) | Implicit context | Map to: `sy-uname` → `req.user.id`; `sy-datum` → `new Date().toISOString().slice(0, 10)` |
| Function group has internal tables shared across FMs | State leakage | Refactor: handler module state is generally unsafe; flag for redesign |
| Recursive call to `Z_HELPER_FM` | Infinite recursion risk | Skill doesn't translate logic, just adds comment; user must avoid in handler |

## What This Skill Does NOT Do

- **No business logic translation** — handlers are stubs with TODO comments + ABAP excerpts for context
- **No SELECT → CDS-QL auto-conversion** — suggests CDS-QL in comments; manual translation needed
- **No PERFORM → handler function auto-conversion** — flagged in comments
- **No screen flow / module pool decomposition** — UI lives in Fiori Elements ([modernize-abap-fiori-elements](../modernize-abap-fiori-elements/SKILL.md))
- **No CALL SCREEN handling** — UI flow doesn't map to CAP backend
- **No FM tables-parameter migration** — flagged as deprecated pattern; user redesigns to entities/actions
- **No ABAP exception class hierarchy mapping** — single error pattern via `req.reject` / `Error`
- **No replacement of deprecated APIs** — that's [modernize-abap-clean-core-gap](../modernize-abap-clean-core-gap/SKILL.md)

## When to Use This Skill

- As Step 4 of [modernize-abap-to-btp-cap](../modernize-abap-to-btp-cap/SKILL.md), after schema generation
- Standalone: extend an existing CAP service with new actions derived from Z FMs
- Onboarding: get a quick map of "what ABAP entry-points exist in this package" without running the orchestrator

## When NOT to Use This Skill

- ABAP package uses CFW (Control Framework) heavily → UI logic doesn't port; redesign UI in Fiori Elements first
- ABAP code uses dynamic call (`PERFORM ... IN PROGRAM`, `CALL FUNCTION DESTINATION DYNAMIC`) → handler scaffolds will not capture indirect dispatch; manual analysis required
- Source contains BSP applications → use [convert-ui5-to-fiori-elements](../convert-ui5-to-fiori-elements/SKILL.md) or equivalent UI skill

## Follow-up

After this skill produces the service scaffold:

- [modernize-abap-fiori-elements](../modernize-abap-fiori-elements/SKILL.md) — generate Fiori Elements V4 UI for the new service
- [modernize-abap-auth-mapping](../modernize-abap-auth-mapping/SKILL.md) — refine `@restrict` annotations from AUTHORITY-CHECK in source
- [generate-cds-unit-test](../generate-cds-unit-test/SKILL.md) — generate tests for service projections with CASE/computed fields
- Manual: implement handler TODOs by translating ABAP business logic

## References

- [CAP service definitions](https://cap.cloud.sap/docs/cds/cdl#services)
- [CAP TypeScript handlers](https://cap.cloud.sap/docs/node.js/typescript)
- [CAP CDS-QL](https://cap.cloud.sap/docs/node.js/cds-ql)
- [OData V4 bound/unbound actions](https://cap.cloud.sap/docs/cds/cdl#actions-and-functions)
- [CAP error handling](https://cap.cloud.sap/docs/node.js/best-practices#error-handling)
