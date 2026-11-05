# ENHO and SKTD editable read companions

Date: 2026-11-02. This extends the ordinary `SAPRead(format="editable")` metadata envelope;
it does not admit private document mutations or qualify their native behavior.

## Source and shared contract

Read work starts at `cd0dc2c64cfac4bc890b0370a3bb5629f33d5b36`: primary
`5402630cb6e2260b379da6ac25d2390c776be705` plus the preserved ENHO/SKTD feature
`249eb70703b7b95d077be4852167c323f8095c85`. Integration retained the latest concise roadmap
and combined document activation budgets with the existing shared-context contract. The original
feature branch/commit remain unchanged. Integration follow-up `93af781339d5ee73700a0267cd0e9f2412fe10c3`
adds the document grant to the upstream shared preparation signature; this is the exact parent
of the separately committed read delta. This read delta can be reviewed separately from that feature.

`readNativeDocument` is the ordinary GET helper extracted from `readPinnedDocument`. Both use
`parsePinnedDocument` and the identical complete namespace-aware canonical metadata hash.
The write wrapper still checks both write-package ceilings. The ordinary reader requires read
permission only, including when writes are disabled and the actual package is outside both lists.
The caller's existing mapped client performs the request; the read does not create an identity or grant.

The existing lazy `editable-source` to `editable-native` boundary is preserved. Schemas and the
pure source-precondition helper do not import native HTTP adapters. No credential or `.env`
loading is introduced. Public write routes still reject raw `expectedMetadataHash` and do not
admit ENHO/SKTD mutations.

## Representation, view and limits

One uncached GET selects the exact document URL, with native Accept and no `version` parameter.
It returns canonical `type`, selected `name`, `nativeType`, `objectUrl`, actual `package`,
`metadataView="developer"`, observed `nativeVersion` and `inactiveAlternative`, complete
`metadataXml` and the writer's `metadataHash`. Active/inactive/new are observations, not a claim
that a draft exists. Metadata includes the source-bearing state; no synthetic `/source/main`,
separate source hash, Markdown rewrite, lexical routing or opaque-field projection is used.

KTD and SKTD/TYP aliases retain the existing SKTD normalization. Native XML prefix aliases are
handled by namespace, and unknown namespace fields and values remain intact and significant to
the hash. ENHO reads require the established BADI_IMPL technology and referenced spot identity.
SKTD reads use the existing exact top-level DDLS/DF, BDEF/BDO, SRVD/SRV, SRVB/SVB, DEVC/K or
SMBC/TYP parent-reference contract. Neither a parent GET nor an enhancement-spot GET is needed
for this document read. Subobject/unknown technology contracts remain unsupported.

Each read has the existing 60-second deadline/cancellation and 16-attempt limit, with a tighter
1 MiB cumulative decoded-response allowance counting all statuses. Unknown native identities,
versions, ambiguous or foreign references, malformed XML, native errors and limits return an
error without a usable hash. A 404 is not an empty document. This is one response snapshot,
not a lock or an atomic transaction across calls; a private writer rechecks the complete hash.

## Offline evidence and remaining gaps

Tests exercise the actual public dispatch and ADT HTTP stack with controlled native-shaped XML:
read-only access outside write packages, matching private writer hashes, successful writer
round trips and stale unknown-field rejection, fresh reads/cache bypass, native versions and
alternatives, type/XML prefix aliases, foreign nested namespaces, unsupported metadata, native
errors and response/cancellation limits. Existing ordinary reads and writer wrappers remain
regression checks. These are mocks and fixtures, not current native or two-writer PP evidence.

The document writer is under separate independent review. Its reported SKTD namespace-shadowing
rewrite problem is not changed by this read delta: the ordinary reader preserves raw XML and
namespace-aware hashes without invoking that legacy rewrite. A separate
[writer correction](2026-11-02-pinned-enhancement-documents-review-followup.md) qualifies structural
write slots and activation reporting; the combined candidate still needs independent re-review. Returning a hash never represents write readiness.
Native release/view behavior, current-build PP and public mutation admission remain open.

Native contracts: [ENHO](2026-10-07-enho-xhb-write-contract.md), [KTD multi-node](2026-09-02-sktd-multi-node-write.md),
[short texts](2026-09-04-sktd-short-texts.md), [routing](2026-09-08-pr766-ktd-routing-review.md),
and the [private writer candidate](2026-11-02-pinned-enhancement-documents.md).
