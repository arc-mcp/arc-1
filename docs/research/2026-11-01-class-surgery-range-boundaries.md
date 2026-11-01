# Class-surgery range boundaries

Research for PR 1142's shared class-surgery adapter found a native range shape that the existing
whole-line signature/delete/visibility helpers cannot safely edit individually. Broader pinned
class surgery remains disabled; this prerequisite fixes the shared helpers first.

## Native observation

A direct, read-only A4H/001 probe fetched active `CL_ABAP_CONTEXT_INFO` main source and
`objectstructure`. No lock, save, activation or Principal Propagation qualification was performed.
The source SHA-256 was `037130349153fb070b26334014df01c05c85eea67e7d0ccd74815b7ac014aa85`.
The original source, XML and parsed observation are retained in the private operator evidence.

Eleven chained `CLASS-METHODS:` declarations shared definition start row 18. Each range extended
through its selected declaration: the first ended at row 35, the second at row 53. The existing
parser retains these ranges. It does not convert them into independent declaration ranges.

Pure local calls to `spliceMethodSignature` and `removeMethodPair` for the second method both
removed the first declaration while retaining its implementation. Nothing was sent to SAP. This
establishes an unsafe local transformation, not an observed production save or backend failure.

## Shared refusal and remaining adapter work

Signature replacement, method deletion and visibility movement now refuse a selected declaration
whose native range starts with `METHODS:` or `CLASS-METHODS:`. The guard precedes the transformation
and applies to the common helpers. It handles intervening comments and CRLF. Ordinary declarations
with a colon in a default string still work. An unchanged-visibility request can remain a no-op.
The supported fallback is a complete editable class source update preserving neighboring methods.

The tests use a minimal authored class with the observed overlapping range shape, not a copy of
SAP source. They cover the first and later chain members, instance/static chains, comments, and
real handler refusal under lock with no PUT and successful unlock, even when lint is disabled.
Existing class-surgery/RAP tests preserve the unchained behavior.

This is not complete source/structure validation. Before admitting the broader pinned adapter,
require owner/source agreement and selected token/range consistency in the same locked session.
Other overlapping or shared-line shapes require explicit handling or refusal. The current parser
prefers the returned class name and parses link fragments without proving owner/source agreement.
Exact chain editing would need a separately evidenced shared algorithm; it is not implemented here.
FEAT-93 remains open, including the guarded adapter and two-writer qualification.

Author validation passed 423 files / 11,494 tests, all three typecheck projects, lint, strict docs
and file/schema budgets. The focused class-surgery/RAP suite passed 282 tests. Local replay of the
saved native source/structure now refuses all three individual edits before transformation.
This checkpoint still requires the requested independent Opus review.
