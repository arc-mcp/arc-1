# Independent private publication review

**Candidate:** `612c4ee36b155fc97f4aa744b2227048590850a9`  
**Base:** `e7d6156483ec6c78d1412cb90fd9fb04921f3eea`  
**Verdict:** **NO-GO for private integration until F1 below is corrected.** No native, PP, public-admission or whole-PR approval is given.

This is an independent Codex fallback functional/source review. I did not author this candidate. My separate declarative recovery authorship is unrelated. The immutable snapshot utility produced 4,711 bound files; the first reviewer source action and final source action both verified all 4,711 unchanged. Source, diff and dependencies were not edited; probes, configuration, logs and this report are outside `source/`. No SAP/native/browser/credential/.env/external-network/install/delegation/push action was performed. Existing tests and probes used mocked HTTP; the expiry probe uses the actual client and semaphore implementation, not a substituted POST method.

## F1 — [P2] Carry native-configuration expiry through the HTTP queue

**Location:** `src/adt/publication-profile.ts:86–91`, with the discarded freshness bound in `src/adt/pinned-publication-execute.ts:151–160`.

The executor establishes a native configuration observation with a 30-second maximum age and rechecks that age after the final metadata reads. However, `beforeSubmit()` returns no expiry, and the shared sender passes only `grant.context.requestPolicy` to `http.post`. That policy can live for five minutes. `AdtHttpClient.request()` can then await the real semaphore before `requestInner()` or later await authentication preparation. Those stages honor the outer deadline, not the earlier configuration observation's expiry.

A reproducible queued request sends after its qualification is stale:

1. Use the real `AdtHttpClient` with `Semaphore(1)` and a five-minute pinned context, with fake transport/configuration responses.
2. Immediately after the fourth metadata GET finishes (the final active read), occupy the semaphore slot as an unrelated request would.
3. Wait until the publication POST is queued. No POST has reached mocked fetch yet.
4. Advance the clock by 31,000 ms, then release the slot.
5. The existing implementation sends **one POST** and reports **`ok:true`, `state:"complete"`, item `state:"confirmed"`**, despite the configuration evidence being older than its 30-second bound before the write reaches transport.

The failing assertion expects zero POSTs. Raw reproduction: `reviewer-expiry-reproduction.log`; executable probe: `reviewer-probes.test.ts`, test **`review: configuration freshness must survive the real HTTP semaphore wait before POST`**. It failed against the unmodified snapshot; no native request was made.

**Correction:** retain the final observation's `observedAt + 30_000` in the one-shot authority and enforce it through actual request preparation/queueing (for example, narrow the job request's deadline to that expiry and the outer deadline), or revalidate at the real send boundary without expanding scope or replaying. Do not merely reset the observation timestamp or refresh its lifetime without new evidence. Keep the grant consumed and outcomes conservative if the request expires. Add delayed-semaphore and delayed-auth-preparation regressions that prove no expired POST reaches transport and no retry follows. This is enforcement of the chosen expiry, not a requirement for a universal atomic configuration snapshot.

No other integration-blocking finding was identified in the reviewed scope.

## What passed review

- Shared sender extraction preserves the legacy parser/defaults/MIME fallback, with compatibility exports from `devtools.ts`. Low-level legacy entrypoints now refuse pinned policy without registered authority. The private sender supplies one fixed V4 object reference and ASXML request, with no legacy second POST, transient/auth negotiation replay or invented async poll.
- Opaque authority is bound to the exact mutation transport, safety/context, action, binding and version, and consumed before awaits. Forged, foreign-client/safety, cancelled, expired-outer-context, concurrent and reused grants refuse. The finding concerns the shorter native-configuration lease, not the existing outer deadline or single-use property.
- The private path validates all input selections before native reads, preauthorizes every owner/package before its first POST and revalidates each binding. Binding-level deduplication, 1–10 bounds, complete active membership up to 100 pairs, explicit selector-version validation and binding-wide availability effects are retained. The source-qualified non-recording on-premise V4 path does not need an invented CTS request or transport-management scope.
- HTTP 200 native ERROR remains failure. Unknown/empty/spoofed/duplicate/structured status is unconfirmed; successful status followed by failed or changed readback stays acknowledged-unverified. Earlier confirmed/no-op outcomes and unsubmitted remainder survive later failures. No compensation, rollback or exhaustive absence claim is introduced.
- Publication comparison omits only the named root bookkeeping attributes; full metadata hashes and nested opaque differences remain significant. Existing SRVB reads and generated-binding deletion restrictions remain unchanged.
- Public capability/schema/raw dispatch stay closed. The trusted current-principal configuration reader is an internal contract with **no production implementation**; tests cannot establish actual principal/cloud/client-category facts. Missing production reader, native generated-owner cleanup, supported wire/readback qualification, current-code two-writer PP and public admission remain explicit future gates. They are not falsely claimed implemented, nor new surprise defects in this private candidate.

## Exact reviewer checks

All used installed Node 22.21.1 and existing dependencies.

| Check | Result |
|---|---|
| First snapshot verifier | 4,711 files unchanged, exact candidate revision |
| `vitest run --config ../baseline.config.mjs` | **3 files / 269 tests passed**: devtools 188, SRVB 35, publication 46; `reviewer-baseline.log` |
| Additional targeted adversarial probes | **17 passed** (46 copied baseline cases intentionally filtered out); `reviewer-probes.log` |
| Shorter-lease semaphore regression | **1 failed as described**, proving one expired POST and a confirmed result; `reviewer-expiry-reproduction.log` |
| `npm run typecheck` | All three TypeScript projects passed |
| `npm run validate:policy` | 135 policy entries / 14 tool schemas passed |
| `npm run check:sizes` | Tracked file ratchet and all schema scenarios passed |
| Final snapshot verifier | **4,711 files unchanged**; `reviewer-snapshot-final.log` |

Static check output is in `reviewer-gates.log`. The 17 additional passing cases cover native status ambiguity; complete-input rejection before reads; membership bounds; exact grant ownership/outer expiry/cancellation; nested opaque hash preservation; no-op-plus-later-failure partial results; and post-submit cancellation. The final full suite, build, lint, docs and 59 historical scenarios were author-reported; I did not repeat them because the independently reproduced defect is localized and targeted coverage already establishes it.

The roadmap was read at start and completion. Its remaining production-reader/native/PP/admission limits remain accurate; this review made no roadmap/source edit. The private source assessment was used to distinguish synchronous, binding-wide, non-recording V4 semantics from unsupported cloud/V2 and guessed polling/recording contracts. No proprietary raw SAP source is reproduced here.
