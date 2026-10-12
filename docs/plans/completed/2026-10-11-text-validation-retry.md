# Text-pool validation must not trigger MIME negotiation

PR #974 supplied the reproduction: a selection label exceeding 30 characters
returns HTTP 406, and ARC-1 repeats the rejected PUT with a generic Accept header.
Changing Accept cannot repair the submitted text.

## Decision and review

Keep the existing fallback in one small helper. On text-part PUT routes only,
reuse the XML property extractor: a nonempty T100 message class other than
`SADT_RESOURCE` is an application error, so return the original failure without
retrying. Check this before extracting MIME-looking text from the error.

An initial three-code allowlist was incomplete. Independent probes reproduced
additional `SEDX_ADT` errors and `00/001` for invalid maximum-length syntax.
Classifying individual message numbers would require ongoing compatibility work.
The route boundary keeps this change narrower than #974's global proposal.

Preserve `SADT_RESOURCE` negotiation, errors without a message class, other routes
and methods, 415 handling, legacy 7.40 fallback, and success-only header caching.
No input parser, settings or tool-schema changes are needed.

## Verification

Baseline and fixed probes use disposable objects through the public dispatcher
and native ADT. On 758 SP02 and 816 SP01 over HTTPS Basic, validation failures
produce two PUTs on the baseline; genuine GET and PUT negotiation is identified
by `SADT_RESOURCE/044`. BTP ABAP 920 SP05 uses named-user OAuth and supports class
symbols. 750 SP02 has no text-elements service (discovery and native 404); no 7.40
system is available. No principal-propagation or CF-route coverage is claimed.

Regressions check attempt counts, original-error retention, subsequent writes,
XML variants, route/method boundaries and genuine negotiation. Full repository
gates and live checks must pass on the final revision; all probe owners are
removed and verified absent. No roadmap impact: FEAT-34 concerns translation
workflows beyond these existing surfaces.
