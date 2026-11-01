# Shared source updates and procedural edits — draft checkpoint

PR #1142 remains a draft. This checkpoint moves existing main-source updates onto the shared
`writeActionUpdate` handler and admits standalone on-prem PROG/INCL update, `edit_unit` and
`add_unit`. It is offline implementation evidence, not live PP qualification or whole-PR acceptance.
Program/include CRUD and activation now have offline implementation tests. Function-group ownership,
other types, management families and fresh PP qualification are still pending. The last successful live run remains `77e41fdcd`.

## Shared behavior

`pinned-source-context` and `pinned-source-lifecycle` replace the class-specific names. They provide
request-owned state, canonical source/owner selection, package/recording preflight and rechecks,
the owning lock, fresh mandatory source hash, one save, exact read-back and bounded cleanup.
Main updates now call the existing `writeActionUpdate` through `replaceOwnerSource`; procedural
callbacks use the same `withSourceEdit` lifecycle. The duplicate pinned main-update branch is gone.
Legacy update calls still delegate to `safeUpdateSource`, retaining their source preparation,
cache invalidation and quality timing. Pinned advisory syntax checks occur under the owning lock.

FORM/MODULE edits require complete named blocks and the full source hash; additions append at
physical EOF without relocating INCLUDE statements. Whole-line replacement refuses a boundary
shared with another statement. A defensive type-registry check also narrows classic programs for a synthetic BTP configuration.
Production discovered targets currently require OnPremise and use the on-prem runtime; this is
not evidence of a deployed BTP-target path. Descriptions follow the narrowed surface too. No group, alternate include/source URI, per-call
quality override or activation field is admitted. Read-only, aggregate and Basic policies are unchanged.

Existing PROG/INCL identifiers use an uppercase, optional-namespace envelope capped at 40 characters;
CLAS/INTF retain 30. A read-only A4H/001 GET of the standard `PROGNAME` data element reported
`CHAR` length `000040`. This is a field-envelope observation, not proof that every 40-character
name can be created or that an arbitrary name exists. Namespace routing and the envelope have
authored HTTP-mock tests; live program writing has not been qualified.

## Second Claude review and dispositions

Actual Claude Code **Opus 5.5, effort max** reviewed immutable
`cee2a18e17ed2c44a49e150fb5844784ea93d042` and returned three Medium and five Low findings:
[verbatim report](broader-pinned-pp-writes/claude-class-adapters-followup-review-20261101.md).
The reviewer independently passed the full 432-file/11,783-test suite, three TypeScript projects,
size/schema checks and 59 existing qualification-harness simulations. First/last snapshot checks
and the subsequent author check all verified the same 4,243 files unchanged. The reviewer did not
execute individual reproductions. The changes below need another independent review.

1. **Formatting-hidden ambiguity:** method inventory now walks parsed statements instead of
   depending on a single-class structure or line-regex fallback. It retains duplicate bodies,
   reads names from their own statements and scopes signatures to their containing class.
   Tests execute trailing comments, whitespace before periods, annotated class headers, inline
   bodies and normal single-class duplicates. Both route profiles refuse ambiguous include edits;
   qualified edits preserve the neighboring class. The shared-line formatting test now asserts
   the actual isolation refusal rather than an accidental ambiguity caused by the old name lookup.
2. **Replacement escaping a method:** replacement boundaries reject class/interface and other
   repository-unit boundary statements inside a selected method. Parser tests cover body-only
   and complete-block input; both handler profiles prove no PUT for an escaping include edit.
   Ordinary body syntax remains the lint/SAP responsibility.
3. **Definition/body symmetry:** definition edits compare abstract state, preserve declarations
   for existing interface bodies and distinguish real method declarations from similarly named
   interfaces/events/aliases. `Expressions.Abstract` identifies the flag, not any token named
   ABSTRACT. Handler tests execute removed-interface, both abstract transitions, an ABSTRACT
   method name/parameter, preserved interface bodies, and interface-only signature refusal.
   Newly introduced interfaces still require SAP's semantic validation.
4. **Transport on definitive refusal:** unchanged and rejected create/initialization/save results
   omit the unconfirmed transport. Confirmed prior creation and uncertain outcomes retain their
   appropriate context. Transportable include refusal tests cover initialization and PUT rejection.
5. **Namespace exception:** the legacy unknown-declaration exception accepts only one namespaced
   interface redefinition with a `[FINAL] REDEFINITION` tail. Extra parameters/statements/chains
   refuse. Handler tests prove signature replacement and public-visibility no-op. Contrary to the
   review's predicted acceptance, deleting this grammar-unsupported body still refuses in the
   implementation-boundary check; the test records that limitation and its complete-source remedy.
   Pinned metadata surgery continues to refuse this unsupported syntax.
