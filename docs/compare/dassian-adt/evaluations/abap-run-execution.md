# Evaluation: abap_run — Execute ABAP via IF_OO_ADT_CLASSRUN

**Priority**: Medium (security concern)  
**Source**: DassianInc/dassian-adt `src/handlers/RunHandlers.ts` (deep analysis 2026-04-16)  
**ARC-1 Component**: Not implemented (intentional — FEAT-29 P3 backlog)

## What They Did

Complete ADT-based ABAP execution flow using SAP's IF_OO_ADT_CLASSRUN interface:

```
1. Read IF_OO_ADT_CLASSRUN interface source to detect run vs main method
   GET /sap/bc/adt/oo/interfaces/if_oo_adt_classrun/source/main
   → If "main" in source: use if_oo_adt_classrun~main (SAP 2024+)
   → Else: use if_oo_adt_classrun~run (SAP ≤2023)

2. Create temp class ZCL_TMP_ADT_RUN in $TMP
   POST /sap/bc/adt/oo/classes (or whatever ADT creates for CLAS/OC)

3. Lock → Write source → Unlock (withSession)

4. Activate (standard ADT activation)
   → Log out (some systems require session close to commit activation)

5. Execute: POST /sap/bc/adt/oo/classrun/{className}
   Accept: text/plain
   → New stateless session for CSRF
   → Capture response body (plain text output from out->write())

6. finally: lock → deleteObject (best-effort cleanup)
```

**Generated template:**
```abap
CLASS zcl_tmp_adt_run DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_tmp_adt_run IMPLEMENTATION.
  METHOD if_oo_adt_classrun~{run|main}.
    " user ABAP code here
  ENDMETHOD.
ENDCLASS.
```

## Key ADT Endpoint

`POST /sap/bc/adt/oo/classrun/{className}` with `Accept: text/plain`

This is the same endpoint used by Eclipse ADT's "Run as ABAP Application" feature.

## Safety Analysis

This is intentionally excluded from ARC-1's roadmap for good reasons:

1. **Arbitrary code execution** — any ABAP runs with the SAP user's full authorization (S_DEVELOP ACTVT=16)
2. **Bypasses all safety gates** — read-only mode, package restrictions, operation allowlist are all irrelevant once arbitrary code runs
3. **Database modifications** — ABAP can UPDATE/DELETE any table the user has access to
4. **Side effects** — workflow actions, mail sends, external system calls
5. **No audit trail** — the execution itself is not captured in ARC-1's audit log (only the tool call)

## When ARC-1 Might Consider It

If ever implemented, requires:
- New `OperationType.Execute` (E) code in safety system
- `SAP_ALLOW_EXECUTE=true` config flag (off by default, never)
- MCP elicitation with explicit confirmation + code preview
- Scope: requires `admin` scope, not `write`
- Cleanup: always delete the temp class even on error
- Timeout: SAP classrun may hang — need HTTP timeout (30s)

## Decision

**Not planned.** Security risk outweighs utility. LLMs can write ABAP code for users to run manually. The managed-gateway model (ARC-1's core design principle) is undermined by arbitrary execution.

Reference: Listed in FEAT-29 P3 Backlog under "Execute ABAP (security risk)".
