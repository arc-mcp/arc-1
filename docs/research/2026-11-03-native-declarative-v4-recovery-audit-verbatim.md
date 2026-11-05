# Independent audit — fixed V4 pair recovery succeeded

Audited offline on 2026-11-03. The saved native evidence confirms removal of the two remaining owners from the failed V4 run, in the approved order: **BDEF, then its abstract DDLS parent**. Final owner-absence checks, owning cleanup summaries and fresh post-run SM12 controls are consistent. No recovery failure or remaining owned resource is reported or contradicted by the journal.

This is **Basic-native cleanup evidence only**. The original V4 lifecycle remains failed and permanently consumed. This audit does not approve another fixture/protocol, complete the six-owner lifecycle, qualify PP/public writes, or establish whole-PR readiness. No native request, browser action, credential/environment inspection, source edit or phase invocation occurred during this audit.

## Bound result and execution

- Revision: `04826cc7e0d942fb43eaa86de14520bd05efc4f9`; recorded checkout `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`; Node `v22.21.1`.
- Recovery root: `/Users/marianzeis/.local/state/arc1-qualification/pr1142-native-declarative-v4-recovery-v1`.
- Result SHA-256: `c444fded9da12a04f5f81c65d91900b251813c746a595568a76ddaed114e7ce4`.
- Intent SHA-256: `41db426ffb72479aea35d86cf3b793a3419629e5481c74d7ea8277f87f94ea99`, created at **06:11:30.709Z**.
- Original failed result remains `3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940`.
- The **166** consecutively numbered journal rows span **06:13:12.828Z–06:13:31.594Z**, with monotonic timestamps. The manifest matches the intent and the independently approved revision, entry hash, package-lock hash and execution path.

The result has `failure:false`, `mutationAttempted:true`, `deleteAttempted:true`, `cleanupConfirmed:true`, `finalAbsenceConfirmed:true`, `stopped:false`, both owners in `confirmedDeleted`, and empty `remaining`/`inspectionRequired`. Each per-owner outcome agrees.

## Actual mutations, version proof and cleanup

| Evidence | BDEF | Abstract DDLS |
| --- | --- | --- |
| Exact owner | `/sap/bc/adt/bo/behaviordefinitions/zarc1_v4a_013fecce68663763` | `/sap/bc/adt/ddic/ddl/sources/zarc1_v4a_013fecce68663763` |
| Own LOCK request / 200 response | rows **27 / 28**, 06:13:16.021–16.157Z | rows **104 / 105**, 06:13:24.857–24.993Z |
| One DELETE request / 200 response | rows **55 / 56**, 06:13:19.135–19.473Z | rows **128 / 129**, 06:13:27.254–28.262Z |
| Immediate owner GET / typed 404 | rows **57 / 58** | rows **130 / 131** |
| Own UNLOCK request / 200 response | rows **59 / 60** | rows **132 / 133** |
| `deleted`, `isError:false`, own cleanup confirmed | row **61** | row **134** |

Exactly two DELETE submissions are observed, one for each permitted owner, with no create, PUT, activation, class mutation, repair or other mutation target. The **16** observed request/response pairs comprise six GETs, four native CTS-preflight POSTs, two LOCKs, two DELETEs and two UNLOCKs. An additional **80** independent native GET receipts are retained. CSRF/session-control exchanges outside that observer are not claimed as separately counted wire packets; the reviewed transport prevents replay of the two DELETE submissions.

The BDEF's default metadata is inactive and explicit active metadata is active, with exact opposite-version same-owner links. Its default/inactive source SHA is `8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb`; the generated active shell SHA is `7be05fcec2b5134a6ee5e91aebdb3ce65351924a341704b079a707eb930182de`. Both metadata and all three requested sources match the retained inspection before the lock and again while its own lock is held (receipt groups ending at rows **6** and **38**).

The DDLS default and active metadata remain active, with no counterpart-state link. Default/active/inactive source SHA is the same `4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8`; the inactive request remains an **active fallback**, not evidence of a separate draft. Five complete DDLS receipt groups, including under each relevant owner lock and after BDEF removal, end at rows **12, 44, 69, 89, 117**. All retained native metadata agrees on the exact native type/name, ownership marker, `$TMP` and MARIAN responsible/createdBy/changedBy fields. These author attributes do not independently identify a propagated principal.

Four actual CTS responses, before/under each owning lock (rows **26, 32, 103, 109**), report `$TMP`, LOCAL, success and empty recording, with no selected request. Their requests bind the exact corresponding owner and existing-object operation. No fabricated CTS receipt or explicit correction request was introduced.

