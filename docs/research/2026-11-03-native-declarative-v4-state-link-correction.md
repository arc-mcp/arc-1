# V4 correction: exact owned relative state alternatives

The [first independent V4 review](2026-11-03-native-declarative-v4-review1-verbatim.md) found one P2
in candidate `c362ed42e2b9fbb90d0d22f1fc303b52e2bef87d`: the shared pure helper accepted the exact
same-owner relative metadata alternative only for DDLS. DCLS, DDLX, BDEF and SRVD driver probes
therefore refused after an acknowledged update PUT, preserving the owner and its dependency.
The preservation was correct; the family restriction on the literal identity spelling was not.

The immutable report is retained verbatim; its SHA256 is
`28523b28a26c25291179b487b776560b5c4f647d979e84242f5432d44977aa4d`.
The original external eight-probe source and failure log remain unchanged, with SHA256
`d826289f2cc0e1d9118b23d0a013f45f0e6ca0bc194b35d0883c5e4ffa449269` and
`4afe8c067a5f082e58418dba5ef9de56ea51b98f16a47084291c1b643690ce10`, respectively.

## F1 disposition and preserved boundaries

`pinnedDeclarativeStateLinkVersion` now applies the same exact owned metadata alternative test
independently of the supported declarative family. The existing typed call signature remains for
caller compatibility; native type/root/name/package validation still precedes the helper in both
the production activation reader and shared qualification reader. The existing canonical own-source
alternative remains unchanged. The relative spelling must match the supplied canonical owner's
leaf byte for byte and contain only explicit lowercase `version=active` or `version=inactive`.
There is no URL parsing/resolution, new normalization, arbitrary read target or additional native request.

Missing/unknown/encoded versions, foreign owners/origins, traversal, encoded owner substitutions,
extra query data and fragments still refuse. Parent readers still reject duplicate alternatives
and active verification with an inactive alternative. Source bytes, default/active consistency,
package/recording checks, preaudit references, owning-session cleanup and public closure are unchanged.
The BDEF mock `./<name>/source/main` without a version remains refused.

**Evidence distinction:** only the original view DDLS spelling has retained native evidence from
v3. The four additional family shapes and namespace controls are synthetic lexical-identity tests,
not observations of SAP responses or native family qualification. The v4 fixed root remains absent;
no prepared intent, prerequisite, claim or native phase needs replacement. Historical claims,
receipts, journals and source revisions remain unchanged.

## Offline verification and remaining work

Before the implementation change, committed-path regressions failed for the four families in the
pure helper, production activation and real shared driver. The corrected candidate passes those
same cases. Production negatives cover every family; real-driver positives complete the six-owner
create/activate/update/activate/reverse-delete graph, while malformed alternatives and remaining
inactive alternatives preserve truthful partial outcomes and dependencies. The reviewer probe was
replayed without semantic edits, changing only its absolute import prefix to the candidate checkout.

The focused test set includes declarative owner/source/activation/workflow/transport/evidence,
recovery, v4 history/phase boundaries and shared mutation compatibility. Static checks cover all
three TypeScript projects, build, lint, policy, staged source/schema sizes and strict documentation.
These are offline mocked checks only. The correction needs independent exact-source review before
any v4 phase; native compilation/normalization, full lifecycle, PP and public admission remain open.
