# Private pinned RAP orchestration

Status: independently reviewed private implementation, **not public admission or native/PP qualification**.
The design and earlier review history below retain their historical scope; the latest correction
disposition is recorded at the end.
This implements the RAP part of P2-C in the [accepted plan](../plans/2026-10-26-broader-pinned-pp-writes.md).
The existing public pinned capability matrix still refuses both RAP actions.

## Shared implementation and preserved defaults

`handlers/write/pinned-rap.ts` supplies a private registered profile to the existing
`write/rap.ts` and `adt/rap-generate.ts` orchestrators. The pure `rap-handlers.ts` generator
is unchanged. Single-target callers retain their original sessions, optional input behavior,
linting, reports, activation handling and defaults. A multi-target client cannot directly call
the legacy source reader or generator without this profile.

`scaffold_rap_handlers` still defaults to preview; `autoApply` reads and plans again under
the behavior-pool lock, lints the complete changed source set before the first save, and never
activates. `generate_behavior_implementation` still defaults to applying and activating,
supports `dryRun`/`activate=false`, and locks and optionally activates even on a no-change rerun.
New local handler definitions and implementations remain together in CCIMP. Existing handlers
can be edited in MAIN, CCDEF or CCIMP according to the shared generator's existing placement rules.

## Exact scope and evidence

- One behavior-pool CLAS owner, with only its exact MAIN, CCDEF and CCIMP editable resources.
  Multiple BDEF entities do not create multiple class owners. No batch, arbitrary URI, explicit
  source, include selector, caller hash or caller-supplied generated plan is accepted.
- Namespace-bound native class identity, category, own package, native version, include inventory
  and root-entity reference are checked. Supplied owner/package URIs must agree with the selected
  identities; malformed or contradictory references are refused. The BDEF metadata identity/package/version and complete
  canonical metadata hash bracket a fresh editable source GET. The real class source and BDEF
  implementation declaration must bind each other. BDEF reads do not acquire mutation package
  rights or a BDEF activation grant.
- Apply obtains fresh affected sources and BDEF evidence under the one class lock, using the
  accepted **fresh-under-lock semantics, without a caller multi-source hash protocol**. The
  recorded native versions are observations; unversioned source GETs are labelled editable,
  not an atomic snapshot or a guaranteed draft. The class lock does not lock the BDEF.
- Both global and destination package/request ceilings apply to the actual class package and
  canonical recording request. The shared lock policy validates native identity, ownership and
  recording context. Package/recording and BDEF identity/version/source are rechecked before
  initialization/save and at activation reference-validation boundaries.
- Missing CCDEF/CCIMP may be initialized only after the existing typed native absence discriminator
  and matching absent metadata under the same owner lock. Generic 404/403/5xx never establish
  absence. The shared include protocol initializes and saves without opening a second lock/session.
  An initialization also requires the nested create action to be allowed.
- Activation uses the finalized common nested preparation with the **same context/deadline**.
  Native references may identify only this class and its known include resources. The report
  retains expanded scope and warns that activation covers the whole class, including preexisting
  inactive macros/test includes; RAP does not edit those resources. BDEF expansion is refused.
  Sources are checked again before activation, and successful confirmation additionally needs
  native active owner/include metadata and exact active MAIN/CCDEF/CCIMP readback.

There is no rollback or automatic replay. The result distinguishes observed/absent sections,
unconfirmed initialization, confirmed initialization, unconfirmed save and verified save. It
reports actual readback hashes (including SAP newline normalization), activation uncertainty,
the observed owner/include versions, BDEF evidence, and owning-session cleanup. A later failed
section, drift, timeout, cancellation or uncertain unlock/close retains earlier partial outcomes.
Activation cannot proceed after unconfirmed cleanup.

## Bounds and explicit contract gaps

The call has one five-minute deadline, one class owner, three possible source saves, at most two
include initializations, 1–10 BDEF entities and 1–100 parsed handler requirements. RAP evidence
reads are limited to 100 GETs, 256 KiB per response and 4 MiB cumulative successful bodies;
include save readback separately has a 256 KiB response cap. Existing shared lock/CTS/activation
profiles retain their own limits. Each source/generated section is limited to 256 KiB and 5,000
lines; nested report/activation details are bounded to 64 KiB each. Limits may stop a call after
earlier successful mutations; that outcome is reported as partial, never rolled back or replayed.

