# Claude review 2 — verified diagnostics PR #1011 final verification

| | |
|---|---|
| Reviewed commit | **`b89bebd0df21c47df9b2759406ac6d1977899f16`** (`fix: preserve dump user normalization with typed filters`) |
| Compared with | `d93272adc2dcd389e5d730aa3997b758b73d1fc0` ([review 1](claude-review-1.md)), an ancestor of the reviewed commit |
| Repository | `/Users/marianzeis/.codex/worktrees/verified-diagnostics/arc-1`, clean at `b89bebd0` on `codex/verified-diagnostics` (read only) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Immutable `git archive` export of `b89bebd0` (lockfile unchanged, so installed dependencies were reused), tested offline with the real dispatcher and stubbed HTTP. No SAP calls, credentials, shared edits, publishing, merging or deletions. Scratch files are kept. |

The range has 11 commits. Product changes: 7 `src` files plus one file-size budget line; tests in 3
files; docs.

The parent final-review records are outside this verification: policy and notebook docs,
`authorization.md` and `sql-notebooks.md`. The archived `policy-claude-review-3.md` and
`notebook-claude-review-3.md` are byte-identical to my reports.

## Verdict

**Approve. There are no must-fix items.**

- M1, M2, M3, O1 and O3 are fixed as agreed. Each has a PR regression that failed before the
  correction.
- All six of my review-1 regressions pass on `b89bebd0`; all six failed on `d93272ad`.
- I found no new defect.

## Verification by finding

| Finding | Change at `b89bebd0` | Verified |
|---|---|---|
| **M1a** empty-array placeholders | SAPRead drops `objects: []` unless the call is an otherwise-empty SYNTAX batch (`object-types.ts:276`). SAPDiagnose drops an empty `filters` (`:375`). | Every review-1 placeholder case now succeeds (`zz-dg-filler`): `SAPRead PROG objects:[]` (1 request), single-object `SYNTAX objects:[]`, `dumps filters:[]` (no `$query`), `object_state filters:[]`. An empty batch is still refused with no request, and nonempty `filters` on `feed_schema` is still refused. |
| **M1b** filler parity | One `isDiagnosticPlaceholder` predicate (`diagnostic-inputs.ts:60`) is used by SAPRead SYNTAX (`schemas.ts:117`) and the new SAPDiagnose allowlists (`diagnostic-inputs.ts:94`). | `zz-dg-filler2`: `coverage:false` and `maxResults:0` are accepted on the `syntax` batch, `feed_schema` and filtered `dumps`. `activation_log` also passes validation; my stub's metadata then fails the identity check, as designed. Meaningful values (`coverage:true`, `feed_schema maxResults:5`) are still refused with no request. |
| **M2** namespaced DDIC names | The existing canonical guard now passes `allowRawEncodedSlash` for the object URI, the advertised log link and log references (`ddic-activation-log.ts:54`, `:94`, `:132`). | My regression: `/DMO/DOM` is `available`. PR test: object and log URIs and the `%2F` reference are retained. `%2e%2e%2f`, `x%2F..%2F..%2Factivation` and `%252F…` are still refused as unsafe. |
| **M3** size-limit advice | Family-specific hints (`dispatch.ts:207-217`). The JSON shape, code, limit and `retryable:false` are unchanged. Docs say the bounds also apply to unfiltered dump lists (`diagnostic-evidence.md:66`). | Quoted below. PR tests cover normal and minimal-error modes and an unfiltered dump list (one request, no schema read). The data-preview message is unchanged, so the notebook classifier is unaffected. |
| **O1** nested evidence | `collectNodes` continues through matched nodes (`syntax-batch.ts:21-26`). | Nested duplicate report: `incomplete`, both reports listed as unexpected, object `not-checked` (previously `passed`). PR tests: an error nested inside a message gives `failed`; a nested foreign report gives `incomplete`. Quoted and escaped error texts still give `failed`; a text-only message still gives `incomplete`. |
| **O3** user trimming | `diagnostics.ts:245`. | `user:" DEVELOPER"` plus filters gives `and(equals(runtimeError,X),equals(user,DEVELOPER))`. |

