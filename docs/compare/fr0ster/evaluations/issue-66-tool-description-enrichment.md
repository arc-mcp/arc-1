# Issue #66 — Enrich tool descriptions with related-operation context

> **Priority**: Low (medium for the underlying lesson)
> **Source**: fr0ster v6.3.0 — issue #66 + 12 enrichment commits (2026-04-17): `556c7c6` Class, `5c55572` Program, `87539b7` Table, `46c7822` View, `91411da` Domain, `c376a1e` DataElement, `95f7c69` Interface, `3bcbb1f` FunctionModule, `70f5a37` BehaviorDefinition, `2be6b43` MetadataExtension, `9e4eedb` ServiceDefinition, `9643db8` ServiceBinding, `fbdec83` Structure
> **ARC-1 component**: `src/handlers/tools.ts` (tool descriptions for SAPRead/SAPWrite/SAPActivate)

## What fr0ster did

Their RAG-based tool selector (in `cloud-llm-hub`) was vector-matching `CreateClass` for the query "create a class with Hello World" but **not** `UpdateClass` — even though both are needed (CreateClass produces an empty shell; UpdateClass adds the source). RAG only sees a single tool description and ranks the closest match.

Fix: enrich each Create/Update/Read description with cross-references to its sibling operations so all three tools appear semantically related to a single user intent.

Pattern applied to 13 object types:

```diff
-Update ABAP class source code — global definition, implementation, ...
+Update ABAP class source code — global definition, implementation, ...
+Use after CreateClass to add implementation, or to modify existing class code.
```

```diff
-Read ABAP class source code.
+Read ABAP class source code.
+Use to inspect current source before UpdateClass, or to verify after CreateClass.
```

```diff
-Create empty ABAP class.
+Create empty ABAP class. After creating, use UpdateClass to add source code
+and ActivateClass to activate.
```

Net effect: a single workflow ("create a class with Hello World") now scores higher on UpdateClass and ActivateClass too, so RAG returns all three.

## ARC-1 current state

ARC-1 doesn't have this problem in the same form: 12 intent-based tools, no per-type tool explosion. The LLM picks `SAPWrite` for any write, then chooses `action: 'create'` vs `'update'` from a small enum. There's no RAG ranking of 200+ tools — the model sees the tool's full description in the system prompt.

That said, **ARC-1's tool descriptions still benefit from cross-action hints**. Today (`src/handlers/tools.ts`):

- `SAPWrite` description lists actions in a flat enum without explicit chain-of-operation guidance ("after `create`, call `update` to add source then `activate`").
- `SAPActivate` is described in isolation — doesn't mention it's the natural follow-up to `SAPWrite(create)` for object types that don't auto-activate.
- `SAPRead` already has very rich descriptions (e.g. the impact-analysis blurb) but doesn't say "use before `SAPWrite(update)` to pull current source for round-trip edits".

The LLMs we target (Claude, GPT-4o, Copilot Studio) handle the 12-tool surface fine — but the *workflow ordering* is what we under-document, not tool selection.

## Assessment

**Lesson, not implement.** fr0ster's RAG fix doesn't apply to ARC-1's architecture. But the underlying observation — that tool descriptions should advertise their place in a multi-step workflow — does, just at a different granularity. For ARC-1 the equivalent improvement is in the descriptions of `SAPWrite.create`, `SAPWrite.update`, and `SAPActivate` (and possibly the top-level tool description) explaining the typical chain:

```
SAPWrite(create) → SAPWrite(update, source=...) → SAPActivate
```

…and similarly for the read-modify-write pattern:

```
SAPRead → SAPWrite(update, source=mutated) → SAPActivate
```

This is a small docstring polish, not a code change. Worth bundling into the next time we touch tool descriptions for a new feature; not worth a dedicated PR.

## Decision

**consider-future / docstring-polish** — when the next change brings us into `src/handlers/tools.ts`, add 1–2 lines of workflow context to:

- `SAPWrite` description: explain the `create → update(source) → activate` chain explicitly.
- `SAPActivate` description: mention it's the typical follow-up to `SAPWrite(create|update)` and call out which actions implicitly activate vs not.
- `SAPRead` description: brief "use before SAPWrite(update) for round-trip edits" hint.

**No new evaluation file or follow-up needed for the per-type Class/Domain/etc. enrichment** — that pattern is RAG-specific.

**Cross-reference matrix**: this is the same lesson as v4.4.0 (commit `cfe67d2-rag-tool-descriptions.md`) and v5.0.1's removal of the duplicate compact feed wrappers — RAG ergonomics keep biting fr0ster, while ARC-1's intent design keeps sidestepping the entire problem.
