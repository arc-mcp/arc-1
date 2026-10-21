# Claude final review — dump-filter extraction

| | |
|---|---|
| Reviewed commit | **`027159e3cd1c6095e12ba32954c69ddc3b4ea52e`** (`docs: record dump-filter validation and model limitations`) |
| Base | main **`498c12bbab1b4c6337e01e3451c5811ba8b8aa97`** (ancestor) |
| Since review 1 (`44d649da`) | `571c0a0f` (placeholder defaults), `290622c8` (review fixes and the neutral example), `027159e3` (validation record) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Fresh immutable `git archive` export, focused offline checks. No SAP, models, network, GitHub, shared edits or full-suite rerun. The archived review 1 is byte-identical to mine. |

## Verdict

**Ready for a draft PR. There are no must-fix defects.**

- Both deterministic findings from review 1 are fixed.
- The new early return is correct and safe.
- The research note, the evidence hashes and all 24 manual classifications match the raw
  artifacts.
- The remaining items are disclosed, nonblocking limits. Most importantly, the full Node 24 run is
  **not green** (8,998/9,003). The same four startup timeouts reproduce on unchanged main, and the
  fifth failure passes in isolation.

#1011 correctly stays open for batch syntax, with saved logs deferred. Nothing should be closed or
merged.

## Review-1 findings and corrections

| Item | Verified |
|---|---|
| `tools.test.ts:752` | The assertion now checks `No server-driven types`, which still guards the `object_state` warning. It passes. |
| Multi-target action lists | `feed_schema` is added to both `docs_page/multi-target-setup.md:355` and the normative `destination-discovered-multi-target-v1.md:1082`. `btp-docs-contract.test.ts` passes. |
| Example leakage | The schema and `tools.md` examples now use `MESSAGE_TYPE_X`; the `TIME_OUT` eval task is unchanged. |
| Ordering and detail docs | "newest first" is back in the schema and `tools.md`, along with the full detail description. |
| Unrelated shortened descriptions | Kept, and stated as not model-qualified. Ceilings unchanged. |
| Unknown-datatype wording | Deferred; unsupported types already fail closed. |

### The early return (`schemas.ts:1122-1123`)

```ts
validateDumpFilterInputs(input, ctx);
if (input.action === 'feed_schema' || (input.action === 'dumps' && input.filters !== undefined)) return;
```

**Correct and safe.** I checked every refinement it skips:

- the CI `packages`/`packageTrees`/`configuration`/`failOnSeverity`/`includeReportXml` rules;
- the `objects`-only-for-ATC rule;
- the `unittest` type rule and `includeSubpackages`;
- `timeoutSeconds` and `resultFormat`;
- the `gateway_errors` `detailUrl` canonical-path check.

For these two branches, `validateDumpFilterInputs` has already applied a complete allowlist:
`['action']` for `feed_schema`, and `action`, `filters`, `user`, `from`, `to` and `maxResults` for
filtered dumps. Any meaningful value of a skipped field is therefore refused first; only `false`,
`[]` and `maxResults: 0` defaults get through. The surviving fields are validated elsewhere:
dates by `normalizeFeedTimestamp` before any I/O, `user` by the filter compiler, and `maxResults`
by the existing clamp. No URL or path check becomes reachable. Legacy actions and unfiltered
`dumps` are unaffected.

**Fail before, pass after (reproduced).** I copied the final test file onto the `44d649da` source.
Exactly the two new cases fail and the other 39 pass. At the final commit, 56/56 pass across both
filter test files.

*Maintenance note:* if a future refinement placed after this early return should also apply to
these two branches, it will be skipped. The code comment states this coupling.

## Research note and evidence

