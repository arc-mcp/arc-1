# Claude Code follow-up — SHLP — 2026-10-31

Reviewed commit: `806e49528b3c21baefaafabd85a90e72e8003f4e`; delta from `e5fcfdcdde6ef20c7128fb4dac20bb8affc3aa42`.
Claude Code 2.1.308, actual model `claude-opus-5-5`, read-only isolated snapshot plus private
native backend source whose hashes match the committed evidence. No permission denials.
Completed successfully in 156.9 seconds. No tests were run by the reviewer.

**Outcome: no remaining merge blockers; merge after final CI is green.**
Application source and tests remain unchanged after this reviewed commit. This follow-up record
and the clarification of the active-version evidence are documentation-only.

## Follow-up review (verbatim)

# PR #1141 follow-up at `806e4952`: no remaining merge blockers

**Recommendation: merge once final CI is green.** B1, B2 and both P2 items are closed. One link in the B2 chain stays untraced, and I describe it below as a known limit rather than a blocker.

This review was static. Test counts come from your validation summary, because I ran nothing. I also couldn't recompute the SHA-256 hashes or check the `follow-redirects` integrity value, since I had no execution or network access.

## B1: closed

- **Fix:** `src/handlers/search-help.ts:12` now calls `isBtpSystem()` first, before input validation and any HTTP.
- **Single route:** `SAPRead` (`src/handlers/read.ts:203`) and `SAPContext` (`src/handlers/context.ts:92`) both enter through `handleSearchHelp`. That handler is the only production caller of `readSearchHelpMetadata` (`src/handlers/search-help.ts:15`).
- **Multi-target:** `storeFor` picks target, then destination, then the default key (`src/handlers/feature-cache.ts:35`), so a BTP result is cached per target.
- **Regression tests:** the unit tests assert the refusal message and zero requests through both tools under `auto`. The live smoke runs the real `probeFeatures`, asserts `systemType: 'btp'` from `systemTypeSource: 'probe'`, and asserts no GET.
- **Accepted limits (unchanged):** the GET still proceeds before the first probe completes, and `tools/list` under `auto` stays on-prem.

## B2: closed as a blocker

The original finding was that the label had no evidence behind it. It now has a concrete native contract, which I read on both backends:

| Step | Evidence | 758 (A4H) | 750 (NPL) |
|---|---|---|---|
| Ordinary GET without `context` reaches the SHLP provider | `CL_SBD_ADT_RES_ELEMENT_INFO_implementations` and factory | `:8`, then `CL_DDIC_ELEM_INFO_PROVIDER_implementations:77-78` | `:59-60`, `:139` |
| Provider omits `STATE` | `CL_DADT_SHLP_INFO_PROVIDER:48-58` | yes | call site and search for a `state =` argument |
| Signature default is `'A'` | `DDIF_SHLP_GET:4` | yes | yes |
| `A` is preserved | `LSDIFF00:47-48` | yes | yes |
| Header and parameters both use that state | `DDIF_SHLP_GET:63,71` | yes | yes |

**Both failure paths from the original review:**
- **Pending draft labelled active:** the provider explicitly asks for `A` on the only two parts it consumes, the header and the parameters. It requests no other tables, so `SHAT` and `SHCO` stay unset, including the `SHAT = 'M'` branch at `DDIF_SHLP_GET:67`.
- **Never-activated help:**
  - If `DD_SHLP_GET` reports no active version, `GOTSTATE` is initial and `DDIF_SHLP_GET:99` exits with the header already cleared at `:60`.
  - `CL_DADT_SHLP_INFO_PROVIDER:77` then stops, the GET returns an empty element, and `src/adt/search-help.ts:88-96` reports `not_available`.

### Unperformed experiment or unsupported claim?

- **Unperformed experiment:** no draft or second-user control was run, and `active-version-2026-10-31.md:36-39` says so plainly. This isn't a defect, because the label now rests on SAP's own read contract. The control I proposed earlier was one way to get evidence, not the only acceptable one.
- **Unsupported claim:** none at the level of what the SHLP's selection requests. `sourceVersion: 'active'` accurately describes what the native chain asks for.

### Remaining failure path: narrow and unproven

