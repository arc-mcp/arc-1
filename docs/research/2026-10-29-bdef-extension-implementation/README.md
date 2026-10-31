# BDEF extension implementation qualification

Stage 4, 2026-10-29. Branch `codex/bdef-extension-discovery`, based on origin/main
`ac8385fa47b6c40c2c77c6507e03c376bfc3b613`, with the stage 1 foundation
`67e5703449c133e575d893d3184b531f3725bf2d` imported as `3c970018f`.

The adapter uses one native WUL network as a candidate index, excludes self and
unconnected/non-BDEF references, binds each candidate name to its canonical BDEF URI,
then verifies `extend behavior for` statements against entities declared in the base.
The linear lexer removes comments and strings and observes top-level statement
boundaries. Summary verifies at most two candidates. Sources uses the shared node,
send, byte, deadline and rendering caps. Every hidden read enters the shared session
with SAPRead.BDEF authorization. No SQL, RFC, ABAP helpers or SAP mutations are used.

`a4h.json` records actual read-only results on SAP_BASIS 758, HTTPS 443/client 001.
Both DEMO_RAP_EXTEND1 and DEMO_RAP_EVENT_EXT were verified. Summary used five actual
sends/3,894 response bytes/1,603 ms, including CSRF; sources used three sends/3,894
bytes/746 ms with a warm session. This sample is not a latency guarantee. The normal
discovery bootstrap was performed before the base/optional phase, as at server startup;
the full discovery document exceeds the optional summary byte cap. A cold optional
discovery can therefore correctly end with partial coverage.

`npl.json` records the release-750 exclusion: no BDEF base was read and no optional
BDEF sends occurred. This is unsupported-release qualification, not positive BDEF
coverage on 750. Generic RAP/CDS availability is insufficient. At this initial checkpoint, BTP and other releases,
complete WUL indexing, inactive extension snapshots and runtime applicability remain
unqualified. An empty index never proves global absence. CDS/DDLX and BAdIs are excluded.

The [2026-10-31 BTP follow-up](../2026-10-31-extension-test-gaps.md) qualifies public
SAPRead on SAP_BASIS 920 with four source-verified extensions. Its summary verifies two
and explicitly omits the other two candidates. Direct and Connectivity transport tests
and request/client isolation regressions were added at that checkpoint.

Reproduce with `BDEF_SMOKE_TARGET=a4h|npl` and the corresponding existing SAP_USER /
SAP_PASSWORD environment, using `node --import tsx scripts/smoke-bdef-extensions.ts`.
Only identities, statuses, budgets and source hashes are written to stdout.

Validation before shared handler integration: 44 BDEF tests plus 11 foundation tests;
full unit suite 385 files / 10,620 tests. Typecheck (source/scripts/tests), lint,
validate:policy, build and check:sizes passed. Lint emitted two existing informational
template-literal suggestions in unrelated tests. Family handler integration and final
combined qualification follow the stage 1–3 commits; they are not claimed by this adapter
checkpoint. Integration must also charge failed response bodies cumulatively in the
optional budget without changing existing data-preview accounting.

## Public SAPRead qualification

`public-a4h.json` records the actual SAPRead path after the DDIC transport/schema
integration. None returned one unchanged source block. Summary and sources preserved
that same block byte-for-byte and verified both extension identities. Summary used
five sends, 4,026 response bytes (including control bodies), and 1,301 ms. Sources
used three sends, 3,894 bytes, and 848 ms; both authored sources were separately
labelled. These are observations with warm capability discovery, not latency guarantees.
Run `scripts/smoke-bdef-read.ts` with existing A4H credentials to repeat; it writes
only hashes, provider states, counts and labels. The qualification run used Node 24
with `--dns-result-order=ipv4first` and normal HTTPS certificate verification.

The public tests additionally verify none-mode whole-result compatibility, owning-source
coverage on explicit line-window reads, default suppression on partial reads, unsupported
inactive coverage, and base preservation after optional 401/403/429 or wrong-context data.
Candidate parsing also treats an unverifiable HTTP 200 body as incomplete, and entity
attachments obey the shared graph-edge cap with explicit omissions.

`final-public-a4h.json` repeats the public check at `d7f1491d`, after all family routing,
class history guards and omission fixes were integrated. The saved source-tree hash binds
this run to the final code. All base blocks remained identical; both extensions were verified.
Summary used five sends / 4,026 bytes / 1,085 ms, sources three sends / 3,894 bytes / 746 ms.
