# Issue #31: RuntimeRunClassWithProfiling Returns Stale Trace ID

> **Priority**: Low
> **Source**: fr0ster issue #31 (closed, 2026-04-02)
> **ARC-1 component**: `src/adt/diagnostics.ts`

## Issue description

When running a class with profiling (`IF_OO_ADT_CLASSRUN`), the profiler trace ID returned may be stale — pointing to a previous trace rather than the one just generated. This is a timing issue: the trace isn't immediately available after execution completes.

## ARC-1 current state

ARC-1's `SAPDiagnose` has a `traces` action that lists and reads profiler traces, but does **not** have an "execute with profiling" action. Users run their code separately and then use SAPDiagnose to retrieve traces.

## Assessment

Since ARC-1 doesn't execute ABAP programs with profiling (this is a Low #29 feature — "Execute ABAP"), this timing issue doesn't apply. If execute-with-profiling is ever added, keep this edge case in mind: add a delay or polling mechanism before returning the trace ID.

## Decision

**Not applicable** — ARC-1 doesn't have execute-with-profiling. File for future reference only.
