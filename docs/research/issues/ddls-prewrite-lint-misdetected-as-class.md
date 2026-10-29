# Pre-write lint misclassifies known DDLS, PROG and INCL sources

- **Found:** 2026-10-27, S/4HANA on-premise (SAP_BASIS 758), `SAPWrite` `batch_create` of 4 DDLS + 1 SRVD, ARC-1 1.5.1
- **Reproduced on:** ARC-1 1.9.0, `origin/main` `b6213ec8` (2026-10-27). `src/lint/lint.ts` last changed in `c6244452`
- **Severity:** blocks valid DDLS writes (`create`, `batch_create`, `update`); workaround `lintBeforeWrite=false`
- **Related:** #627 fixed the same misclassification for annotation-free `extend view entity` only, by adding
  one more keyword to `detectFilename()`. #121 introduced DDLS pre-write lint and the CDS branches of the detector.
  Tracked by [#1134](https://github.com/arc-mcp/arc-1/issues/1134) and
  [PR #1119](https://github.com/arc-mcp/arc-1/pull/1119).

## Symptom

`SAPWrite(action="batch_create")` with DDLS sources that start with a block comment header.
Preflight rejected every DDLS, and nothing was created:

```
Pre-write lint check failed for DDLS ZI_EXAMPLE (abaplint syntax "v702").
  Line 1: [structure] Expected CLASSDEFINITION
  Line 1: [parser_error] Statement does not exist in the configured ABAP version(or a parser error), "/*****…"
  Line 9: [parser_error] … "viewEnhancementCategory"
  Line 10: [parser_error] … "authorizationCheck"
```

With `lintBeforeWrite=false`, the same sources were created and activated in SAP (warnings only), so the DDL was valid.
The cause is the file type abaplint was given. Why the message names `v702` on a 758 system was not investigated.

## Root cause

`runPreWriteLint()` (`src/handlers/write-helpers.ts`) knows the object type (`type === 'DDLS'`), but it calls
`detectFilename(source, name)` (`src/lint/lint.ts`), which **guesses** the type from the source text:

1. The leading-comment stripper `/^(\s*(["*!].*)?[\r\n]*)*/m` only removes ABAP-style lines that start with `"`, `*` or `!`.
   A DDL block comment (`/* … */`, `/***…***/`) or a DDL line comment (`// …`, or the obsolete but still valid `-- …`)
   is not stripped.
2. The text therefore starts with `/`, which is not a known keyword and not `@`, so detection falls through to
   `return \`${name}.clas.abap\`` ("Default to class").
3. abaplint parses the CDS as an ABAP class, and the result is `Expected CLASSDEFINITION` plus parser errors on every annotation.

The same fallback hits annotation-free DDL forms the detector does not list. #627 patched one of them
(`extend view entity`); as long as the known type is ignored, each unlisted form or header style fails the same way.

## Repro (built `dist/`, no SAP needed)

Detection plus the full `validateBeforeWrite()` result, as the gate runs it and with the filename forced to DDLS:

| DDLS source starts with | Detected | Gate result | Forced `.ddls.asddls` |
|---|---|---|---|
| `/****…*/` block comment, then annotations | `.clas.abap` | **blocked** (`Expected CLASSDEFINITION`) | pass |
| `// …` line comment, then annotations | `.clas.abap` | **blocked** | pass |
| `-- …` line comment, then annotations | `.clas.abap` | **blocked** | pass |
| `define custom entity` (no annotation) | `.clas.abap` | **blocked** | pass |
| `define abstract entity` (no annotation) | `.clas.abap` | **blocked** | pass |
| `define hierarchy` (no annotation) | `.clas.abap` | **blocked** | pass |
| `define table function` (no annotation) | `.tabl.astabl` | pass — lint silently skipped, not blocked | pass |
| `@…` annotations, then `define view entity` | `.ddls.asddls` | pass | pass |

These blocked examples pass once the known type is used; this does not establish support for every CDS form.

## Fix (PR)

1. **Use the known type** in `runPreWriteLint()`: one mapping covers exactly the five already-linted types:
   PROG/INCL → `.prog.abap`, CLAS → `.clas.abap`, INTF → `.intf.abap`, DDLS → `.ddls.asddls`.
   Unsupported/unknown types still skip this gate. No content-based override is used for known types.
2. **Harden `detectFilename()`** for callers without a type (`SAPLint` on raw source, `SAPContext` deps):
   - strip leading `/* … */` block comments and `// …` / `-- …` line comments, including between annotations
   - recognise `DEFINE [ROOT] CUSTOM ENTITY`, `DEFINE [ROOT] ABSTRACT ENTITY`, `DEFINE TRANSIENT VIEW ENTITY`,
     `DEFINE HIERARCHY`, `EXTEND CUSTOM ENTITY`, `EXTEND ABSTRACT ENTITY` as DDLS
   - check `DEFINE TABLE FUNCTION` **before** `DEFINE TABLE` (→ DDLS, not TABL)
3. **Unit tests** for each detector row above and `runPreWriteLint(…, 'DDLS', …)` cases (comment headers, custom/abstract
   entity) that must not block, plus one that must still report `cds_parser_error` behind a block-comment header.

The `--` comment style was found after the first fix: a DDLS with a `--` first line already passed the write gate
(known type) but `detectFilename()` still guessed `.clas.abap`, which affects `SAPLint` and `SAPContext` deps.

## PROG and INCL follow-up (29 October)

The contributor's October 27 comment identified the same issue for module-pool source beginning with `INCLUDE`.
On main `721755d5`, and on the original PR head `5b2f6b01`, this source is rejected with
`Expected CLASSDEFINITION`; the same source passes the program parser at v758:

```abap
INCLUDE ztop.
MODULE status_0100 OUTPUT.
ENDMODULE.
```

A PROG beginning with a local class and an INCL beginning with a local interface also select the wrong parser.
The mapping removes both guesses and the old INCL fallback special case. Existing CLAS/INTF source remains
linted, and source that belongs to the wrong object type is now rejected by the expected parser.

Regression tests use real abaplint, including malformed sources for each mapped type, table-function parser
controls, unsupported/unknown types, and dispatched create/batch/update paths. No tool schema or configuration
changes. Roadmap checked at start: no roadmap impact.

## Workaround (until released)

Pass `lintBeforeWrite: false` on DDLS writes (also top-level on `batch_create`). SAP activation still validates the source.
