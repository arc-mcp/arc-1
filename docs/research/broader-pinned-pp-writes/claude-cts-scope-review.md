Review completed 31 October 2026 using actual Claude Code `claude-opus-5-5`, effort `max`, read-only tools, hooks/MCP disabled. Reviewed the initial CTS-scope patch; subsequent fixes are outside this review. The 31 October checkpoint records fixes and follow-up review status.

Six findings: one High, one Medium and four Low. They all come from reading the code; I ran nothing.

## Findings

**1. High: recursive delete and reassign can mutate before refusing a new child**
`src/adt/transport.ts:1040`, `src/adt/transport.ts:1120`

The guard runs per task, between submissions. If the second read returns `[task, other]`, the `DELETE` for `task` (or its remove-object or owner-change `PUT`) is sent before `other` is refused. That breaks the rule that new children fail before submission, and the delete is irreversible. Recursive release gets this right by checking the whole set first (`src/adt/transport.ts:661`).

`tests/unit/adt/pinned-transport-scope.test.ts:217` misses this because its second read returns only `other`, so the refusal lands on the first iteration.

**Fix:** check every non-released task before the first submission in both functions. Add `task` + `other` tests asserting no `delete` or `put` calls, including with `removeLockedObjects=true`. Gate this on `safety.multiTargetWrite` if single-target ordering must stay identical.

**2. Medium: the scope isn't bound to what the caller selected**
`src/adt/pinned-transport-scope.ts:148`, `src/adt/pinned-transport-scope.ts:175`

`requestedId` isn't stored, so the guard accepts any tree member, and the tests only try outsiders (`tests/unit/adt/pinned-transport-scope.test.ts:85`):
- **`delete` on a task:** also passes `deleteTransport(prepared.http, prepared.safety, prepared.parentId, true, true)`, which deletes the whole request.
- **`reassign` on a task:** admits the parent and sibling tasks.
- **`release` on a parent:** admits its tasks.
- **`delete` in general:** admits a standalone `removeObjectFromTransport` (`src/adt/pinned-transport-scope.ts:16`).

The parent policy still holds, so this isn't a policy bypass. But this guard is the last check against an adapter mix-up, and the widening reaches destructive operations.

**Fix:** keep `verifiedIds` for reporting and add a narrower submittable set:
- Allow only `requestedId` for `release` and for any task-selected action.
- Allow the whole tree only when the parent was selected.
- Exempt `remove_object`, because it has to walk the parent's tasks.
- Give delete's internal cleanup its own operation name, which closes the last case above.

**3. Low: contradictory parent evidence is dropped**
`src/adt/pinned-transport-scope.ts:109`

Root-level tasks are filtered to those claiming this parent, so `<request P><task T/></request><task T parent=X/>` is accepted as T in P. The conflict check at `src/adt/pinned-transport-scope.ts:115` never sees that entry, and `tests/unit/adt/pinned-transport-scope.test.ts:139` only covers nested tasks.

**Fix:** refuse any root-level task whose number is in `ids` but whose parent differs.

**4. Low: the release wait loop ignores the context's cancellation and deadline**
`src/adt/transport.ts:696`, `src/adt/transport.ts:885`, `src/adt/transport.ts:794`

The stop conditions read only the wait options. With default options, once the context is cancelled or expires, each poll fails locally and is treated as transient (`src/adt/transport.ts:851`). The loop then retries until its own 300-second limit. No SAP traffic or mutation gets through, but the tool call outlives its budget.

Also, `submit` records a pre-send refusal (`src/adt/transport.ts:441`) as "submission outcome is uncertain" when nothing was sent.

**Fix:** merge the scope's deadline and signal into the effective budget, or make passing them a tested adapter requirement. Record these refusals as not sent.

**5. Low: the CTS parsers disagree on membership, and no test uses a real document**
`src/adt/pinned-transport-scope.ts:85`, `src/adt/pinned-transport-scope.ts:109`, `src/adt/transport.ts:1413`