6. **Bare CR:** structural parsers refuse bare carriage returns instead of interpreting different
   text from what the splice saves. CRLF remains supported; method replacement tests include the
   comment/CR boundary case. Whole-source updates continue to rely on their exact read-back.
7. **Parser limitation:** unsupported declaration replacements explicitly name the installed
   boundary parser and suggest a complete source update. They do not silently widen the grammar.
8. **Handler coverage:** direct-interface add/delete/definition edits, namespaced owner URLs and
   classic punctuation now run through the handler. Adding before a split ENDCLASS statement uses
   the statement's start row, preserving its separate terminating period. Whole-include cancellation
   tests cover existing source, pre-initialization cancellation and cancellation after creation.

Cancellation tests exposed an additional reporting issue: a known pre-write cancellation used an
uncertain-write state. Checks now run before those transitions. If initialization succeeded but
the following PUT was prevented, the result is `created-include-source-not-saved` with
`initialized: true` and no unverified source hash.

## Creation and deletion convergence

The existing CLAS/INTF create and delete operations now enter through the ordinary
`writeActionCreate` and `writeActionDelete` handlers. Creation shares the XML builder, quality
precheck, native `createObject` POST and source-save dispatch. Explicit profile adapters retain
legacy recording/quality/cache behavior and the pinned package, recording, owner lock, exact
read-back and cleanup requirements. Pinned creation freshly reads the native initial source
under the new owner's lock before saving. No caller source hash is required for creation.

Creation state is recorded separately from saving. A rejected POST remains unchanged; an uncertain
POST is not retried; a created owner whose initial read, syntax check, PUT or read-back fails is
reported as partial or uncertain without an unverified hash. Cancellation before PUT preserves
the confirmed creation state. PP creation continues to omit a caller-selected responsible user.
Fourteen native HTTP-mock cases execute these transitions through the shared handler.

Deletion selects the existing strict native deletion adapter from the shared action. It retains
its package/recording rechecks, owning lock, typed absence read-back and bounded cleanup. The
legacy action retains its original text-pool/CDS prechecks and error/cleanup behavior. At that checkpoint this did not admit PROG/INCL creation/deletion. The later expansion below preserves
their separate ownership and text-pool rules. The duplicate pinned CRUD orchestrator is removed; native adapters remain
explicit about their legacy and pinned policies.

## Evidence limits and next work

New tests exercise actual shared handler/native HTTP boundaries, exact saved source and neighbor
preservation, stale hashes, malformed input, package/recording drift, no replay, read-back mismatch,
cleanup errors, parent-request selection, quality warnings and defensive synthetic-config narrowing. Public source/XML
fixtures are authored examples, not exports of SAP implementations. Earlier read-only native
class receipts and historical PP runs retain their original revision scope. The 59 harness
simulations do not qualify these new class/procedural operations. Fresh two-writer PP evidence,
transportable-object coverage and remaining built-in adapters are required before merge readiness.


## Third Claude review and follow-up

Actual Claude Code **Opus 5.5, requested effort max** reviewed immutable `10b131e9d861335bd2d4195b3f322dc279db5cbc`.
Its [verbatim report](broader-pinned-pp-writes/claude-source-adapters-review-20261101.md)
returned no High, three Medium and six Low findings. It independently passed 434 files/11,860 tests,
three TypeScript projects, size/schema checks and 59 existing harness simulations. Its first and
last snapshot checks and the author recheck verified 4,251 files unchanged. It executed no individual
failing reproduction. The launcher's recorded `--effort max` and actual model initialization are
separate from the reviewer's inability to introspect its effort setting. The newer `201054e48`
create/delete convergence and the changes below require another review.

- **Method-body false refusals:** boundary checks use AST statement kinds, with the keyword fallback
  restricted to Unknown statements. Valid keyword-named assignments, casts and class/interface LOAD
  statements pass. Parser and both legacy/pinned handler tests retain the neighboring method and
  prove the sole PUT occurs under the owning lock. Escape cases continue to refuse.
- **Chained/composite interfaces:** declaration names come from AST expressions, avoiding comma names.
  Definition edits check removal of an interface actually present before the edit. An unchanged
  composite-interface declaration no longer claims its inherited interface was removed. This fixes
  shared diff behavior; pinned native structure verification still refuses inherited-interface
  shapes it cannot cross-check against the local source. No new native composite-interface capture
  or relaxation of that evidence boundary is claimed.
