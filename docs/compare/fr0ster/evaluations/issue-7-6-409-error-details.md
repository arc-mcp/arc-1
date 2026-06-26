# Issues #6/#7: 409 Conflict Error Detail Extraction for LLM

> **Priority**: Medium
> **Source**: fr0ster issues #6 (closed, 2026-01-29), #7 (closed, 2026-01-30)
> **ARC-1 component**: `src/adt/errors.ts`, `src/adt/crud.ts`

## Issue description

When SAP returns 409 Conflict (e.g., object locked by another user, transport mismatch), the error response body contains detailed information about WHY the conflict occurred — but fr0ster was only showing the HTTP status code, not the SAP error details.

Fix: Extract and forward the full SAP error body from 409 responses so the LLM (and user) can understand and resolve the conflict.

Common 409 scenarios:
- Object locked by user X in transport Y → "Check SM12"
- Transport request mismatch → "Object is in transport Z, not the one provided"
- Object exists and cannot be overwritten → "Use update instead of create"

## ARC-1 current state

`src/adt/errors.ts` defines `AdtApiError`:
```typescript
export class AdtApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string,
    // ...
  )
}
```

`src/adt/http.ts` catches axios errors and creates `AdtApiError` with the response body. The handler in `src/handlers/intent.ts` returns the error message to the LLM.

**Question**: Does ARC-1 include the SAP error body in the message, or just the HTTP status message?

## Assessment

Need to verify the error flow:
1. Does `src/adt/http.ts` extract the SAP XML error body from 409 responses?
2. Does `AdtApiError.message` include the detailed SAP error text?
3. Does the handler return this to the LLM in a way it can act on?

If ARC-1 already surfaces the full SAP error body, no action needed. If it only returns "409 Conflict", the fix is to parse the XML error body and include it in the error message.

SAP ADT 409 response body format:
```xml
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/...">
  <exc:message>Object ZCL_FOO is locked by user DEVELOPER in task E19K900001</exc:message>
</exc:exception>
```

## Decision

**Verify and fix if needed** — Check `src/adt/http.ts` error handling. If 409 error bodies are already forwarded to the LLM, mark as done. If not, parse the XML exception body and include it in `AdtApiError.message`.

**Effort**: 0.5d (investigation + potential fix)