Each own UNLOCK has a retained 200 response. Session closure is represented by each `cleanupConfirmed:true` summary: the reviewed predicate requires successful owning-session close, no failed unlock and no unknown lock. **The raw close HTTP response is not journaled**, so this audit does not invent a close status code or independently inspect omitted cookies/handles.

## Final absence, inventory and post-run lock controls

The final pass after both deletions contains native `ExceptionResourceNotFound` 404 bodies for all six original owners: view DDLS (rows **151–152**), abstract DDLS (**153–154**), DCLS (**155–156**), DDLX (**157–158**), BDEF (**159–160**) and SRVD (**161–162**). The separately referenced class is also typed absent (**165–166**) and was never a mutation target. Every retained 404 body was independently parsed and its bytes/hash verified. These are exact owner GET absence checks; this audit does not claim additional post-delete active/inactive-version GETs that were not performed.

Three inventory GETs (rows **80, 149, 163**) returned 200 with native inventory media. Each has 21,127 bytes and SHA `a41870c2e23e759bcd4ff35091334a204a359cdc8af5e5f834b1c796708bfff8`, with paired `containsFixture:false` summaries. This means clean **for the fixture suffix**, not an empty system-wide draft inventory. Bodies are intentionally omitted to avoid retaining unrelated drafts; the reviewed runner validates their native root and fixture absence, while the independent audit can verify only the retained hashes, repeated equality and summaries.

Both actual post-run raw JPEGs were independently opened with `view_image` from `/Users/marianzeis/.local/state/arc1-qualification/pr1142-native-declarative-v4-recovery-post-20261103T061332`. They visibly show A4H (001), client `001`, table `*`, complete **Lock Table (0)** and green **0 locks have been displayed**, without errors:

- User search: `MARIAN`, argument `*`; **06:13:58.197Z**; SHA `796669c9a6ff7610b9f041cbbee2b7ce737b9d634176fad2162aa33f1e2a78dc`.
- Suffix search: user `*`, argument `*013FECCE68663763*`; **06:14:19.713Z**; SHA `15419fb7981c8d6f0f6cf1ef8b1995ebf565947bc2a4d6fb1726d358cd571e6c`.

Their byte hashes/JPEG signatures match `sm12-post.json`, which binds this revision and exact successful result. Both observations follow the final native journal row. Fresh-search timestamps/provenance are operator-recorded; the pixels, receipt chronology and hashes were independently checked. Identical empty-view pixels to earlier searches do not themselves attest time; the new search/capture provenance and receipt provide that chronology.

## Freshness, preservation and proof ledger

The independently inspected pre-run suffix/user captures are **06:11:54.086Z / 06:12:09.809Z**, after preparation. Their receipt and hashes match the attempt manifest. The original freshness boundary was **06:16:54.086Z**. Both actual DELETE submissions and responses completed well inside it; the entire observed native interval is under 19 seconds, consistent with the reviewed shorter request/owner/shared limits.

The preserved launch receipt `/Users/marianzeis/.local/state/arc1-review/pr1142-native-declarative-v4-recovery-launch1.json` records the earlier GIT_PAGER runtime rejection, exit 1, **before phase entry or root claim** at 06:11:30.483931Z. The successful preparation followed at 06:11:30.709Z. This is a pre-phase launch refusal followed by a compliant invocation, not a claimed-attempt replay. The receipt remains unchanged and is included in the external bindings.

Independently rehashed all **172 recovery files** (166 rows plus six intent/manifest/result/prerequisite files), all three post-control files, all **622 original V4 files**, and all **21** fixed inspection/audit bindings. All original bytes and file sets match. Recomputed **87 retained native response bodies** and **four empty response bodies** match their declared lengths/hashes. Two nonempty lock responses and three nonempty inventory responses remain hash-only and cannot be independently reconstructed. Source-binding fields match the prior approved exact-source proof; this audit does not re-run Git/source verification or attest installed third-party bytes, which the manifest explicitly excludes.

All four recovery directories, including the root, are owner-only `0700`; all 172 recovery files are `0600`, regular and owned by the current user, with no symlinks. Both audit files are written outside the protocol root with `0600` permissions. The companion **pr1142-native-declarative-v4-recovery-audit.json** contains the complete recovery relative-path/byte-count/SHA-256 ledger, post-control ledger, external proof bindings, request/response chronology, native metadata receipts, final absence rows, inventory and cleanup summaries. It is suitable as input evidence for a separately reviewed later protocol; it grants no future execution authority.

The operator reports all GitHub in-progress/queued/pending/waiting runs empty immediately before execution, an active caffeinate hold and all other agents offline for native work. Those controls were not re-queried during this offline audit. The consumed original failure, launch refusal, all raw evidence and fixed successful recovery claim remain preserved.