- **Standalone ownership:** generated `L*` include names and `SAPL*` program/include names refuse before SAP.
  Both before locking and under the lock, canonical program/include metadata must identify the exact
  name, matching PROG/P or PROG/I root and an independent DEVC/K package. Program kind must be
  executableProgram, subroutinePool or modulePool. Container and function-group context evidence
  refuses. The later follow-up uses this single validated native package for policy checks instead of fetching the same metadata through a second parser. Tests cover wrong root/name/type, missing
  package, group/container aliases and identity drift under the lock.
- **Namespaced headers:** the inventory accepts only the exact three-token METHOD header with a
  namespaced interface RHS when the installed grammar labels it Unknown. Reads and method edits
  retain its boundaries; unrelated methods remain accessible. Malformed boundaries have explicit
  refusal tests and direct readers to complete SAPRead source. Default main-source lint still rejects this parser-unknown header; full handler tests cover that refusal. Reads and pure splicing are supported, while include edits retain their existing lint policy. Native class-metadata surgery keeps
  its separate stricter evidence requirements, including the previously documented delete limitation.
- **Declaration-only resolution:** only implementations participate in ambiguity and exact/fuzzy
  selection. Abstract declarations no longer hide the sole actual body or interface match;
  declarations remain available for not-found guidance. Dedicated tests preserve duplicate-body refusal.
- **Procedural replacements:** private end-token columns now reject program-level statements hidden
  after ENDFORM/ENDMODULE, including misleading comments. One trailing comment is allowed; statements
  before it are not. Tests exercise replacement and insertion for both unit kinds.
- **Abstract symmetry:** explicit interface ABSTRACT METHODS/ALL METHODS ABSTRACT changes in either
  direction require a complete source update. add_method derives abstractness from its declaration
  and rejects an explicitly contradictory flag. These are structural checks, not full ABAP semantic
  validation; activation remains authoritative.
- **Evidence/test scope:** defensive BTP fixtures are labeled accordingly. Procedural tests execute
  actual configured lint, cancellation before SAP and after the locked read, and SAPRead-editable
  hash handoff. The initial invoke-level assertions ran outside mocked fetch; the fifth review identified remaining in-fetch assertions, corrected in the follow-up below. The INCL fixture now uses the native abapInclude shape.

Author review also found that deletion ignored a failed session close after a successful unlock.
The result now preserves the confirmed deletion or primary failure, adds the cleanup phase and
returns an error. Two native HTTP-mock tests prove close-only failure and a combined DELETE rejection,
with one DELETE and one close attempt.

Read-only [metadata receipts](broader-pinned-pp-writes/program-owner-shapes-readonly-20261101.json)
show RSPFPAR/executableProgram, SAPMSSY0/subroutinePool, SAPMS38M and SAPMSYST/modulePool with own
packages. RSDBCOM4 is a package-owning abapInclude. LSDIFRUNTIMEUXX is exposed through the general
include URL as PROG/I but has a FUGR/I context and no own package. This confirms why a URL/type/name
check alone cannot establish standalone ownership; it does not prove that SAP would accept a write
to that alias. Metadata only was read; no permissions or deployed configuration changed.


The [reproducible local sample](broader-pinned-pp-writes/source-parse-benchmark-20261101.json)
uses an authored program with 100, 1,000 and 5,000 independent FORM blocks, edits one block and
runs configured lint. It records exact source/script hashes, sizes, timings and process RSS. It is
one increasing-size run on this machine, without SAP/network or concurrent requests; it does not
establish deployment latency or a memory/concurrency ceiling. All three samples passed lint.


## Standalone program/include CRUD and activation

The draft now admits PROG/INCL creation through the shared native source-creation handler and
owner activation through the existing preaudit engine. Native owner identity and independent
package are checked again at activation confirmation. Programs may expand only to their own
native text pool; its exact identity is checked before confirmation and its active state afterward.
A later verification failure preserves uncertainty and warns that SAP already reported activation.
Includes activate only the selected owner; referencing programs and their pools are not selected.

Deletion shares the strict native owner adapter and its typed absence check. Programs additionally
hold the pool lock in the same stateful session, verify that the exact pool is active, and recheck
owner/package/recording and pool-lock locality before DELETE. The new additional-lock coordinator
never opens a second session. Its bounded cleanup survives operation cancellation and reports
unlock/close failures without erasing a confirmed deletion or the primary failure. Legacy text-pool
cleanup behavior is unchanged. No automatic pool activation or DELETE retry is added.

Native HTTP-mock tests cover creation, activation expansion/refusals, owner/package drift,
unconfirmed pool activation, same-session locks, inactive-pool refusal, cancellation, uncertain
DELETE, typed absence and cleanup failure. These are authored fixtures, not live protocol captures.
Fresh two-writer PP qualification of these bytes remains required.


