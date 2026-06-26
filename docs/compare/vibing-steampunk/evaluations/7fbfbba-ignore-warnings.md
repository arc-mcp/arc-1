# ignore_warnings Parameter for EditSource

> **Priority**: Medium
> **Source**: VSP issue #33, commit 7fbfbba (2026-02-23)
> **ARC-1 component**: `src/adt/devtools.ts`, `src/context/method-surgery.ts`

## What VSP fixed

EditSource performs syntax check after writing and treats warnings as errors, rejecting the save. This is overly strict — warnings (like "variable declared but not used") shouldn't block saves.

Fix: Added `ignore_warnings` boolean parameter. When true, syntax check results with only warnings (no errors) are treated as success.

## ARC-1 current state

`src/context/method-surgery.ts` `replaceMethod()` writes the method source. The syntax check behavior after write depends on the `activate` flag in SAPWrite.

**Question**: Does ARC-1's edit_method action syntax-check after write? If so, does it distinguish errors from warnings?

## Decision

**Verify** — Check if ARC-1's method surgery or SAPWrite checks syntax after edit and whether warnings cause rejection. If so, add ignore_warnings support.

**Effort**: 0.5d
