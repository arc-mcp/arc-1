# Private FLP creation using native duplicate protection

This offline candidate restores catalog/group creation only through the private pinned qualification
entry. Public capability admission and the independent customizing-recording/request-selection
lock remain closed. No FLP mutation or Principal Propagation qualification ran for this change.
Codex continued after the user-authorized Claude limit fallback.

## Read errors do not prove absence

Target-bound native GET evidence from the intended HTTPS origin/client includes service metadata,
a known catalog, missing catalog/group keys and a missing entity set. The missing keys return
`/UI2/FND/604` with `/UI2/`, `PAGE_BUILDER_CUST`, service version `0001` and component
`CA-FLP-ABA`; the missing entity set has a different error. Nevertheless, the active native source
shows that catalog-provider and page-cache errors can be discarded before the same `604` result.
A positive other-key read does not rule out a failed lookup of the requested key.

The sanitized fixture `tests/fixtures/flp/cust-resource-lookup-604.json` preserves only the native
code, message, application identity and error detail. It excludes transaction IDs, timestamps,
operator instructions, URLs and personal identifiers. Its source body SHA-256 is
`0b4378c25b34eef569751fd45731ff49d218a65d2a690dac2e2d39dfa559e1b3`.
It is GET evidence, never a native POST fixture or proof of absence.

`isUnresolvedFlpLookup` recognizes only this bounded envelope from the exact keyed request. It
returns **unknown lookup**, not absence. Generic/HTML/malformed errors, other statuses, paths,
services, versions, components or contradictory details refuse before creation. Existing successful
keyed reads also refuse, including delivered/read-only content. Collection errors never mean empty.
Post-DELETE `604` still leaves deletion unconfirmed.

## The separate native create-only contract

The decisive active-source chain is:

1. Catalog creation reaches the standard catalog-page provider, then the page-config helper.
   The helper invokes CREATE for Page and PageConfig with the exact key. Group creation uses the
   Page accessor directly. Both paths reach the shared Web Dynpro create flow.
2. The accessor marks CREATE as must-not-exist and checks native existence before creating.
3. The concrete CUST tool inherits generic `IF_WD_CFG_TOOL~CREATE`; that method calls the base
   CREATE implementation. The base first checks authority, obtains the native enqueue and checks
   changeability. It then checks existence under that lock. An existing key releases the lock and
   raises `config_exists` **before** clearing or preparing content.
4. The base modifier requires both a held lock and loaded data. The separate component-interface
   wrapper's caught runtime exception therefore does not grant permission to edit an existing
   object after the duplicate branch released its lock.

Relevant private source fingerprints (raw SAP source is not committed):

| Native source | SHA-256 | Relevant evidence |
| --- | --- | --- |
| `/UI2/CL_EDM_DATA_ACCESSOR` | `c6101dcb68622c90f5a62f99db7adff1f17e9ea7330c18041575b7ac2a89fe23` | CREATE must-not-exist classification |
| `/UI2/CL_EDM_DA_WD_CONFIG` | `307779f1db11d0fc8fd57e8e86269faeb0d28479dbad4b3b175030dee5dfb107` | Existence guard and native create dispatch |
| `/UI2/CL_CAT_PROV_PAGES` | `c5fb5f4992f7cddc3d90581c308f97f4b7ce8b5cfae77eeb0c762b64d7cfe28b` | Standard catalog create delegation and 35-character domain bound |
| `/UI2/CL_WDR_CFG_CHG_TOOL_COCU` | `67f85fa23322efaaa0e482f5d37c7c308d1bb7aca8c7cf926e665f385a8c9dc9` | Concrete CUST subclass; distinct component-interface wrapper |
| `/UI2/CL_WDR_CFG_CHG_TOOL` | `2720dbefa9f06662a7a458ff8a8740ac24c0cdf5d214fc22a3d6659042316fb1` | Generic interface delegates to base CREATE |
| `/UI2/CL_WDR_CFG_CHG_TOOL_BASE` | `4c69d0c90680b5f6a87db060cc016db385b26cdc7cb73faf7291572c31654200` | CREATE 499–550; existence 626–645; modifier 662–665; enqueue/changeability/authority |

The earlier private assessment correctly rejected the error-envelope absence inference and stopped
at the then-missing generic create implementation. It remains preserved unchanged in the private
review evidence. The two later inheritance captures close that specific source gap; they do not
change the conclusion about `604` or constitute native mutation qualification.

## Implementation and outcomes

The private adapter calls the existing `createCatalog`/`createGroup` helpers with an explicit bounded
profile. Legacy callers omit it and keep their original payloads, parsing and request options. The
shared request context retains its target binding, deadline, cancellation, cumulative budget when
present, and no-replay policy. Each of the three possible responses is additionally bounded at
256 KiB before parsing; no continuation or arbitrary URL is followed. The native creation limits
apply to new catalog domain IDs (35) and group IDs (70), without restricting unrelated existing IDs.

After the recognized unresolved lookup, the adapter reports `priorExistence: unknown` and submits
one native CREATE. It relies on the locked native duplicate check, not an inferred missing record.
Both the POST response and the fresh keyed GET must match the exact requested identity/title and
native ownership fields. Readback also requires `CUSTOMIZING` scope and explicit writable flags;
groups must belong to the standard group container and not be catalog pages.

All failures after submission remain `create-unconfirmed`, including duplicate-looking or other
4xx responses. Native authority/enqueue/CTS work precedes the final existence check, and catalog
creation has Page and PageConfig steps. A failed request is not an atomic no-effect guarantee.
There is no automatic replay, rollback, foreign-entity probe or speculative cleanup. Successful
readback does not erase a failed POST: the adapter does not perform that recovery path.

## Verification and remaining gap

Offline regressions cover both successes, known-existing keys, exact error/application/path
boundaries, foreign or incomplete ownership, response limits, explicit native ID lengths,
cancellation, partial outcomes for every supported 4xx rejection status, server/network loss,
unchanged deletion ambiguity and legacy helpers. Real handler/HTTP-client mocks prove both private
creates and that a CSRF challenge does not replay a submitted POST. Existing dispatch/scope/deny
and public-recording-lock tests remain in force. All native POST/readback transitions are synthetic
unit evidence, clearly separate from the captured GET error.

Before public admission: qualify the create/duplicate/error
contracts on strictly owned disposable native fixtures, establish cleanup including group cleanup,
verify customizing recording and pre-mutation allowed request selection, then current-code PP
identity/scopes/denials. A deliberately repeated duplicate test on a confirmed owned fixture is a
separate test operation, never a retry of an uncertain operation. Catalog deletion still lacks an
authoritative absence discriminator. Unrestricted request-policy alternatives may be researched
separately; this change neither claims one qualified nor invents a transport header.

Roadmap impact: FEAT-93 now distinguishes private native create-only implementation from unresolved
delete verification, recording/request selection, native/PP qualification and public admission.

## Independently reviewed private integration

The [verbatim independent review](2026-11-03-pinned-flp-create-review1-verbatim.md) approves
private integration of `9a80a805fa3e1103bcb679d9f8a4e98bcae9ff1e`, with no actionable findings.
It records 272 existing tests across eight suites, 22 additional HTTP-client probes using synthetic
fetch responses, unchanged native source evidence and unchanged review snapshot. These are offline
checks, not native/PP qualification. Integration at `46d9da8b7` passes the full **542-file / 15,626-test**
unit suite. All three TypeScript projects, build, lint, policy, file/schema budgets and strict
documentation checks also pass. Integrated source/test bytes match the reviewed candidate.
Public admission, native lifecycle/cleanup and customizing recording remain open.