The private BDEF envelope consumes every token and independently derives the required entity,
alias, handler kind, method and full signature. Each must match exactly one shared-parser result;
no skipped/extra/duplicate requirement is accepted. Validation covers the complete BDEF before
`targetAlias` selects the handlers to generate, including clauses in unselected entities. Comments
and literal contents cannot create requirements; literal delimiters remain visible so a string
outside the supported annotation cannot hide unknown syntax. The accepted subset is:

- One managed or unmanaged implementation binding to the exact class; optional `strict (1|2)`.
  Simple non-namespaced identifiers; explicit same-line entity/alias headers (spaces/tabs only),
  unique entity names and aliases, and aliases of at most 26 characters for the `lhc_` prefix.
- The shared generator's five handler kinds: actions (including static, internal, factory and
  static-factory prefixes), determinations on modify/save, validations on save, and a single
  instance **or** global authorization mode per entity. Action parameters/results/cardinalities
  are explicit; at most 20 continuation lines follow an action header. Handler headers start on
  their own lines, and the complete signatures must agree with the shared generator.
- Managed persistence/lock/etag headers, plain create/update/delete, static readonly/mandatory
  fields, plain associations or association-create blocks, and explicit field-to-column mappings.
  Unmanaged plain `read` is admitted: the existing `BP_DEMO_RAP_STRICT` fixture/test demonstrates
  read plus global authorization with the same generated handler layout. Known action/auth
  signatures also remain available in this restricted unmanaged envelope.
- The known non-handler `@EndUserText.label` annotation, with a single-line string value.
  Existing class sources still need complete unambiguous class/method blocks; multiline literals,
  backticks/templates, unresolved generated members and excessive inputs remain refused.

These exclusions have different evidence and must not be confused with complete single-target parity:

| Refused contract | Actual shared-generator limit / remaining evidence |
|---|---|
| Instance/global feature controls; prechecks | `RapHandlerKind` and the extractor have no feature/precheck handler kind. Recognizing the action itself does not generate its extra control method. Existing controls in a class do not establish full completeness. |
| Combined instance/global authorization | Both shared authorization regexes require the closing parenthesis immediately after one mode. Combined clauses produce neither method. Separate supported single-mode clauses on different entities are preserved. |
| Unmanaged CRUD or locking; explicit save/numbering/draft lifecycles | No CRUD/lock/saver/numbering/draft requirement or corresponding generator exists. Accepting an unmanaged class binding alone never proved those lifecycles complete. This does **not** justify refusing the demonstrated unmanaged read/auth envelope. |
| Unmanaged persistence/etag/mapping or associations; dependent authorization/locking; other syntax | Completeness/native semantics are not qualified by the current source/fixture contract. These are named parser/native-contract gaps, not claims that every such form requires a missing custom method. Basic managed associations are admitted because their explicit subset introduces no custom handler. |
| Functions/events, other action options, unknown annotations/clauses | No complete requirement derivation is available for these variants; accepting arbitrary ignored clauses would repeat the omission bug. |

This is a complete admission check for the stated bounded subset, **not** a complete ABAP/BDEF
grammar, compiler or native qualification. The shared legacy parser/generator is unchanged;
forms outside the private subset retain their existing single-target behavior and remain parity work.

Existing class declarations and the complete generated plan have a separate binding proof. A plain
or incompatible method with the expected name cannot satisfy an action/authorization requirement.
The proof checks the actual handler class, full kind/event/entity/result signature and the concrete
implementation method name. Semantic method names and formal parameter names may differ; a valid
renamed handler can coexist with an ordinary utility named like the BDEF action. Comments/literals
cannot supply declarations or missing bodies. Missing members can still be generated, but a
collision or ambiguous final plan refuses before any include initialization/save, including the
scaffold no-op path. Only selected-entity requirements must be complete. Existing unselected source
and utility bodies are preserved. If the inherited planner duplicates an unrecognized declaration
layout (for example a chained handler declaration), the private adapter refuses that unresolved plan
without automatic renaming; extending those shared parser layouts remains a parity gap.

