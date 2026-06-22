# Context-First KTD Workflow

## Overview

This plan makes ARC-1's Knowledge Transfer Document support easier for both humans and LLMs to use.
Today SKTD read/write exists, but callers have to know the SAP technical object type and remember a
separate `SAPRead(type="SKTD")` step before object analysis. The target workflow is context-first:
use `SAPContext` when the user asks what an ABAP object does or is about to specify/change it, and
let ARC-1 surface the object KTD when available.

The implementation is deliberately small: add `KTD` as a friendly alias for `SKTD`, compose an
existing KTD into `SAPContext(action="deps")` output when present, and update public/tool-facing
documentation so agents are steered away from raw `SAPRead` for object understanding.

## Context

### Current State

`SAPRead` and `SAPWrite` already support `SKTD` and the low-level ADT endpoint is implemented in
`AdtClient.getKtd()`. `SAPRead(type="SKTD")` decodes the base64 Markdown envelope, and SKTD create
and update preserve SAP's XML metadata. `SAPContext(action="deps")` currently returns dependency
contracts only; it does not include KTD content, so project instructions have to teach agents a
manual two-step workflow.

### Target State

Agents can call `SAPContext(type="CLAS", name="ZCL_ORDER")` for object understanding. If a KTD exists
for that object, the response starts with a Knowledge Transfer Document section before dependency
contracts. If no KTD exists or the backend does not support KTD, `SAPContext` continues with the
dependency result. `SAPRead` and `SAPWrite` accept `type="KTD"` as a visible, friendly alias while
runtime behavior remains canonical `SKTD`.

### Key Files

| File | Role |
|------|------|
| `src/handlers/object-types.ts` | Type normalization before Zod validation and handler routing |
| `src/handlers/tool-registry.ts` | Single source for visible SAPRead/SAPWrite type enums |
| `src/handlers/context.ts` | `SAPContext` handler and KTD prelude composition |
| `src/handlers/schemas.ts` | Zod schemas, including the new `includeKtd` option |
| `src/handlers/tools.ts` | LLM-visible tool descriptions and JSON Schema |
| `tests/unit/handlers/*` | Unit coverage for alias normalization, schema/tool surface, and context behavior |
| `README.md`, `docs_page/tools.md`, `docs_page/mcp-usage.md`, `docs_page/index.md`, `docs_page/caching.md` | Public documentation updates |
| `.claude/commands/implement-feature.md` | Local workflow guidance that should prefer `SAPContext` for understanding |

### Verified Live Evidence

No new ADT endpoint or XML parser is introduced. The existing KTD surface is documented in
`research/abap-types/types/sktd.md`: `SKTD/TYP` maps to `/sap/bc/adt/documentation/ktd/documents/`,
uses `application/vnd.sap.adt.sktdv2+xml`, and was verified via PR #134 integration evidence on
S/4HANA 2023. This plan only reuses `AdtClient.getKtd()` and `decodeKtdText()`.

### Design Principles

1. Keep `SKTD` as the canonical runtime type; `KTD` is only a friendly alias.
2. Do not create a new top-level MCP tool. Preserve ARC-1's 12 intent-tool design.
3. Compose KTD at response-render time, not into the dependency graph cache. Dependency graphs remain keyed by source hash.
4. Do not alter `SAPContext(action="impact")` JSON output in this pass; KTD prelude applies to dependency context output.
5. Do not fail object understanding when KTD is missing or unsupported. Missing KTD is a normal condition.
6. Do not auto-create or update KTD. Writes remain explicit user-approved `SAPWrite` calls.

## Development Approach

Start with type alias tests so `KTD` is visibly accepted and normalized. Then add the KTD prelude
inside `SAPContext(action="deps")`, using the existing source cache path for `SKTD` so successful
reads stay ETag-revalidated. The first pass will not add negative caching for KTD 404s; that can be
a later cache-interface change if the added lookup cost shows up in usage. Finally update public
docs and LLM-facing tool descriptions together, because discoverability is the main product goal.

Unit tests should cover happy path, missing KTD, and opt-out behavior. No integration test is needed
because the ADT endpoint is not new and existing SKTD tests already cover wire shape.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

### Task 1: Add the KTD alias to the tool surface

**Files:**
- Modify: `src/handlers/object-types.ts`
- Modify: `src/handlers/tool-registry.ts`
- Modify: `tests/unit/handlers/dispatch-misc.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/tool-definitions-snapshot.test.ts` fixtures if the enum snapshot changes

Expose `KTD` as a friendly alias for `SKTD` while keeping canonical runtime behavior unchanged.

- [x] Add a non-slash friendly alias map in `object-types.ts` so `normalizeObjectType("KTD")` returns `SKTD`.
- [x] Add `KTD` rows to the SAPRead and SAPWrite type tables after `SKTD`, with `btp: true`.
- [x] Add unit tests for normalization, SAPRead/SAPWrite schema acceptance, and tool enum visibility.
- [x] Update tool-definition snapshots if the visible JSON Schema enum changes.
- [x] Run targeted tests for object type normalization, schemas, registry sync, and tool definitions.

### Task 2: Add KTD prelude to SAPContext dependency output

**Files:**
- Modify: `src/handlers/context.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/manage-context.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/tool-definitions-snapshot.test.ts` fixtures if the schema changes

Make `SAPContext(action="deps")` the natural first call for object understanding by including the
object's KTD when one exists.

- [x] Add `includeKtd` as an optional boolean on SAPContext schemas and JSON Schema, defaulting to enabled for `action="deps"`.
- [x] In `handleSAPContext`, fetch `SKTD` via `client.getKtd()` and the existing `CachingLayer.getSource()` path when `includeKtd !== false`, no user-provided `source` was supplied, and the action is dependency context.
- [x] Decode KTD Markdown with `decodeKtdText()` and prepend it to the dependency output only when non-empty.
- [x] Treat 404/410 as "no KTD" and continue; rethrow other ADT errors.
- [x] Preserve dep-graph cache behavior: a cached dependency result may still be rendered with freshly revalidated KTD.
- [x] Add tests for KTD prelude, KTD not found fallback, `includeKtd=false`, and cached dep-graph composition.
- [x] Run targeted context/schema/tool tests.

### Task 3: Document context-first object understanding

**Files:**
- Modify: `README.md`
- Modify: `docs_page/index.md`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/mcp-usage.md`
- Modify: `docs_page/caching.md`
- Modify: `.claude/commands/implement-feature.md`

Promote the new behavior publicly and steer LLMs toward `SAPContext` for object understanding.

- [x] Add a context-first highlight to README and docs index.
- [x] Update `docs_page/tools.md` so the `SAPContext` section says to use it for "what does this object do?" and pre-change orientation, while `SAPRead` is for exact source/method/grep/draft reads.
- [x] Update `docs_page/mcp-usage.md` "Read and Understand a Class" to start with `SAPContext`.
- [x] Update `docs_page/caching.md` to explain that KTD uses source-cache entries but is composed separately from dependency graph cache.
- [x] Update `.claude/commands/implement-feature.md` to prefer `SAPContext` before raw source reads for understanding.

### Task 4: Final verification

- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Review the complete diff for unrelated changes and accidental secret exposure.
- [x] Move this plan to `docs/plans/completed/` and fix links if needed.
