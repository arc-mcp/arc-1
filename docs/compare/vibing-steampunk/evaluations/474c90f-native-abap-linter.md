# Native Go ABAP Linter (abaplint Port)

> **Priority**: Low
> **Source**: VSP v2.32.0 — commit 474c90f (2026-03-21)
> **ARC-1 component**: `src/lint/lint.ts`

## What VSP did

Ported the abaplint lexer from TypeScript to Go using their ts2go transpiler, then built a native Go ABAP linter with 8 rules. Achieves 100% match against the original abaplint on a test corpus of 29 files. Performance: 795μs/file (3.5M tokens/sec).

## ARC-1 current state

`src/lint/lint.ts` uses `@abaplint/core` directly — the original TypeScript source. Full rule set available, same dependency used by the abaplint community.

## Assessment

VSP ported abaplint to Go because they can't use npm packages in a Go binary. ARC-1 uses the original — no port needed. The original is better maintained and has the complete rule set.

## Decision

**No action needed** — ARC-1 uses the authoritative source. This is only relevant if ARC-1 were rewritten in Go.
