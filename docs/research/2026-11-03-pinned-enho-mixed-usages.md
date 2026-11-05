# ENHO mixed native usage references

The A4H/001 fixed GET capture exposed a reader assumption: native `ENHO/XHB` metadata for
`ZABAPGIT_REPOS` has four `contentCommon/usages/referencedObject` entries, rather than one.
The complete 6,836-byte default, active and inactive GET bodies are byte-identical, with SHA-256
`471b96b403202e1024db5da4d62fb6ab6ccc424b75ce2204117ef4e7769a4368`. Each reports native
`version="active"`; a successful inactive GET is therefore not evidence of an inactive draft.
These are existing-owner read observations, not native write or activation qualification.

The four entries comprise one `ENHS/XSB` spot, one `CLAS/OC` implementing-class dependency and
two `INTF/OI` dependencies. Each has a matching `objectReference` and `mainObjectReference`.
The owner also contains two BAdI implementations, complete filter trees, filter-property pointers,
a program-check reference and native flags. The previous `.child('referencedObject')` call refused
all three native views as duplicate metadata before reaching these valid details.

## Correction

The shared pure document reader now selects exactly one direct native `ENHS/XSB` usage. It validates
every supported usage pair's namespace, canonical name, exact type and same-route URI, including
both object and main references. `CLAS/OC` and `INTF/OI` dependencies are retained; they confer no
mutation authority and cause no new HTTP calls. Missing or multiple spots, unknown types, foreign
namespaces, mismatched pairs, absolute foreign URIs, traversal, extra queries and unexpected path
encoding are refused. The existing single-spot form remains valid. Other native usage types and
subobject/main-object relationships still require evidence before support is added.

All usage entries and opaque native fields remain significant in the complete metadata hash and
stable readback comparison. No reference is projected away or classified as derived activation
state. An additional dependency changing before or under the owning lock prevents the PUT; a
change observed only after acknowledged PUT retains `document-save-unconfirmed`, with no replay.
The existing writer, ordinary editable read, package checks and owning-session lifecycle are reused.
The legacy spot/filter resolver already handles a usage list and needs no separate implementation.
If a native edit recomputes dependencies, the existing strict comparison can report unconfirmed;
this correction does not invent a normalization rule for such behavior.

## Fixture and offline verification

`tests/fixtures/xml/enhancement-implementation-mixed-usages.xml` retains the entire native body
structure. Only the three root author attributes and two root timestamps are replaced with neutral
test values. Its SHA-256 is `ab0415d51dc9893247b052b3408b631551ef7d205a96223a34f61624bf815a7f`.
The original receipts and collector/manifest hashes remain in the private operator evidence ledger.
No proprietary SAP implementation source or credentials are included in the fixture.

`tests/unit/handlers/pinned-enho-native-usages.test.ts` exercises the real ordinary editable handler,
shared native reader and private write/activation adapters with mocked HTTP. It covers active
fallback in all three requested views, read-only access outside write-package policies, full usage
and implementation preservation, stale and under-lock drift, post-save uncertainty, and adversarial
reference identities. Its spot dependency response is explicitly synthetic; it is not another native
receipt. Native namespace aliases are accepted by the reader; opaque QName-valued attributes remain
hash-significant. The existing lexical writer limitations remain unchanged.

The unchanged actual three receipt bodies are also replayed offline through the corrected production
parser. The initial native-shape regressions fail before the source correction. One initial Vite
startup attempted a `.env` read; the process guard blocked it before content access. The external test
configuration then disabled Vite environment-file loading. No native request was made.

FEAT-93 retains independent correction review, native mutation/activation/cleanup evidence and
current-code PP/public acceptance as separate gates. This read-contract correction grants none of
them and adds no public capability or configuration switch.

Independent source review: [verbatim verdict](2026-11-03-pinned-enho-usage-review-verbatim.md), SHA-256 `5dab7f232cfacd987b81a7317dc33ac1cc132424b192d423c40c46a980d4c731`, approved exact `84e656fcbc1cdffcda27d6352dbf2e489613cfd8` for integration. It replayed all 33 captured reader cases successfully and passed 243 focused tests, including independent preservation/adversarial probes. Native ENHO mutation and PP remain separate.
