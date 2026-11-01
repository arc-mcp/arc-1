# Claude design follow-up — #1008 MCP transport review

| | |
|---|---|
| Plan | `docs/plans/2026-10-18-transport-review-mcp.md`, **untracked** in `/Users/marianzeis/.codex/worktrees/transport-review-first/arc-1` (SHA-256 `985c2ed3…`) |
| Base | main **`2cb7b044`**. The branch head is `96191c62`; its implementation is mid-edit and was **not reviewed**. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-18 |
| Method | Read-only. I read the plan file plus the ADRs, contracts and code on main at a fixed commit. No edits, SAP or GitHub. |

## Verdict

**There is no architectural or security blocker beyond updating the allowlist contract.**

- Read-only `diff` fits ADR-0006's own reasoning. ADR-0006 already admits ATC and ABAP Unit as
  bounded controlled executions, and they are heavier than a bounded read fan-out.
- Historical source is not a new exposure. `SAPRead VERSIONS`/`VERSION_SOURCE` already fall under the
  default `SAPRead` read policy (`policy.ts:59`), and `SAPRead` has no multi-target action rule.

Make the change in one commit, together with the conditions below. Most of them are tests showing
that `diff` conforms to contracts that already exist.

## Conditions for enabling `diff` in multi-target

1. **Update every contract surface together.**
   - Files to change:
     - ADR-0006's reviewed-additions sentence (line 44);
     - the normative allowlist in `destination-discovered-multi-target-v1.md`;
     - the maintained table in `docs_page/multi-target-setup.md` (enforced by `btp-docs-contract.test.ts`);
     - `tools.md:1551-1553`;
     - `MULTI_TARGET_ACTION_RULES` (`multi-target-tools.ts:40`), including no longer omitting
       `offset`/`limit` and updating the comment at `:50-53`.
   - Classify `diff` as a bounded, workload-producing read like ATC/Unit, which admins can switch
     off with `SAP_DENY_ACTIONS=SAPTransport.diff`.
   - The aggregate catalogs use about 10,095 of 11,800 tokens, so the schema addition fits.
2. **Shared Basic availability.**
   - Shared Basic calls to one target run one at a time under an exclusive lease (queue 32,
     30 s acquisition timeout; `multi-target-shared-auth-state.ts:12-13,135-166`).
   - A `diff` page holds that lease for its whole duration. With a 30 s page deadline, a caller
     queued behind it times out.
   - Keep the page deadline clearly below 30 s, for example 20 s, and pin that relationship with a
     test.
3. **Error notes inside a successful result.**
   - Per-part notes carry `AdtApiError`'s cleaned SAP text and bypass
     `classifyMultiTargetSapError`.
   - ADR-0007 limits client-facing errors to safe codes.
   - On multi-target routes, force the minimal note (status or safe code only). Test it with a
     part-level 403 that has a SAP or Cloud Connector body.
4. **Authentication failure.** Main already prevents lockout:
   - shared Basic sends are serialized;
   - after the first 401, later requests fail locally (`http.ts:372-378`);
   - the post-dispatch hook replaces the result with the shared-auth error
     (`multi-target-basic-auth.ts:318-330`).

   Add a test: a 401 on the third read causes no further SAP sends and returns that error, not a
   page of unavailable rows. Preferably also end the `diff` loop on the first 401 instead of turning
   it into rows; that helps principal-propagation routes too.
5. **Cancellation releases the lease.** Cancel a call partway through a page:
   - the loop stops within one read;
   - `runExclusive` releases the lease;
   - a queued caller then proceeds.

   Test this.
6. **BTP ABAP targets.**
   - `VERSIONS` and `VERSION_SOURCE` are `btp: false` (`tool-registry.ts:111-112`).
   - Copy the existing `long_text` guard (`multi-target-tools.ts:110`): refuse `diff` when
     `systemType` is `btp`.
   - Keep the guard until a read-only feed probe qualifies BTP ABAP.
7. **Tests.**
   - The ones you already planned: route, identity, scope, deny and cancellation.
   - In addition:
     - an ADR-0008 target-authorization refusal before any SAP contact;
     - the aggregate endpoint requiring an explicit `target`;
     - audit events carrying target and identity.

**Checked and not issues:**

- `SAPTransport.diff` is read scope and read operation type (`policy.ts:178`), which the multi-target
  ceiling already allows.
- Its transport feature gate is already resolved per target for list/get.
- **Sequential reads are the right choice in a shared process:** each call holds at most one
  semaphore slot. I withdraw my earlier suggestion to read class parts in parallel.

## Your two deliberate differences

1. **Keeping speculative 404s explicit is acceptable**, under these conditions:
   - give them a fixed note that differs from read failures, for example "not found by speculative
     probe; absence not proven", so an LLM doesn't report normal missing includes as errors;
   - emit no hunks for them;
   - test that their wording differs from a 404 on a CTS-selected part.
2. **Keeping labelled hunks for unattributed active comparisons is acceptable only for open
   requests**, where the active state is what will ship:
   - put a fixed "candidate, not attributed to this transport" label at the start of the row;
   - never show unattributed hunks for released requests;
   - test both the open and released cases;
   - keep the counts separate from attributed changes, within the 64 KiB cap.

Keeping small separate modules is fine, as long as no paths that served only the CLI survive:
`structured` output, hashes or continuation.

## Limitations

- This covers the plan and main only. The mid-edit implementation is not reviewed.
- No SAP or GitHub access.
