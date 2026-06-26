# Create vs Update Separation (Breaking Change)

> **Priority**: Medium
> **Source**: fr0ster v3.1.0 — commit 9ef5843 (2026-03-03)
> **ARC-1 component**: `src/handlers/intent.ts` (SAPWrite), `src/adt/crud.ts`

## What fr0ster did

**Breaking change**: Create handlers no longer accept `source` parameter. The flow becomes:
1. `Create` — creates the object (empty skeleton, only metadata: name, package, transport)
2. `Update` — writes source code to the created object

Rationale: SAP ADT actually works this way internally — creation and source writing are separate operations. Combining them required the handler to do create→lock→write→unlock→activate, which was fragile.

## ARC-1 current state

SAPWrite has a single `action: "create"` that:
1. Creates the object
2. Locks it
3. Writes source (if provided)
4. Activates (if requested)

And `action: "update"` for modifying existing objects.

The combined create+write is a convenience for the LLM — one tool call instead of two.

## Assessment

**Pros of splitting**:
- Cleaner separation of concerns
- Fewer failure modes (create can succeed, then write is a separate operation)
- Matches SAP's actual API behavior

**Cons of splitting**:
- More LLM round trips (2 calls for what ARC-1 does in 1)
- ARC-1's intent-based routing already abstracts this — the LLM says "create class with this source" and it just works
- ARC-1's current approach hasn't had issues — try-finally unlock is solid

## Decision

**Keep current ARC-1 approach** — The combined create+write is a feature, not a bug. It reduces LLM round trips and the implementation is robust. fr0ster split because their handler error handling was fragile (#22 lock leaks); ARC-1 doesn't have this problem. No action needed.
