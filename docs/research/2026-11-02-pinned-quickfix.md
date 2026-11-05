# Private pinned quickfix delta computation — 2 November 2026

The accepted broader-write plan keeps `SAPDiagnose.apply_quickfix` classified as write-scoped,
while its native operation computes replacement deltas without saving repository source. This
candidate implements that private boundary; it does not add public action admission or another
read companion. The existing `quickfix` evaluation action remains unchanged. Saving a reviewed
proposal still requires the ordinary guarded `SAPWrite` path, including its actual package,
recording, stale-source and activation policies. Delta computation has no fictitious DEVCLASS owner.

## Shared implementation and private policy

A behavior-preserving extraction moves the existing evaluation/application core and legacy parsers
from `adt/devtools.ts` into `adt/quickfix.ts`, retaining its public re-exports. The separate private
profile reuses the same evaluation request, application XML builder, owner-existence guard and exact
proposal POST. Ordinary single-target calls keep their existing interpretation, SAP context headers,
response whitespace, errors, unsupported-evaluation fallback and transport retry policy.
The private HTTP/budget module loads only when that explicit profile is selected; schema/input
helpers have no native HTTP import side effects.

The private internal handler requires enabled strict PP, the selected destination write policy,
matching target/client, effective read and raw write scope, server/client write ceilings and deny
policy. It uses the supplied mapped-user client's transport; it does not create credentials or infer
an SAP username from an IdP name. A registered operation context binds safety and one 60-second
maximum deadline, cancellation, 16 HTTP attempts and a 2 MiB cumulative decoded response allowance,
including errors and CSRF. Auth/CSRF/negotiation/availability replay is disabled. The private row is
outside the public capability matrix, catalogs and dispatcher.

The current profile accepts CLAS/INTF and PROG/INCL source, with the four optional class source
includes. Owner names, encoded namespaces and resource paths are checked together. Absolute URLs,
foreign owners/clients, query/fragment ambiguity, arbitrary suffixes, nested/double encoding and
unknown fields refuse before HTTP. The established provider URI has the exact
`/sap/bc/adt/quickfixes/proposals/providers/<provider>/quickfixes/<proposal>` shape; it is preserved
verbatim. Query-bearing or other proposal paths require further qualification rather than
normalization. Client and language stay in headers on that POST, preserving the
[#993 contract](2026-10-13-quickfix-exact-uri.md).

Each application freshly evaluates the exact supplied source/cursor through the same client.
Exactly one proposal must match the requested URI and opaque state. Native affected-unit references
must agree with the caller's complete supplied context; existing native content must match too.
Affected units currently stay within the selected owner. Class/interface metadata is checked before
evaluation and again before application, using the existing existence guard plus namespace-bound
owner name/type and optional URI validation. It reads owner metadata, not saved source, so unsaved
optional includes remain supported. Program/include evaluation retains the legacy no-existence-check
behavior; the canonical input binds the selected owner, without claiming a repository existence proof.
A concurrent deletion after the last metadata GET remains possible; no lock is claimed.

Source is limited to 256 KiB per unit; state to 64 KiB; at most eight affected units and 512 KiB
combined source/state are accepted. XML-invalid text refuses. Native XML is independently limited to
1 MiB by the shared namespace-aware reader. Only the established unqualified child elements under
namespaced `evaluationResults` and `proposalResult` roots are accepted, with at most 64 proposals or
deltas. Unknown attributes, children, namespaces, interactive/error bodies and ambiguous identities
refuse instead of becoming an empty result. Every delta must identify one supplied unit and a valid,
ordered, non-overlapping range within its supplied text. Replacement whitespace, entities,
numeric-looking text and empty deletion content remain literal; no splice or save occurs. A typed
empty `deltas` collection is a successful empty computation.

Results distinguish computed deltas from refused/unverified computation and always report
`sourceSaved:false`. The handler never sends a PUT, DELETE, lock, activation or source-create request.
It does not return opaque state, session/auth headers or raw SAP error bodies. A failure does not
retry application or claim an automatic rollback.

## Offline evidence and limits

The extraction passed all 520 unit files / 14,367 tests, source/scripts/tests typechecking, build,
lint, policy and staged file/schema sizes before its separate commit. Candidate tests use the real
shared HTTP client with a mocked upstream, plus existing single-target quickfix tests. Author logs,
final source revision and full gate counts are retained in
`~/.local/state/arc1-review/pr1142-quickfix-author1/result.md`.

An initial candidate test run exposed an eager private-budget import that loaded undici before the
legacy mock. It caused bounded failed DNS attempts for the reserved synthetic host `sap.test`;
no SAP endpoint or credentials were involved. The private profile now loads lazily, and the regression
suites exercise both profiles. This incident is retained in the author evidence; it is not described
as a run with no network attempts. No native SAP execution, credential access, deployment or BTP
change was performed.

## Native qualification still required

Synthetic responses establish refusal and preservation behavior, not native support. Before any
public admission, independently review the source and bind a separately reviewed native experiment
to that revision. Retain sanitized native documents and no-save proof, including successful mapped
identities and failures; older direct-auth #993 evidence is useful context, not current pinned proof.

| Scenario | Required native proof | If it fails |
| --- | --- | --- |
| QFX-1 | Fresh evaluation and application on each supported SAP profile through the actual pinned PP route; exact proposal URI, client/language headers, root/namespace/child shape, opaque-state stability and owner identity. Two different mapped developers must succeed, with read-only/Basic/aggregate/Copilot, missing-scope/grant and deny-action controls. | Keep the public action closed; narrow the native profile if necessary. |
| QFX-2 | Declaration deltas preserve spaces/entities/numeric-looking and empty text, address the exact supplied source/ranges, and leave independently read saved/default/active source unchanged. Include an inactive owner and unsaved class include. No source lock/save/activation is submitted. | Keep the action closed or refuse the unsupported shape; do not add a save fallback. |
| QFX-3 | Same-owner affected-unit context is stable across evaluation/application; stale state/source/cursor and mismatched units refuse. Qualify whether any provider has unstable evaluation state, query-bearing proposal URIs, cross-owner units or interactive flows. | Keep these contracts explicitly unsupported; do not accept generic URLs or invent state rebinding. |
| QFX-4 | No replay under native denial/lost response/cancellation/deadline; bounded complete documents and honest unverified computation. Restore all disposable fixtures and independently prove unchanged saved source after every attempt. | Stop, retain the failed evidence and review the native contract before retrying. |

After these pass, admit the capability row, exact schemas/invocation surface and operator guidance
together, with explicit delta-only wording. FEAT-93 remains open for this review, native/PP evidence
and the unsupported source/provider/multi-owner contracts. This candidate is not whole-PR acceptance.