- **Root-level tasks:** `parseTransportList` reads only nested tasks, while `resolveTree` also counts root-level ones. Recursive delete and reassign skip a child proven only at root level, and reassign still returns normally.
- **Standalone tasks:** `readTree` requires `tm:root`, but `parseTransportNodeStates` deliberately supports a standalone `<tm:task>` (`src/adt/transport.ts:476`, `tests/unit/adt/transport.test.ts:1209`).
- **Empty parent:** if SAP sends `tm:parent=""` on a nested task, the whole tree is refused at `src/adt/pinned-transport-scope.ts:115`.

The last two only cause false refusals, not unsafe writes.

**Fix:** run the helper against `tests/fixtures/xml/transport-released-a4h-758.xml`, and make recursive delete and reassign use the same membership as the freeze.

**6. Low: new runtime import cycles through `safety.ts`**
`src/adt/safety.ts:26`, `src/adt/transport.ts:11`, `src/adt/pinned-transport-scope.ts:8`

`safety.ts` was nearly a leaf, and `src/adt/safety.ts:399` even inlines code to avoid a cycle. Importing it first now evaluates `transport.ts` and `pinned-write-policy.ts` before `OperationType` is initialised. Every cross-cycle use I read is inside a function, so nothing breaks today. A future top-level use would crash only on some import orders.

**Fix:**
- Move the WeakMap and guard into a leaf module.
- Move `isTransportInWhitelist` and `checkPinnedRequest` into a leaf policy module.
- Leave `preparePinnedTransport` above `transport.ts`.
- If the cycle stays, add a test that imports each member first in a fresh module graph.

## Checked, no finding
- **Existing recording:** `src/adt/pinned-write-policy.ts` never calls `checkTransport`, `getTransportInfo` uses the read gate (`src/adt/transport.ts:1201`), and single-target calls skip the new branch (`src/adt/safety.ts:356`).
- **Read whitelist:** the read branch is unchanged, and multi-target keeps `allowedTransports: []` for reads (`src/server/multi-target-runtime.ts:121`).
- **`noReplay` and per-request deadlines:** the guard requires the facade's identity, so gated writes and their reads compose the policy, including `postCreate` and the release POST.
- **Forgeability and wrong client:** copies, JSON round trips, `withSafety` clones, raw clients, session facades and mismatched contexts are all refused.
- **Policy and create:** only the canonical parent is authorized, against both lists independently. Create admission matches the plan and honours deny-all.
- **Malformed shapes:** multiple roots, non-object nodes, duplicates, self-parents, task-of-task chains, bad IDs, oversize documents and more than 256 tasks are refused.
- **Cancellation at gates:** every gate re-checks the signal and deadline before sending.
- **Types and states:** the helper makes no such claim (`src/adt/pinned-transport-scope.ts:90`).

## Two scope claims to adjust
- **"Every ADT transport write gate receives HTTP":** this is true inside `src/adt`, but `src/handlers/transport.ts:425` and `src/handlers/transport.ts:496` still omit it. They refuse pinned calls, so the adapter must replace them when it's wired.
- **"No new capability":** confirmed, because `preparePinnedTransport` has no caller in `src/`, so every pinned CTS write throws. I couldn't confirm the "flag disabled" part: `src/server/multi-target-runtime.ts:48` looks like a pass-through and I didn't read around it. This doesn't change the result.

## Verdict
**Don't build on this chunk until #1 is fixed, and #2 should go in with it.** The authorization core is sound: scopes can't be forged, the parent is checked against both policies, and nothing is exposed at runtime. #3 to #6 can follow separately.

## Limits
- **Hashes:** I didn't recompute the `manifest.json` hashes because this session has no hashing tool. The tracked-file sections I read match `diff.patch`.
- **Read budget:** I used all 25 reads. I never saw the matching line in the a4h fixture (the search output omitted it as too long), so #5 is untested against it. I also didn't read `revision-feed.ts` or `release.ts` for the cycle check in #6.