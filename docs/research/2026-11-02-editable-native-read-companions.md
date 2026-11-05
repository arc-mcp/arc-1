# Editable native read companions

Date: 2 November 2026. Base: `6fa67b75e`. This implementation is offline only. It provides ordinary
public reads for the preconditions used by the private DDIC/server-driven and service-binding
adapters; it does not admit their writes, qualify a native lifecycle, or establish whole-PR readiness.

## Contract

`SAPRead(format="editable")` now supports DOMA, DTEL, TTYP, ENQU, MSAG, TABL/DT/DS/DTT/DTI,
the server-driven registry and SRVB alongside the unchanged text-source format. TABL aliases retain
normal read normalization; a fresh exact native search resolves DT versus DS, and owner metadata
must agree. There is no 404-based collection fallback. Technical settings and indexes retain their
native parent-table identity/package agreement checks.

Metadata-only reads return the exact native XML and the writer's canonical `metadataHash`, plus
selected identity, actual native package, requested view and observed native version. Source-backed
reads add the exact source, its existing SHA-256, the addressed source URI and requested source view.
They compare full namespace-bound owner metadata before and after the source GET, because the
DDIC writer's hash intentionally omits version, change markers and state-alternative links. A
changing native version, alternative, identity, package or other metadata refuses the snapshot.
This remains a sequence of observations, not an atomic snapshot or lock reservation.

Views match the existing private precondition read: explicit inactive metadata for the five metadata
families and technical settings; explicit inactive metadata/source for secondary indexes; default
developer views for table sources, other server-driven sources and bindings. The root's observed
`active`/`inactive`/`new` value is returned separately. An active fallback is not labelled a draft,
and a source response is not assigned a version merely from the requested view.

`readDdicEvidence` and `readBindingDocument` perform read-operation, namespace and native identity
checks without write-package authorization. Existing `readPinnedDdicEvidence` and
`readPinnedBinding` wrap those readers and unconditionally retain actual-package checks. There is
no bypass flag. Ordinary reads remain scoped/audited by the existing dispatch, use the selected
client's identity, bypass caches, and require no write grants. Each native read call has a shared
60-second deadline, cancellation signal, 16-attempt allowance and 8 MiB response budget; XML remains
limited to 1 MiB and source to 4 MiB. Errors propagate, including native 404s; JSON source must parse.

Public write schemas and capability rows remain unchanged. Public SAPWrite/SAPActivate refuse a
raw `expectedMetadataHash` before Zod can strip an unknown field and cause an unguarded legacy
mutation. Internal private contexts continue to validate their own metadata preconditions. The
existing text-source `expectedSourceHash` behavior and editable argument refusals remain intact.

## Evidence and remaining work

Tests feed real public reader results into the private metadata, table, index, server-driven and
binding writers. They include stale metadata/source, actual namespace/identity/version validation,
active fallback, source-read metadata drift, read-only configurations outside both write-package
lists, retained write-wrapper refusals, cache bypass, read scopes/deny actions, malformed responses,
response bounds, cancellation and public unsupported-guard refusal. These are controlled offline
tests, not claims about a live SAP system.

The native shapes and canonicalization are inherited from the
[DDIC/server-driven candidate](2026-11-02-pinned-ddic-server-driven.md), its
[review corrections](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-pinned-ddic-review-followup.md), and the
[package/API/service-binding candidate](2026-11-02-pinned-package-api-publication.md).
Fresh native read qualification still needs release-specific evidence that each requested view
returns the expected owner and exposes saved/draft state, including another user's draft, active
fallback, service-binding v1/v2 compatibility and the source/metadata view relationship. No missing
or unknown native shape is accepted as evidence of absence or write permission.

FEAT-93's missing public read-companion implementation is narrowed by this change. Independent
review, native read/write contract qualification, current-revision two-writer PP, transportable
flows, write admission/catalog/schema review and the broader PR acceptance remain open.

## Author validation

Node 22.21.1: focused round-trip suites pass 354 tests in six files; the final full suite passes
14,401 tests in 521 files. Source/scripts/tests typecheck, build, lint, policy validation, staged
file/schema budgets (1,034 source/test files) and strict MkDocs pass. Lint retains three existing
informational suggestions. Seven tool-definition snapshots change only the format description;
no type enum, input schema or write capability row changes.

The initial full run exposed an import-order regression: importing the new native reader through
the schema's pure source-precondition helper initialized HTTP before three test files registered
their mock. Those tests made failed DNS attempts to the dummy host `sap` (`ENOTFOUND`), with no
successful native/SAP connection. Loading the new reader only at invocation restores the lightweight
schema/precondition graph. The affected suites and new reader suite then pass 108 tests, followed
by the successful full run above. Logs, the initial failure and the final results are retained in
`~/.local/state/arc1-review/pr1142-editable-reads-author1/`.

## ENHO/SKTD read extension

The [ENHO/SKTD companion](2026-11-02-enhancement-editable-reads.md) adds ordinary read-scope
access to the complete native document and matching private-writer metadata hash. It keeps
the existing lazy import boundary and uses no write-package grants. Private document write
review, native qualification and public admission remain independent gates.