1. **`DD_SHLP_GET` is not in the evidence.** The chain stops at the call in `DDIF_SHLP_GET:74`, so nothing shows the body honours `get_state = 'A'`.
   - **Mechanism:** if it returned `N` or `M` for an `A` request, `DDIF_SHLP_GET:100-103` would copy the `_n` work areas. The provider doesn't import `GOTSTATE`, so neither SAP's provider nor ARC-1 would notice.
   - **Why it doesn't block:** this would mean the internal reader breaks the state request that `LSDIFF00:37-39` describes as the state to read in. Nothing in the source suggests it does.
   - **Wording issue:** `active-version-2026-10-31.md:22` says active selection is "made by SAP's native provider". Strictly, the provider requests it and the unread `DD_SHLP_GET` performs it.
2. **`dataType` and `length` may be derived after the state selection.** `DDIF_SHLP_GET:42-49` runs `DD_SHFD_ROLL_SET` and `Add_fieldinfo(RADSHACT)` with no state argument, and neither source is in the evidence.
   - **Mechanism:** the provider's refiller local class is also missing, so its mapping isn't traced either. If these helpers look up the referenced data element, an unactivated change to that data element could affect `dataType` or `length` in an otherwise active result.
   - **Why it doesn't block:** this is about a dependent object's state, not which version of the search help was selected. Import/export flags and parameter identity are untouched by this concern, unless the untraced refiller re-reads them. It's still an unknown, not a demonstrated bug.
3. **The label isn't gated by release.** `src/adt/search-help.ts:143` emits `active` on any on-prem release that passes discovery, while the qualification covers only 750 and 758. The research doc discloses this, and the same contract on both releases makes it a known limit rather than a defect.

**Optional P3, not required for merge:** capture `DD_SHLP_GET`, `DD_SHFD_ROLL_SET`, `Add_fieldinfo` and the refiller in the evidence, or add one sentence to the doc scoping "active" to the SHLP's own header and parameter selection.

## P2: both closed

**Size-limit guidance**
- The `search-help-metadata` branch at `src/handlers/dispatch.ts:222` runs before the generic limit text.
- Both size tests reject `data-preview|maxRows|WHERE`, so the old wrong message can no longer pass.
- The proxy gzip case correctly asserts the encoding guard instead.

**Transport limits**
- **One send only:** 429, 503, DB-error 500 and 302 run on both routes with default auth recovery on. The 500 body is a real trigger: it contains the string matched at `src/adt/http.ts:1172`, so that case isn't vacuous.
- **Recovery counts:** 401, 401 gives two sends, and 401, 406, 200 gives three, on both routes.
- **Configuration pins:**
  - The options are read from the correct argument position in `src/adt/search-help.ts:165-174`.
  - `limit` is a real field (`src/adt/request-attempt-budget.ts:7`).
  - The deadline bounds correctly bracket `Date.now() + 15_000`.
  - Removing `attemptBudget`, `retryTransientErrors: false` or the 15-second ceiling now fails a test, which was the gap I reported.
- **Stalled body and cancellation:** the stalled-body test now covers direct and proxy routes, and cancellation output must match `/cancelled/i`.
- **Test isolation:** `resetCachedFeatures()` runs in the unit suite's cleanup (`tests/unit/handlers/search-help.test.ts:17`), so the BTP cache set by the new tests can't leak into later ones.

The four-send ceiling is pinned as configuration rather than exercised by a fourth send. That's what I asked for, since three sends is the normal maximum.

## Dependency patch: acceptable

- Each lock changes only the version, URL and integrity of `follow-redirects`.
- No `1.16.1` tarball URL remains in either lock.
- 1.16.2 satisfies the `^1.16.0` range declared in both locks.
- No new dependency or `package.json` change appears in the patch.

I'm relying on your statement that this matches PR #1155 and that both audits passed.

## New blockers

None. I found no correctness failure in `review.patch`.

One existing behaviour is worth recording, but it isn't new and doesn't need fixing here. If `DDIF_SHLP_GET` raises an exception, the provider clears its data (`CL_DADT_SHLP_INFO_PROVIDER:59-61`), so ARC-1 reports `not_available`. The reason text names only absence and authorization or visibility, not an internal Dictionary read failure. The result is still a safe refusal with no false metadata.

The other P3 items from the first review remain optional, and I found nothing that makes any of them a correctness failure.