## Fourth Claude review and follow-up

Actual Claude Code **Opus 5.5**, launched with **effort max**, reviewed immutable `7af4069ae6332e68c5fd130085806849bd5145a0`.
The [verbatim report](broader-pinned-pp-writes/claude-source-review-fixes-20261101.md) has SHA-256
`b135dc2e4ee8be390dd0146227806098eb1ad3ba058440111113255b307aa714`.
It found no High, two Medium and ten Low issues and requested fixes and review before a live artifact
freeze. It independently passed 435 files/11,928 tests, all three TypeScript projects, size/schema
checks, 59 harness simulations and the source benchmark. First/last reviewer verification and the
author recheck confirmed the same 4,259 files unchanged. The reviewer executed no individual failing
reproduction. Its report records a refused out-of-root Read (no returned data), an oversized read
retried in parts, and the permitted read of its saved test output. Its model initialization and
launcher arguments substantiate model/effort separately from the reviewer's self-report.

The follow-up dispositions are:

1. **Single-use includes:** native PROG/P context URIs may identify the owner or its source/main.
   The unchanged A4H include fixture now executes through mutation dispatch with an authored CTS
   response; array/mixed-context tests check every returned entry and prove no context is followed.
2. **Missing declaration period:** add_method normalizes the clause before deriving abstractness.
   Both routes test a missing period with the flag omitted and explicitly true; neither inserts a body.
3. **Composite-interface removal:** removing any direct interface refuses an unresolved interface
   implementation that the new definition cannot account for. Both routes exercise the case;
   pinned retains its separate native-evidence refusal for an inherited shape it cannot prove.
   Unchanged chained direct interfaces also execute through both handlers.
4. **Signature symmetry:** signature-only edits cannot change ABSTRACT in either direction.
   Handler tests cover concrete and declaration-only abstract methods on both routes.
5. **Program names:** ordinary L-prefixed PROG names, including a namespace, rely on native
   PROG/P/program-kind evidence. L-prefixed includes and SAPL program/include names remain refused.
6. **Malformed replacement boundaries:** Unknown METHOD/ENDMETHOD-shaped statements refuse,
   alongside the existing AST checks; valid keyword-named assignments remain covered.
7. **Declaration-only guidance:** qualified class selectors and unique interface suffixes now
   retain the declaration-only explanation through extractMethod, not just its message helper.
8. **Parser/lint limits:** full handler tests record that default main-source lint blocks the
   parser-unknown namespaced RHS header even though inventory and pure splice accept its boundary.
   No lint exemption is introduced. All inventory parse failures now point to complete SAPRead source.
9. **Public advice:** tool/schema descriptions and docs derive abstractness from the clause;
   contradictory flags refuse. Definition-edit recovery points to complete update or atomic
   add/delete actions. Tool-definition snapshots were regenerated for these intentional text changes.
10. **Owner XML and cost:** native program/include XML is validated and DOCTYPE is refused before
    parsing. The verified package is authorized directly, removing the duplicate resolver GET/parser.
    Existing-source mutation tests assert one owner GET before and one under the lock; there is no
    longer a second package-parser disagreement branch to test.
11. **Cleanup:** close-only failures carry cleanupFailed consistently. Wording does not assert
    an unlock happened when no lock was acquired. Confirmed source/deletion state remains visible.
12. **Creation tests:** lifecycle assertions moved outside the mock fetch. Failure rows verify
    phases/statuses; added cases execute recording drift, pre-POST cancellation, request binding on
    POST/PUT, actual abaplint, and an actual inline /checkruns request under the owning lock.

These corrections and the new program CRUD/activation implementation need another immutable
independent review and fresh PP qualification. They do not change the scope of earlier live evidence.


Author validation after these corrections: **437 files / 11,991 unit tests**, all three TypeScript
projects, build, lint (four existing informational diagnostics), 135-entry policy validation,
strict documentation, the 890-file size ratchet/schema budgets, and 59 existing harness simulations
passed. Five tool-definition snapshots changed only the intentional abstract-method guidance.
The final type-only test-helper annotation was checked by all three TypeScript projects.


## Fifth Claude review and follow-up

