# Text-pool active-version verification

PR #1142 requires an active-version part read that matches the saved readback, as well as exact
native pool identity and active metadata. This note records the read-only A4H/001 investigation;
it does not qualify a pinned write implementation.

## Native evidence

On 2026-11-01, HTTPS GETs against the existing `RSPFPAR` symbols resource, using the native
`application/vnd.sap.adt.textelements.symbols.v1` Accept header and `Cache-Control: no-cache`,
returned HTTP 200 for `version=active`, `version=inactive`, and the negative control
`version=invalid`. All three bodies were 1,610 UTF-8 bytes with SHA-256
`59e0dda0ad04aec91b62d1b163eb00b8e343e7633583c89917486bf2efc82022`.
Identical bodies alone do **not** establish version selection. The invalid value is accepted;
it is not a supported selector or evidence of strict parameter validation.

Bounded native class search located `CL_SEDX_ADT_RES_TEXTELEMENT`. Read-only source inspection
of its main source and local implementation showed that the GET handler reads the version query,
maps it through `CL_ADT_UTILITY=>GET_WB_VERSION`, uses working-area/database fallback when no
version is selected, and passes the selected version to the part reader. The local pool reader
forwards that version to SAP's existing text-pool reader. An inactive request can fall back to
active when the native database has no inactive version. These are observations of the existing
backend implementation, not a new ABAP helper or an RFC invocation by ARC-1.

The private native-source captures have these identities; SAP source is not copied into this repo:

| Native source | UTF-8 bytes | SHA-256 |
| --- | ---: | --- |
| Main | 22,840 | `a7f1ac0893ffc0737b90319ee36b8f82cae16ffaa89ca2bfac5f3d38a93d867d` |
| Local implementations | 19,942 | `2ba13385411055d03002ed43978158bdc0391896acb4aa7b6f079136086b449b` |
| Resource interface | 1,870 | `25fa3041997b1458413698a0d9f79fb0c80178dee4d347035c73472cc7658a90` |

The reads used a client configured with `allowWrites=false`, verified TLS, client 001, bounded
requests and no replay. They changed no SAP object, role, destination or application configuration.
The first diagnostic omitted the HTTP status field; a fresh GET repeated all three variants and
recorded their actual `statusCode` values. A local capture-directory collision was corrected before
that repeat sent any request.

The native interface's `co_content_type-properties_v1` is
`application/vnd.sap.adt.textelements.v1+xml`. An explicit-Accept GET of RSPFPAR pool metadata with
`version=inactive` returned HTTP 200 and that content type, 2,628 UTF-8 bytes, SHA-256
`e7c57820219b3418fd861d07618f4735741f7b0b21ccaa1394dfdb8a5ee863b4`.
Its native textelements root identified RSPFPAR/PROG/PX, active state and package SPFL/DEVC/K.
This supports an explicit metadata Accept instead of discovery's first advertised MIME type.

## Implementation and remaining qualification

The shared part reader now accepts an internal explicit `active` or `inactive` selector. Versioned
reads always bypass caches and fresh verification bodies have a 1 MiB UTF-8 limit. Invalid runtime
selectors refuse locally. Ordinary reads retain their existing URI and headers. This adds no public
SAPRead argument. The separate capability row now admits CLAS symbols and on-prem PROG
symbols/selections/headings, with explicit whole-part source (empty clears), no hash/include fields,
and a 1 MiB UTF-8 input/readback bound. FUGR and direct REPT activation remain outside this adapter.

The shared replacement engine uses a registered legacy or pinned context. Pinned replacement locks
the exact pool in one owning session, refreshes native owner/package/recording and pool evidence,
reads the explicit inactive part, saves once with matching Content-Type/Accept, and checks readback.
After a confirmed unlock, the same session revalidates policy, activates exactly that pool through
a one-use internal grant, then requires active metadata and an explicit active body equal to the
saved readback. Caller-created/cloned options, foreign/stale sessions and grant reuse refuse.
Cleanup has its own bounded owning-session budget and never replays the save or activation.

The selected part replaces the complete part; other text parts are preserved by the save, but their
pending drafts activate with the pool. Owner source is not activated. An already-empty, active CLAS
symbols part is skipped only after explicit active content is also empty; inactive empty pools are
not skipped. Program text saves do not use that no-op rule.

The [earlier native observation](2026-07-02-class-text-symbols-textpool.md) found a PUT with missing
Accept returned 400 after committing its body. This adapter always sends Accept, but does not infer
atomic rejection from an HTTP error: submitted PUT failures remain `text-save-unknown`. The authored
400-after-save test is an injected uncertainty case, not a live failure observed with correct headers.
Other tests cover source/policy/identity refusal, active/inactive content mismatch, preserved pending
parts, cancellation, transport binding, unlock/close uncertainty and unsupported/readonly routes.
These mocks do not qualify native part bodies or PP behavior.

The native implementation supports using an explicit active read for the planned verification,
but controlled evidence is still required: create distinguishable active and inactive fixture
texts, prove the two selectors return the expected different bodies before activation, then prove
the explicit active body equals the saved readback after exact-pool activation. Run that lifecycle
through pinned strict PP with both mapped writers. Do not substitute a default/working-area read
or an active metadata flag for this content comparison. Confirm empty-pool behavior, no-op rules,
never-activated programs, whole-part replacement, and preservation of other pending text parts.

Public [SAP ADT documentation](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/version-2-31)
describes active/inactive source switching in the editor; it is background, not proof of this
text-pool REST contract or of support on other releases.