M3 outputs through the real dispatcher (case A2):

```text
syntax batch   → {"error":"DATA_RESPONSE_TOO_LARGE","message":"The SAP diagnostic response exceeded the 524288-byte limit. Submit a smaller batch of objects, or inspect the syntax findings in SAP ADT.","limitBytes":524288,"retryable":false,…}
unfiltered dumps → … "exceeded the 2 MiB limit. Narrow from/to or advertised filters, or lower maxResults."
activation_log → … "exceeded the 524288-byte limit. Inspect the existing activation log in SAP ADT; this response cannot be paged here."
```

The research note's follow-up table describes these corrections accurately. It keeps the live
record at `5bc693b3` and calls the corrections offline-tested.

## Deferred as agreed (not blocking)

- **O2:** the documentation of metadata-versus-log failures and the missing structure fallback is
  not in `b89bebd0` yet.
- **O4:** description wording, deferred.
- **O5:** import placement, deferred.
- **O6:** to be parked as a separate legacy-filter follow-up; no roadmap entry yet. Base and head
  behave identically (case A3).

## Notes (no action required)

- **Synthetic only:** a requested object's report nested inside another requested object's report
  is accepted, and its messages also appear on the outer object. This can over-report an error
  but cannot produce a false `passed`. SAP does not nest reports.
- **Pre-existing, outside this diff:** `clampMaxResults` turns a `maxResults: 0` placeholder on
  `dumps` into one result. It could join the O6 strict-client follow-up.
- `src/adt/diagnostics.ts` sits exactly at its new budget (1,954 of 1,954 lines, counted as
  `wc -l`, as the ratchet does).

## Checks run (scratch export of `b89bebd0`, Node 22.21.1)

| Check | Result |
|---|---|
| My six review-1 regressions (`zz-dg-fix.test.ts`) | **6/6 pass** (6/6 failed on `d93272ad`) |
| Earlier repro scripts (`zz-dg-dispatch`, `zz-dg-filler`, `zz-dg-filler2`, `zz-dg-syntax`) | 11/12 pass. The one failure is my old A1 assertion, which encoded the M2 defect ("no request"). The namespaced call now reaches SAP, and my stub's mismatched metadata name is correctly refused. |
| Focused suite: the PR's 22 review-1 files plus `atc-batch`, `atc-batch-ddic`, `live-relations-review` (shared normalizer) and `zz-dg-fix` | **26 files / 1,632 tests passed** |
| `tsc --noEmit` (src and tests configs) | pass |
| Biome on the 10 changed code files | pass (one info-level `useTemplate` hint at `tests/unit/adt/ddic-activation-log.test.ts:65`, the review-1 hint moved down) |

Per your instructions I did not rerun the full suite or the other gates. Codex reports
9,103 tests / 326 files and all six gates passing on combined tree `5a2def19`, and a final run
including the user trim is in progress separately.

## Limitations

- No live SAP. These corrections are offline-tested.
- Not live-verified: the log URL format for namespaced objects, and a positive typed-filter match.
- Node 22.21.1.

## Files

- The regressions and repro scripts are in `claude-review-1-checks/`.
- Scratch is kept, nothing deleted: export `dg-v2` (with the copied tests), plus the review-1
  `dg-head`, `dg-base`, `dg-fix` and `dg-checks`, under
  `/private/tmp/claude-501/-Users-marianzeis-DEV-arc-1--claude-worktrees-arc1-transport-pr-review-b24d1c/29107839-8912-4998-9d5d-8d61b1d3fd68/scratchpad/`.

## Final verdict

**Approve PR #1011 at `b89bebd0df21c47df9b2759406ac6d1977899f16`.** There are no must-fix items.
O2 documentation and O6 parking remain open as you planned; O4 and O5 are deferred nits.