Actual Claude Code **Opus 5.5**, launched with **effort max**, reviewed immutable
`d0993a04939ada38376808a96883a6b28cbaec26`.
The [verbatim report](broader-pinned-pp-writes/claude-program-lifecycle-review-20261101.md) has SHA-256
`0dec00e3f64b648788e61b8e15fa230af07771a91e5e2bf8c9ffd6b88f1e0f4f`.
It found no High, two Medium and eight Low issues. Reviewer and author verification confirmed the
same 4,320 files unchanged; the reviewer independently passed 437 files/11,991 tests, all three
TypeScript projects, size/schema checks, 59 historical harness simulations and the source benchmark.
It executed no individual failing reproductions. Its report records an unallowed, read-only in-tree
`ls -la review-input`, refused wrong-root reads/searches, an oversized read retried in parts, and
permitted reads of saved test output. Model initialization and launcher arguments independently
substantiate model and requested effort. The review was a development checkpoint, not acceptance.

Follow-up dispositions (new code remains subject to independent review and live qualification):

1. **Namespace URI spelling:** normalize only the hex case of `%2f`. Owner and pool spelling tests
   include both hex cases, uppercase native pool names, namespaced CLAS/INTF/PROG/INCL, duplicates,
   pool-only and excessive reference lists. Other percent-encoded name characters still refuse.
2. **Removed-resource cleanup:** the deletion adapter supplies a proof only after successful DELETE
   and typed owner-absence readback. A typed not-found on owner/pool UNLOCK can then be resolved only
   by that owning session's confirmed close. Generic 404, unknown deletion, failed close and other
   unlock errors remain failures and name their URI/status. Native pool/owner UNLOCK statuses still
   need recording in the next live qualification; authored fixtures are not proof of SAP's behavior.
3. **Pool metadata:** use the observed native metadata Accept, a bounded namespace-aware XML reader,
   DOCTYPE/malformed/ambiguous identity refusal, exact owner/type/state and optional package equality
   against the independently verified owner. [Read-only evidence](2026-11-01-text-pool-active-version.md)
   records the interface constant and a successful native metadata GET.
4. **Preaudit identity:** native namespace-bound name/type/deleted fields reach the validator.
   Mismatches and deletion drafts refuse before confirmation. Conflicting namespace attributes
   cannot overwrite identity or deletion evidence. Native activation execution evidence also checks
   the checklist namespace and unambiguous execution flag; legacy parsing remains unchanged.
5. **Activation reporting/cost:** report the actual owner-only or pool-expanded scope, read PROG
   pool state after every native result, retain native results if later verification fails, and
   give `success:false` an explicit uncertain state. Save guidance no longer claims standalone
   includes activate with a program. Initial owner/recording validation now runs once through the
   engine callback, then refreshes after a preaudit prompt before confirmation.
6. **Deletion guidance:** inactive drafts point to review/activation in ADT, not an unavailable
   pinned REPT action. Known missing textelements service gives a direct safety reason, and the
   tested NW 7.50 limitation is documented. Deletion never activates drafts automatically.
7. **Include consumers:** activation/deletion return native context count and returned consumer
   packages, without authorizing or following them. Docs/results warn of effects on consumers;
   this is neither a complete where-used inventory nor a new dependency-package gate.
8. **Owner evidence:** a shared bounded XML reader preserves namespace bindings and refuses
   ambiguous attributes. Program/include roots, packages and contexts use their actual namespaces;
   SAPL contexts, including namespaced SAPL names, refuse even when typed PROG/P.
9. **Tests:** remaining class/procedural mock-fetch assertions became explicit unexpected-request
   records asserted after dispatch. Program/create mocks now use native prefixed identities and all
   affected mocks assert no unexpected request. Added creation identity proof under lock,
   PROG/INCL failure and transportable rows, transportable deletion, pool CTS mismatch and lost/refused
   LOCK responses. Valid-owner DOCTYPE and isolated context-URI negatives exercise their intended guards.
10. **Documentation:** correct the earlier test claim, link BTP setup to the actual capability
    matrix, document definition/signature ABSTRACT and interface refusals, and describe owner checks
    as mutation checks rather than edit-only checks.

A separate text-part adapter in this follow-up shares the ordinary replacement engine and owning
session lifecycle. Its explicit active-content proof and remaining PP requirements are recorded in
[the text-pool note](2026-11-01-text-pool-active-version.md). Earlier live run `77e41fdcd` does not
qualify any of these new bytes. PR #1142 stays draft and FEAT-93 stays open.

Author validation for the fifth-review follow-up and text adapter: **441 files / 12,136 unit tests**,
all three TypeScript projects, build, lint (four existing informational diagnostics), the 135-entry
policy check, strict docs, the 899-file size ratchet/schema budgets, and 59 historical harness
simulations passed. The initial full run caught the action-list expectation missing the intentionally
admitted text operation; its correction and stronger refusal assertions are included in the passing
full run. No new live deployment or mutation qualification is claimed.
