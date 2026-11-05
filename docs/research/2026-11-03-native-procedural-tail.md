# Fixed remaining procedural activation/text/cleanup tail

This is an offline candidate for a separately reviewed attempt, not native qualification,
PP evidence or public admission. The first procedural run and the retained e557 run remain
failed and consumed. The latter completed FORM edit/add, then submitted the group URI for
activation: SAP reported generation/activation but the selected include remained inactive.
The strict readback correctly stopped. No text-pool stage or DELETE ran.

The new fixed entry `scripts/qualification/pr1142/native-procedural-tail.ts` binds only:

- A4H/001, Basic MARIAN, package `$TMP`, suffix `6D7A93E20B45C18F`.
- The original FUGR/FUNC/structural-INCL graph and its 590 historical files.
- All 457 retained-run/operator/post-generation files, both independent and operator audits,
  exact failed intent `b7c5ab0038ff8819685256df01210b8f9c5fa9cb6183c29be6123913eb90c618`
  and result `922835968de9926e12dbf2a4820ec60d51c7b6f4d87eed5aa7515b616522b1be`.
- A new permanent root `~/.local/state/arc1-qualification/pr1142-native-procedural-tail-v1`.
  No old root/claim is reset or reused, and there is no caller-selected owner or resume stage.

The private history ledger SHA is
`a19e343e7ec19ebb88374d0a4ee46fb8a5387601c62e6da4aeae576cf0043321`.
It is stored outside the repository beside the author report. Existing readable historical
files retain their exact modes; hashes, lengths, membership, ownership and non-writable
ancestry are verified without rewriting them. No unrelated inventory or credential input
is copied into the repository.

## Starting state and permitted tail

The new GET-only preflight requires the active parent source
`2546dc99ff1d4d26129004853070e29c53b6ac7e24ea2d934df1817d69695a34`,
the edited/added inactive INCL source
`79741f35719e48c74da2b0a43abf90f6bfd408be9d4244cc2cddd4bf270e934d`,
its unchanged active generated stub, and the unchanged active/draft FUNC views. The parent
now reports active even for an inactive query; the FUNC/INCL still have real drafts. The
initial pool remains active with empty symbols/selections and unchanged headings. Child
metadata uses the existing semantic hash, which excludes native changedAt/source etag and
state links while checking state separately; no creator is invented when the native field
is omitted. Raw capture hashes remain bound in history.

The same shared driver starts at **exact structural-INCL activation**, using the production
correction from `17bea488070d5f5b46a45bd7c27efff96dadbc7a`. It cannot replay creation,
signature edits, include edit/add or earlier group/function activation. After strict default
and active include verification, the existing tail checks that the FUNC draft has not been
activated, exercises the five selected pool stages, separately activates FUNC, then deletes
INCL → FUNC → FUGR and verifies typed owner/pool absence and bounded native inventory.

The original empty parent cleanup baseline remains unchanged. The newly active populated
parent is starting-state evidence only. If native child deletion does not restore the original
source/tree baseline, the parent DELETE must stop; this candidate does not invent an extra
activation, adopt the populated baseline or authorize repair. Such a stop would retain a
known parent and require a new reviewed decision.

## Phase chain and limits

The fixed flags are:

1. `--prepare-reviewed-procedural-tail <full-reviewed-SHA>` (offline immutable intent).
2. `--preflight-reviewed-procedural-tail <full-reviewed-SHA>` (GET-only starting-state proof).
3. Fresh post-preflight, post-prepare raw JPEG SM12 searches, suffix/all-user and MARIAN/all-argument,
   saved with exact hashes in the existing baseline schema using this new protocol identifier.
4. `--check-reviewed-procedural-tail <full-reviewed-SHA>` (read-only, no credentials or claim).
5. `--execute-reviewed-procedural-tail <full-reviewed-SHA>` (exactly one permanent claim).
6. Fresh post-run controls, then `--verify-reviewed-procedural-tail-cleanup <full-reviewed-SHA>`
   only if the execution result confirms the complete tail and absence.

Run only on the independently approved clean source with Node22.21.1, the existing reviewed
runtime environment projection, and `node --import tsx` followed by the fixed entry and flag.
The ordinary runtime assertions reject extra loaders/debug/Git overrides before the phase.
This document grants no execution approval. Preparation/check are also left to the operator
following the exact-source review.

Freshness, original absolute deadline, source/history/stop/policy checks, bounded attempts and
response bytes continue through actual HTTP send boundaries. Owning UNLOCK/session close keep
a separate bounded cleanup allowance. Every uncertain operation stops; there is no automatic
catch cleanup, retry, rollback or repair. Historical confirmed deletions remain distinct from
current present/uncertain residual observations. Installed dependency bytes are not attested by
the package-lock binding. Local Basic receipts do not qualify PP or recorded CTS behavior.

Offline tests use the captured owned metadata plus a confined `.invalid` MockAgent and the
real entry, runtime client factory, private adapters and shared driver. They cover stage
exclusion, current-state mismatches, successful200 without activation, unexpected sibling
activation, original cleanup-baseline refusal, queued final-send guards, own cleanup after
stop, terminal residuals, permanent claims and historical file drift. These mocks do not
establish SAP behavior for the still-unobserved tail.