| Claim | Evidence | Result |
|---|---|---|
| Evidence integrity | `sha256.json` matches all 5 files. Each ZIP's inner manifest matches its 33 members. The README labels say the exploratory run (`571c0a0f`) has the matching-example confound and the corrected run (`290622c8`) must not be pooled with it. | ✓ |
| Live probe at `290622c8` | Full SHA recorded. Five GETs (list; schema + positive; schema + negative, with identical schema hashes), `mutationCalls: 0`, the positive query returns the same ID/error, the negative is empty, and only hashes, bytes and booleans are recorded. `src`, `scripts` and fixtures are unchanged from `290622c8` to `027159e3`. | ✓ |
| Two separate 12-trial runs | Manifests: candidate heads `571c0a0f`/`290622c8`, baseline main `498c12bb`, Qwen 3.6 35B MLX (`1b50c6fd…`) and Llama 3.1 8B (`46e0c10c…`), 3 cases, 1 repeat; 229 s / 211 s against a 900 s budget. | ✓ |
| Qwen rare error | Both arms answer D079 then D113 and exclude the adjacent days in prose. **4 → 1 calls, 32,694 → 453 returned bytes.** Both fail strict JSON. The baseline has `contextNearLimit` at an effective 16,384 context. | ✓ |
| Qwen recent dumps | Both arms use 1 call with no dates, drop the next-day row and stop at two IDs. The candidate's "only two were recorded" overstatement is noted. | ✓ |
| Llama | Syntax is correct, with unsupported `latestAttempt: "proven"` filler. Recent dumps use a zero-width midnight window, 2 → 2 calls. On the rare error, the baseline gives the wrong IDs (D900, D000); the candidate sends `filters` as a string with an invented `MESSAGE_TYPE` attribute, rejected before SAP I/O. | ✓ |
| All 24 manual rows | `strictCompleted` equals each raw `completed`. `requestedFactsSupported` and the notes match the answers and traces. | ✓ |
| `candidatePatchHash` | Disclosed as an archive-label hash; the source is identified by `candidateHead` and the file/catalog hashes. | ✓ |
| Validation record | The `checks.json` log hashes match the two named `/tmp` logs. Final run: **8,998 passed / 5 failed / 9,003**, the failures exactly as listed. Main control: 50/54 with the same four tests. After `571c0a0f`, `src` changed only in two `tools.ts` wording lines. | ✓ |

The decision paragraph is appropriately narrow: it retains the filter for the live match plus one
corrected model pair, and makes no autonomous-diagnosis, small-model, pooled or latency claim.

## Nonblocking limits (disclosed; no change required)

1. **The full suite is not green.** Four subprocess startup timeouts are reproduced on unchanged
   main, so they predate this PR. One HTTP-body timeout passes in isolation, as it did in my run
   (23/23 within my 915-test focused set). Say this in the PR description; CI should confirm.
2. **Token headroom is nearly gone.** BTP full is 17,648 of 17,650 tokens (2 left) and on-prem full
   is 18,605 of 18,625 (20 left). The next catalog wording change will need a deliberate ceiling
   raise.
3. **Example wording (optional).** In the corrected run Llama invented `MESSAGE_TYPE` as an
   attribute. Earlier, Llama used `MESSAGE_TYPE_X` itself as an attribute. The example value may
   read like an attribute name to small models. Optionally say so in the note; no product change
   is needed.
4. **Coverage.** Live coverage is A4H 758 only. Model benefit is shown for one Qwen pair; Llama
   shows none. Unrelated descriptions are not model-qualified. All of this is stated in the note.

## Checks run (fresh export of `027159e3`, Node 22.21.1)

| Check | Result |
|---|---|
| Focused tests: both dump-filter files, `tools`, tool snapshots, schemas, key sync, Zod/JSON parity, `btp-docs-contract`, `multi-target-tools`, `http-request-body`, ADT diagnostics, authz policy, hyperfocused, dispatch | **14 files / 915 tests passed** |
| Fail-before check of the placeholder fix | On `44d649da` source: 2 failed / 39 passed. At the head: pass. |
| `tsc --noEmit` (src and tests) | pass |
| Biome (14 changed code files) | pass |
| `validate:policy` | pass (131 entries) |
| Strict `docs:build` | pass |
| `check:sizes` | pass (657 files). Catalog sizes 74,420 B / ~18,605 tokens and 70,591 B / ~17,648 tokens, matching the note. |
| Evidence | 5/5 outer hashes, 33/33 inner per ZIP, 24/24 manual rows, 2/2 log hashes |

## Limitations

- No SAP, model or network runs. The live and model results come from the committed records,
  which I checked for internal consistency.
- I didn't rerun the full suite; Node 24 results are as recorded.
- Node 22.21.1 locally.
