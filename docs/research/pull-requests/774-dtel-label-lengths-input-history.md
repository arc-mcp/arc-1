# PR #774 — DTEL label lengths and input history

**PR:** https://github.com/arc-mcp/arc-1/pull/774 (`codex/issue-771-dtel-metadata`)

**Reviewed:** 2026-09-10 — round 1 on `d613b32f`, re-review on `1f5fb2a6`, follow-up commits
`22e99e81`, `f7b86918`, `ac7792e7`, and Claude round 3 on `e163cadd`

**Verdict:** round 1 REQUEST CHANGES → round 3 REQUEST CHANGES → **APPROVE after the final follow-up**.
Every blocking finding is fixed and the final local gate matrix is green.
**Linked issue:** [#771](https://github.com/arc-mcp/arc-1/issues/771) (dossier: `docs/research/issues/771-dtel-label-lengths-input-history.md`)

## Summary

- Codex commit `93435cbf` resolved every actionable round-1 finding. The table below records each one; the
  fixes were re-verified live on SAP_BASIS 750 SP02, 758 and 816.
- **New blocker, fixed.** #769 reached `main` after the branch's last merge. The combination exceeds the
  BTP full-tool `descriptionCount` ratchet (266 > 265). Commit `ac7792e7` fixes it without raising any
  ratchet.
- **Two older data-loss bugs, fixed.** Both exist on `main` independently of #774. A DTEL create without the
  follow-up PUT loses its description, and a partial DTEL update wipes the search-help parameter,
  SET/GET parameter, change-document flag and bidi flags. Both are described below and fixed in commit
  `f7b86918`, with before/after live evidence.
- **Round-3 read-after-write regression, fixed.** A plain DTEL read had begun forcing `version=active`,
  silently hiding a pending draft. Omitted and `auto` reads now use SAP's developer view; explicitly
  requested `active` and `inactive` values pass through to SAP.

## Round-1 findings — status

| Finding | Status on `1f5fb2a6` |
|---|---|
| B1 re-sending an unchanged label resets its reservation | Fixed; live: 10/20/40/55 kept on all three releases |
| B2 undisclosed trim of the #363 payload guidance | Disclosed in the PR body and a code comment; compact guide kept, no budget raised |
| S1 dossier claimed pre-write reservation validation | Corrected: activation stays authoritative |
| S2 `SAPRead type=DTEL` ignored `version` | Fixed; live: `version=active` returns the active object while a draft exists |
| S3 25 raw evidence files / runners | Removed |
| P2 metadata merge failed open on read errors | Fixed (`catch` removed, unit-tested) |
| P4 `SAPRead` DTEL `version` | Fixed with S2 |
| P1 description lost on create | Left out of scope → **fixed in `f7b86918`** |
| P3 remaining DTEL fields not preserved | Left out of scope → **fixed in `f7b86918`** |
| N1 length properties have no descriptions | Unchanged; BTP budget is at its ratchet |
| N2 `z.coerce.number()` quirks | Unchanged (repo convention) |
| N3 `fix:` vs `feat:` title | Kept `fix:` because the PR primarily prevents metadata loss and stale read-after-write results |

## New in the re-review: tool-schema budget conflict with #769

`1f5fb2a6` was green and GitHub reported it `MERGEABLE CLEAN`. #769 then added schema surface to `main`. A
local merge of `origin/main` has no textual conflicts, but `check:sizes` fails:

```text
btp-full-git.descriptionCount: 266 (budget 265)
btp-full-git-live-relations.descriptionCount: 266 (budget 265)
```

The extra description is the PR's `deactivateInputHistory` property description. Commit `ac7792e7` moves the
negative-polarity note into both SAPWrite descriptions ("deactivateInputHistory=true disables input history")
and leaves the property undescribed, like the four length properties. Final estimates:

| Scenario | Tokens (budget) | Descriptions (budget) |
|---|---|---|
| standard-full-git | ~18,160 (18,500) | 271 (272) |
| btp-full-git | ~17,301 (17,350) | 265 (265) |

`22e99e81` is the merge of `main` (#769, #773) into the branch; it needed no conflict resolution.

## Older bug 1 — DTEL create loses its short description

**Behavior.** `SAPWrite create DTEL` reported success, but the stored data element had an empty short
description whenever the create carried no label, length, search-help, SET/GET, component-name or
change-document field. That includes a history-only create and the same object inside `batch_create`.

**Root cause.** `POST /sap/bc/adt/ddic/dataelements` stores only a shell. It keeps `deactivateInputHistory`,
but stores **no short description** (even though the POST response echoes `adtcore:description`), no labels,
and default lengths. Only the lock + full-XML PUT persists them. ARC-1 sent that PUT only when
`dtelNeedsPostCreateUpdate` found a trigger field, and the description was never one.

**Fix (`f7b86918`).** Every DTEL create, single or batch, sends the follow-up PUT, and
`dtelNeedsPostCreateUpdate` is deleted. On NW < 7.51 systems without the stateful-session enhancement, every
lock-bound PUT fails. There, a label-less create now reports that error instead of silently dropping the
description, which matches every other write on those systems.

## Older bug 2 — partial DTEL update wipes stored fields

**Behavior.** DTEL updates replace the full XML document. The parser never read `searchHelpParameter`,
`setGetParameter`, `changeDocument`, `leftToRightDirection` or `deactivateBIDIFiltering`. The merge passed
only caller-supplied values for the first three, and the builder hard-coded both bidi flags to `false`.

So a description-only update reset all five. Live test: a DTEL on domain `BUKRS` with the standard `BUKRS`
settings (search help `C_T001`, parameter `BUKRS`, SET/GET `BUK`, change documents on) was activated, then got
a description-only `SAPWrite update` followed by `SAPActivate`:

| Release | Activation after the update | Active version afterwards |
|---|---|---|
| 750 SP02 | Succeeded with warning "Search help binding is incomplete" | `C_T001` with no parameter, no SET/GET, change documents off |
| 758 | ARC-1 reported failure: "became active despite inconsistent references" | Same corrupted state; SAP activated it anyway |
| 816 | Cancelled: "Search help binding is incomplete (parameter missing)" | Previous active version kept; the inactive draft is broken |

Bidi flags set to `true` through a raw PUT were back to `false` after a description-only update on all three
releases.

**Fix (`f7b86918`).**
- The parser reads the five fields; `SAPRead` returns them.
- The merge keeps `setGetParameter`, `changeDocument` and both bidi flags.
- It keeps `searchHelpParameter` only while the effective search help equals the stored one
  (case-insensitive), and drops it when the search help changes.
- The builder writes the bidi flags.

Tests: parser fixture assertions, merge unit tests (preserve, explicit `false`, changed search help,
lower-case re-send), and a handler-level description-only update asserting the PUT body.

## Round 3 — plain DTEL reads hid pending drafts

**Behavior.** After an activated DTEL was updated, `SAPRead type=DTEL` without a `version` returned the
old active metadata and no draft warning. Before `93435cbf`, the same read used SAP's version-less
developer view and returned the pending draft. Claude reproduced this on SAP_BASIS 750, 758 and 816;
`version=auto` returned the draft on all three, and never-activated DTELs still read successfully.

**Root cause.** The handler deliberately defaulted reads to `active`, and the Zod schemas also materialized
that default. The schema transformation erased whether the caller had actually supplied `version`, so a
handler-only omission check still sent `?version=active`.

**Fix.** The on-prem and BTP schemas now preserve an omitted `version`. The handler still defaults source
reads to active, but sends no DTEL version for an omitted or `auto` read. Explicit `active` and `inactive`
values continue to pass through to SAP. Tool descriptions, generated snapshots and the
public tool guide document the per-type behavior.

**Regression coverage.** Handler tests cover omitted, `auto`, explicit `active` and explicit `inactive`
DTEL reads. Schema tests prove omission survives both runtime schemas; schema-key sync, Zod/JSON-schema
parity, generated snapshots and budget tests cover the public surface. The final full suite passed 6,579
tests across 213 files.

## Verification

### Final gates

| Step | Result |
|---|---|
| `npm run build`, `typecheck`, `lint` | pass |
| `npm test` | 213 files, **6,579 passed** |
| `npm run check:sizes` | pass (file ratchet + tool-schema budgets above) |
| `npm run docs:build`, `git diff --check` | pass |

One earlier full run hit `ECONNRESET` and a timeout in the unrelated
`tests/unit/server/http-multi-target-routes.test.ts`, while three live runs and a build competed for CPU. It
passed 6/6 in isolation and in the final full run.

The follow-up keeps `tests/unit/handlers/write-ddic.test.ts` under its 3,000-line default ratchet (2,996);
the batch regression lives in `write-create-batch.test.ts`.

### Live — SAP_BASIS 750 SP02, 758, 816

Each step ran as a fresh `node dist/cli.js call <Tool>` process (`ARC1_CACHE=none`, `$TMP`). Ground truth was
raw `GET /sap/bc/adt/ddic/dataelements/{name}?version=…` after `SAPActivate`. "Before" is PR head `1f5fb2a6`;
"after" is `ac7792e7`. Results were identical on all three releases.

| Scenario | Before | After |
|---|---|---|
| Update re-sending unchanged labels + new description | 10/20/40/55 and `true` kept | same |
| `SAPRead version=active` while a draft exists | active object | same |
| `?version=inactive` with no draft | returns the active object | same (informational) |
| Label-less create | description **empty** ❌ | description stored ✅ |
| History-only create | description **empty**, flag `true` ❌ | description stored, flag `true` ✅ |
| Label-less `batch_create` | description **empty** ❌ | description stored ✅ |
| Description-only update of the `BUKRS`-style DTEL | parameter/SET-GET/change doc wiped (table above) ❌ | `C_T001:BUKRS`, `BUK`, change doc `true` kept; clean activation ✅ |
| Description-only update with bidi flags `true` | reset to `false` ❌ | kept `true` ✅ |
| Cleanup | 0 leftovers, 12 404 checks per run | same |

## Remaining notes (non-blocking)

- **Title.** #771 is a `[Feature]` adding five `SAPWrite` inputs; a squash title of `feat:` gives the matching
  minor release.
- **Merge read version.** `mergeMetadataWriteProperties` reads the default (developer) view. `?version=inactive`
  returned identical content on all three releases and might sidestep the documented 750 session-sensitive
  404, which now fails the update closed. Not changed without a reproduction.
- **Other metadata types.** DOMA, MSAG and SRVB merges were not audited for omitted fields in this review.

## Security & architectural invariants

No new endpoint, scope, package gate or schema property; one property description moved into the tool
description. The always-on post-create PUT reuses `lockObject`/`updateObject`/`unlockObject` with
`client.safety`, inside the same package-gated create path. There is no new logging, and no credentials are
in the diff or this dossier.

## Paste-able review

```markdown
Final re-review of #774: **approve**.

Claude's round-3 blocker is fixed. A plain `SAPRead type=DTEL` no longer forces `version=active` and hides a pending draft. Omitted and `auto` reads use SAP's version-less developer view; explicit `active` and `inactive` pass through to SAP. The runtime schema had also been materializing the active default, so the fix preserves omission in both on-prem and BTP schemas while the handler continues to default source reads to active.

The earlier fixes remain intact: label reservations and input-history settings survive unrelated updates; every DTEL create persists its description through the follow-up PUT; partial updates preserve search-help, SET/GET, change-document and bidi fields; metadata reads fail closed; and the branch is merged with current main without raising schema ratchets.

Final local validation: build, typecheck, lint, docs build, file and tool-schema budgets, focused schema/handler tests, and the full 213-file suite with 6,579 passing tests. Standard full Git is approximately 18,160/18,500 tokens and BTP full Git is approximately 17,301/17,350. Claude's live reproduction on SAP_BASIS 750, 758 and 816 established that version-less and `auto` reads return the pending draft.
```
