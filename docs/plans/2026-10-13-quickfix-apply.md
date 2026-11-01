# Quick-fix application (#993)

Reproduced on 8.16 with an active disposable class and an unsaved undefined variable.
Evaluation returned six proposals; applying the declaration proposal dumped in
`CL_ART_QUICKFIX_PROVIDER=>APPLY`. Its exact-URI lookup receives the complete request
URI from `CL_QUICKFIX_ADT_HELPER`, including ARC-1's added SAP query parameters.
Moving client/language to headers made the unchanged XML request return a delta.
The saved class stayed unchanged. A second defect trims leading newlines/indentation
from the returned replacement text.

Plan:
1. For proposal POSTs only, send configured SAP client/language in headers, retain
   the existing SAML-disable header, and leave the supplied proposal URI unchanged.
   CSRF bootstrap and other ADT calls keep their existing URL parameters.
2. Preserve XML whitespace for quick-fix evaluation state, affected source units,
   and returned deltas. Reuse the existing whitespace-preserving XML parser.
3. Cover wire URLs/headers, CSRF retry, configured client, and exact delta text with
   regression tests. Run declaration evaluation/application on available systems,
   verify no implicit save, and syntax-check a usable returned edit.
4. Correct the older blanket advice that all refactoring-provider proposals fail.
   SAP's proposals can still need review or additional input; do not invent a
   general interactive-refactoring engine or automatically save returned edits.

Plan review: keep the change in transport request construction and the existing
quick-fix XML consumers. No new public option, action, retry loop, or auth fallback.
The configured client remains explicit, using SAP's documented header alternative.
FEAT-05 still covers broader rename/extract workflows; update its evidence only.

Follow-up: evaluation of a nonexistent class or interface also dumps on 8.16.
`CL_ART_CONTRIB_SCAN_RESULT` dereferences an unbound class/interface scan result.
An absent program can return proposals, so a generic existence requirement would
break that supported case.

1. Before class/interface evaluation or application, GET the owning object's metadata using the
   actual source URI, including for class-local includes. Validate the path before
   the GET. Leave unsaved source and inactive owners eligible; do not use HEAD,
   which returns 400 on this system even for existing sources.
2. Propagate metadata failures; add a concise missing-owner hint to 404 errors.
   Keep this outside the evaluation endpoint's unsupported-service fallback.
3. Test missing owners, URI overrides/namespaces, path rejection, failure handling,
   and minimal errors. Live-check missing, inactive and optional-include cases on
   750, 758, 816 and BTP, with disposable objects and cleanup.

Plan review: one metadata read per OO quick-fix request, using existing path validation
and error hints. No cache, new setting, active-version requirement, source save,
or retry. The metadata check cannot prevent a concurrent deletion after it succeeds.
Final review exposed the same dump when applying a proposal after its owner was
deleted; independently reproduced on 816. Share the check between evaluation and
application, retaining the write/proposal-URI gates before the metadata read.