Native metadata also must match the explicit profile: exact behavior-pool category/root reference,
explicit active/inactive versions and exact source alternatives. Missing, contradictory, relative
or foreign alternatives are not guessed. Other releases/variants need captured native evidence
and reviewed support. Preview still requires the private pinned write identity/action/feature
gates, but performs GETs only and does not apply mutation package allowlists to ordinary reads.

## Offline evidence and remaining qualification

The new tests call the actual shared orchestrators and real ADT HTTP stack against a stateful
mock. The class metadata model starts from the repository's captured behavior-pool XML fixture;
mutated state/error variations are explicitly test models, not newly observed SAP responses.
Tests cover defaults, fresh-under-lock planning, placement, typed absence and uncertain initialization,
partial saves, package/recording/feature/scope denials, native mismatch, BDEF drift at submission and
activation, expanded scope, active readback, cleanup/cancellation/deadline and public closure.
Legacy RAP and existing pinned include suites remain regression checks.

Independent review reproduced four failures: both actions accepted a split-line alias with a
different parsed binding, action feature controls omitted their control handler, and combined
authorization omitted both handlers. The follow-up rejects the split headers, proves exact
requirements/signatures and refuses unimplemented clauses before initialization/save. All eight
original review probes pass after correction; adversarial variants, selected aliases, GET-only
previews, supported action forms and single-mode authorization controls have additional regressions.

A second independent review found that legacy name-only missing-member detection could hide a
required binding behind a plain/wrong-alias/wrong-kind method and save an incomplete plan. Its six
failing assertions now refuse before writes; valid renamed-handler and utility controls remain
accepted. Further tests cover result/event/auth-kind mismatches, all three source sections, absent
includes, previews, missing renamed implementations, final-plan ambiguity and literal-induced
false no-op detection. The shared single-target generator remains unchanged.

Still required: independent exact-candidate review; fresh native behavior-pool/BDEF/include evidence
for the intended releases and metadata variants; successful/incomplete/save-only/activation-only
lifecycles; real lock ownership, local and transportable recording, whole-class expansion and
cleanup; then current-code two-writer strict PP isolation and public schema/capability admission.
The separate six-owner declarative experiment has no behavior-pool owner and cannot qualify RAP.
No SAP/native execution, credentials, deployment or public admission was performed for this candidate.

## BDEF state-link representation correction

The native V4 BDEF metadata returned the exact same-owner alternative
`./<owned-name>?version=active` on inactive metadata (and the opposite version on active metadata).
The shared declarative helper already qualifies that literal spelling. The private RAP dependency
reader now uses that same helper **only for BDEF**, after native identity/type/package/version parsing.
Absolute same-owner `source/main?version=active|inactive` remains supported. Class and class-include
URI alternatives retain their existing exact source-path rules. No response URL is resolved or followed.

The sanitized metadata regression derives from the owned V4 default metadata SHA-256
`2ecbdf84c6d8fe9f526e696082cd3def3f40c6dcdbd1cc9abb6d5100a0d4fb00`. It rebinds the name/package to
a synthetic behavior-pool dependency and omits author/time/unrelated-link fields. This proves the
representation observed on that abstract BDEF, not a native managed or unmanaged behavior-pool run.

Unknown/foreign/path-traversing/extra-query alternatives, ambiguous duplicates, and a BDEF state-link
element missing its href refuse. Raw alternative values and complete metadata hashes remain in the
evidence; switching between two individually valid spellings is still a detected change. Before/after
source-read comparison and later dependency revalidation remain unchanged. Dependency reads do not
gain package write authorization or mutation scope. The actual private wrappers test both helpers'
preview/apply paths and failure before any source write with owning-lock cleanup; reads for applying
changes intentionally occur under the class lock.

The [independent correction review](2026-11-03-pinned-rap-bdef-link-review-verbatim.md) approved
`7b18bad0` for private integration: 400 focused tests plus eight additional wrapper tests covering
26 variants, all three TypeScript projects and static gates passed. All 4,789 source files and both
historical metadata hashes stayed unchanged. A process-wide socket guard recorded zero attempts.
The reviewer disclosed authorship of underlying RAP code; this approval independently covers the
correction, not whole-RAP/native qualification. Native behavior-pool scaffold/generate,
class/include save/activation/recording, current-code PP and public admission remain open. Historical
qualification builders, claims and evidence are unchanged. FEAT-93 retains those remaining gaps.
