# Claude Code follow-up review: corrected write-parity plans

Date: 26 October 2026. Claude Code 2.1.308, model `claude-opus-5-5`, requested effort `max`.
The returned model usage confirms the exact model. Effort is established by the invoked CLI
argument; the reviewer cannot independently observe that setting.

The review completed successfully in 20 turns / 12.3 minutes, with no permission denials.
Read, Grep and Glob were the only available tools; restricted mode, empty strict MCP configuration,
disabled hooks, no shell/edit tools and no session persistence were used. No tests or live SAP
calls were made. The following input hashes were verified unchanged when the report completed.

Code baseline: `e538bf71197ddb47ea74aca225c340a856d331af`.

| File | SHA-256 |
| --- | --- |
| `docs/plans/2026-10-26-shared-mutation-infrastructure.md` | `769542fbf788cd8fc89a41acd8b360c1e1c8fb8b90eac1f2bf94bfb16db7b874` |
| `docs/plans/2026-10-26-broader-pinned-pp-writes.md` | `78ebb95e9c07de1ac6678abb152b1ecf35d2ca6962479f1a8437907c35ea40f3` |
| `docs/research/2026-10-26-multi-target-write-parity.md` | `5ca561cbc61711c25c3012ff608244268a63f6668776fc12d585afb977e47b2f` |
| `docs/research/multi-target-write-parity/review-dispositions.md` | `942b1a1ae40804569e5003ecd0be40b349d169c158006f243ef4f3e21a30ff82` |
| `docs/research/multi-target-write-parity/claude-followup-prompt.md` | `b126053feb284cb6ab0c698adc1f32264b1c605403e67ef678f5582301f43539` |

The original report below is preserved verbatim. Both plans were found suitable to guide
implementation; four small corrections remained. Their subsequent author-applied changes are
recorded in [review dispositions](review-dispositions.md), not presented as independently rereviewed.

## Original report

# Follow-up review: the corrected multi-target write plans

Static review at `e538bf71` of the working-tree dispositions and the three revised documents. Model `claude-opus-5-5`; I can't observe the effort setting from inside the session. I used only Read, Grep and Glob: 7 source-file reads plus targeted greps. I ran no commands or tests, edited nothing and made no external calls. These tools can't compute hashes, so please record SHA-256 for the four reviewed documents when you file this.

## Verdict

- **PR 1 can guide implementation as written.**
- **PR 2 can guide implementation.** None of the five areas still has a planning blocker, and the F1–F14 corrections check out against the code.
- Four small corrections remain. Correction 1 should land before P2-D. Corrections 2–4 are edits to the identity inventory, the text-pool confirmation rule and the gate list.

## Area results

**1. Context, facade and orchestration: confirmed, with one gap.**
- The scoped facade is necessary. `activate()` and CTS release build their own per-call options (`devtools.ts:182-189, 215`; `adt/transport.ts:703-710`). So the rule that a nested adapter "cannot weaken" the policy has to mean the strictest deadline wins and no-replay can't be overridden. The plan states this.
- Single-target defaults are explicitly preserved: no request options where there are none today, and the legacy unlock-error precedence.
- Removal of the write orchestrator is clearly planned. The activation orchestrator is not covered (Correction 1).

**2. CTS: confirmed.**
- The `allowedTransports=[]` trap is named correctly (`safety.ts:336-356`).
- Only CTS code paths call `checkTransport(isWrite=true)`. The new branch therefore can't put source recording behind the transport switch.
- `resolveCreateTransport` only picks a request SAP already reports; it never creates one (`create-transport.ts:29`). The only ARC-1 code that creates requests is `SAPTransport.create` (`handlers/transport.ts:298, 328`).
- The existing frozen-tree structure fits the parent-grant model. It already records an intended task list and reports children that appear mid-call (`adt/transport.ts:589-631, 666-672`).
- These are implementation notes, not blockers:
  - On pinned routes, the handler pre-checks at `handlers/transport.ts:425, 496` must only check capability, because no tree has been resolved yet when they run.
  - `prepareTransportRelease` reads the tree again (`:654`) after the adapter has frozen it. Either use a single freeze point, or let a child that appears in between fail closed.
  - Derive `allowTransportWrites` in the same work package as the new guard branches (P2-F), especially if PR 2 is split into stacked PRs.

**3. Text-pool exception and identity inventory: confirmed, with Corrections 2 and 3.**
- The exception targets the real conflict: `text-elements.ts:250` against `devtools.ts:228-232`.
- With `preaudit=false`, `activate` never acts on additional references SAP returns (`devtools.ts:255`).
- Every other `getEffectiveUser`/`client.username` call site matches the planned inventory. The user-based cache keys (`cache-security.ts:64`, `inactive-list-cache.ts:15`) are never sent to SAP.

