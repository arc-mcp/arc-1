# DDIC Domain & Data Element Write Operations

> **Priority**: High
> **Source**: abap-adt-api commits 646bb9b + 561cb54 (v7.1.1, 2026-03-03)
> **ARC-1 component**: `src/adt/client.ts`, `src/adt/crud.ts`

## What abap-adt-api added

Two new methods on ADTClient:

### `setDomainProperties(domainUrl, lockHandle, properties)`
```typescript
interface DomainProperties {
  description?: string
  dataType?: string
  length?: number
  decimals?: number
  outputLength?: number
  fixValues?: Array<{ low: string; high?: string; description?: string }>
}
```
Uses `PUT` on the domain source URL with XML body containing property updates.

### `setDataElementProperties(dtelUrl, lockHandle, properties)`
```typescript
interface DataElementProperties {
  description?: string
  domainName?: string
  dataType?: string
  length?: number
  decimals?: number
  labels?: { short?: string; medium?: string; long?: string; heading?: string }
  fixValues?: Array<{ low: string; high?: string; description?: string }>
}
```

## ARC-1 current state

- **Read**: ARC-1 reads DOMA and DTEL via SAPRead with structured metadata output
- **Write**: ARC-1 can write CDS objects (DDLS, DDLX, BDEF, SRVD) via SAPWrite but **cannot write DOMA or DTEL properties**
- **Pattern**: ARC-1's crud.ts handles lock → PUT → unlock for source-based objects. DOMA/DTEL write would need property-based XML body construction.

## Assessment

This is the most complete DDIC write implementation in any TypeScript ADT client. Having domain/data element write in ARC-1 would enable:
- AI-assisted data modeling (create table → create domain → set fixed values → create data element → assign)
- Automated DDIC maintenance (update descriptions, add fixed values)
- Full RAP stack creation without manual DDIC steps

## Decision

**Implement** — Add `setDomainProperties` and `setDataElementProperties` to `src/adt/crud.ts`. Reference abap-adt-api's implementation for the XML body format. Expose via SAPWrite with `action: update_domain` and `action: update_data_element`.

**Effort**: 1-2d (XML body construction, lock handling already exists)