**4. Transport scope, companion reads, budgets and ST05: confirmed.**
- These are consistent with each other and with the code:
  - the role-merge text, both truth tables and the upgrade note;
  - the rule for exposing new companion reads;
  - the starting caps (10 objects, 20 owners, 100 references);
  - the 300-second release cap and the explicit routing package.
- One ST05 detail is listed under the evidence gates below.

**5. Implicit recording, formatter and partial/unknown outcomes: specified in PR 2, but not listed as named gates** (Correction 4).

## Corrections

1. **One pinned activation path.** Anchors: PR 2 §4 "Activation and batches" `:266-277` and §7 P2-D `:441`.
   - `handlePinnedActivation` (`src/handlers/write/pinned-activation.ts:29-79`) is a second dedicated pinned orchestrator:
     - its validator accepts only CLAS/INTF owners and their includes, with at most 5 references (`:13-27`);
     - it refuses `objects`, any action other than `activate`, and `preaudit=false` (`:36-37`).
   - PR 2's SAPActivate rows (other owners, batches, publish/unpublish) can't run through it.
   - State that it is either replaced by, or becomes, the single generalized pinned activation adapter. SAPActivate and every nested caller (batch create, text pools, RAP, server-driven objects) should use that adapter with one reference validator. Keep refusing the public `preaudit=false` input.
   - Without this, the overlap F9 found returns on the activation side.

2. **Package `responsible` in the identity inventory.** Anchor: PR 2 `:187-189`.
   - `create_package` is the one call site where the user field can't be omitted: on-prem, SAP rejects an empty `adtcore:responsible` for packages (`manage.ts:159-162`).
   - Its default comes from `config.username` (`:165`), not `getEffectiveUser()`.
   - Add it to the inventory explicitly: pinned routes require an explicit `responsible`. Document that SAP checks the user exists, not that it is the caller.

3. **Text-pool confirmation rule.** Anchor: PR 2 `:256-263`.
   - SAP refuses activation while the pool is locked (`text-elements.ts:141-142`), so activation always runs after unlock (`:188-207`).
   - `readTextPoolState` proves only the pool's metadata and version (`:219-238`). It does not prove that the activated content is what ARC-1 saved.
   - Define positive evidence as: the version is active, **and** the active part equals the saved readback wherever SAP supports a version-specific read. Otherwise report "saved, activation unconfirmed".
   - The qualification run must also check that the owner's unrelated inactive objects are still inactive afterwards.

4. **Named gate list.** Anchor: research gate table `:127-135`.
   - These items are specified in PR 2 (`:296-302`, `:395-409`, §8) but are missing from the gate table:
     - implicit recording: API-state `request=`, package-move preview side effects and the request it selects, publication, and FLP automatic customizing recording;
     - formatter scope and preservation of unchanged fields;
     - the exact-text-pool activation;
     - ST05's all-users encoding;
     - the budget constants;
     - partial/unknown outcomes.
   - Add a row for each, with what happens if the evidence is missing.

## Remaining evidence gates (implementation validation, not planning)

- **Text pools:** 750/758/816; a never-activated PROG; an empty CLAS/FUGR pool that SAP leaves inactive despite reporting success (`text-elements.ts:287`).
- **Identity:**
  - for each object type, show that omitting `responsible` or `tm:owner` makes SAP use the mapped user;
  - establish whether `tm:owner` is optional;
  - add negative tests with a second identity.
- **FLP recording:** FLP has no preview step, and no new destination attribute is planned. The outcome is one of:
  - a native signal that can be checked before the mutation;
  - proof that SAP itself refuses unrecorded changes;
  - FLP stays a named gap.
  
  An operator declaring that recording is off is not an option.
- **API state, package move, publication:** which request SAP selects, and whether the preview step has side effects.
- **ST05:**
  - the native all-users representation;
  - whether the `user` field accepts patterns. If it does, treat a pattern as an all-users request or refuse it, so the `allUsers` exclusivity can't be bypassed;
  - readback across instances, and restoring the prior state.
- **Formatter:** whether settings are per user or system-wide, and which document shapes are recognized.
- **Budgets:** final caps from measured cost, including recursive CTS operations on large trees within 300 seconds.
- **No replay:** for each enabled operation, assertions on the outgoing requests at the HTTP layer, plus injected failures.
- **CTS live:** a route with no downstream import, and concurrent children being included in a parent release.
- **OAuth:** a fresh token, and a test that proves the documented role-merge behaviour.
