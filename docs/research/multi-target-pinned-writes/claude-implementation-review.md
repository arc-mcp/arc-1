# Claude implementation review and dispositions

Reviews used Claude Code 2.1.299, model `claude-opus-5-5`, effort `max`, with read-only
Read/Grep/Glob tools, hooks/MCP/browser tools disabled, and immutable source snapshots.
The reviewer did not execute tests; live and automated validation below belongs to the implementer.

## Broad review — a68537d5

Initial verdict: not ready. No bypass of the required global/destination/PP/raw-scope/exact-target
gates was identified. Findings were addressed in `ef2b14c7` and `293cbaf2` as follows.

| Finding | Disposition |
|---|---|
| Global CTS restriction affected multi-target reads | Runtime read ceiling stays unrestricted; server CTS write policy is carried only in the required internal write context. Unit tests cover aggregate, Basic, reader and writer runtimes; live out-of-policy CTS read succeeded and save was refused. |
| No-replay client setting altered ordinary reads | Required scoped operations carry per-request noReplay. Ordinary reads retain legacy retries; tested with a transient backend failure. |
| Definitive SAP rejections reported unknown | 400/401/403/404/409/412/415/422/423 report rejected phase; created-stub state remains explicit. Network/429/5xx stay unknown. No automatic replay. |
| Short cleanup budget and overclaimed closure | Independent 30-second cleanup budget, actual close acknowledgement, and verified saved hash preserved on cleanup errors. Legacy cleanup behavior retained. Fault coverage is controlled, not live failure injection. |
| Ambiguous CTS lock evidence | Exhaustive holder parsing refuses conflicting parents/orphan tasks; every reported task must appear exactly once in the independently verified canonical parent tree (the final refinement avoids redundant task lookups). |
| Missing adjacent low-level operation checks | Explicit Create and Update guards immediately before metadata POST and source PUT. |
| Stale guides and missing setup example | Operator pages aligned; fictional MTA chain/destination parser-tested and MBT-validated; whole-owner activation, IAM setup, policy precedence and recovery documented. Final ADR acceptance follows final review. |
| Role-template scope reach | Guide explicitly requires enforced multi-target mode before assignment and warns that functional scopes are application-wide in other modes/apps. |
| Incomplete live matrix | Full local/CTS CLAS/INTF lifecycle, exact SAP author, raw read-only token and negative second-user isolation recorded. One positive SAP writer only; expanded confirmation and faults remain controlled-wire evidence. |
| Pinned schema/lint advice inherited unsupported choices | Pinned field descriptions explain required package/hash/CTS and unavailable local methods; lint refusal offers administrator policy review, not a forbidden per-call override. |
| Profile derivation dropped internal write context | Internal policy is preserved by profile narrowing. |

## Follow-up — ef2b14c7

The reviewer confirmed source normalization preserves non-normalized bytes, task-parent membership
fails closed, and unqualified activation responses cannot become success. It found quadratic
trailing-newline matching; `293cbaf2` replaces it with a linear backwards scan and covers 50,000
interior newlines. Bounded SAP activation messages are retained, catalog reason cases are tested,
and the maximum reason string is shared with the budget test.

Live activation of an already-active owner on 758 returned activation-not-confirmed, now documented.
The analogous pre-existing Gateway source trimming issue was separated into
[PR #1084](https://github.com/arc-mcp/arc-1/pull/1084). The CF packaging issue is
[PR #1082](https://github.com/arc-mcp/arc-1/pull/1082). Neither fix is part of this feature diff.

## Final review — 293cbaf2

The reviewer found no security regression and accepted the core fixes, conditional on the live
retest, governance updates and released-task handling. It identified N1 (released historical tasks),
N2 (legacy lock display order), N3 (refusal code consistency), N4 (server CTS ceiling test gap),
N5 (remaining wording), and the Cockpit role description. The follow-up fixes all six: caller task
selection retains status D, historical lock tasks use exact parent-tree membership without extra
lookups, document order is preserved, refusal codes match states, positive/negative server-ceiling
and PRM tests were added, and remaining operator/model/Cockpit wording was corrected.
Full suite at `0632606a`: 10,054 passing tests. The narrow review accepted all security/correctness fixes; the live retest passed (details below).
Live retest and limitations:
[qualification record](../2026-10-22-multi-target-write-qualification.md).

## Narrow acceptance review — 0632606a

Claude Code Opus 5.5 max completed a 48-turn, 10.8-minute read-only review of the last fixes.
It accepted N1–N4 and S6 with **no new correctness or security blocker**, conditional on the live
run and explicit governance/evidence qualifications. The exact 0632606a artifact then passed all
six local/CTS owner lifecycles and the independent server CTS ceiling test; XSUAA's live role
metadata confirmed the new warning. A bounded read-only search of five existing requests found
no released-task example; that shape remains controlled-wire coverage, explicitly accepted as a
residual limit in ADR-0010.

Nonblocking suggestions were also applied: unchanged/preflight failures now say no create/save
was sent, failure-code assertions and a released-task CORRNR case were added, selected-task
assertions name the exact rejection, method-source schema text includes METHOD…ENDMETHOD blocks,
and OAuth metadata/README wording matches the implementation. These final message/schema-text
and test/documentation changes do not alter the live-qualified policy or mutation sequence.

## Original reviewer reports

### Broad review

# Review: PR #1080 at a68537d5 (pinned PP multi-target writes)

**Verdict: no-go to merge at this revision.** I found no way for a caller to write outside the intended gates. A write requires all of these:
- a pinned route
- target-filtered mode
- PP, not Basic
- the global switch plus the destination opt-in
- the verified *raw* `write` scope (captured before admin expansion)
- the access grant plus the exact write grant

Aggregate, the `/authorize` alias, Basic, standard mode, an admin-only token, a read-scope-only token and "write A / read B" all fail closed at three independent layers: the runtime config, `pinnedMutationAllowed`, and the handler/safety check. The other core controls also hold:
- both package lists are checked against the real package, again under the lock;
- task IDs are canonicalized to the parent request, and both lists check the parent;
- the lock must report `IS_LOCAL`/`CORRNR` consistent with preflight;
- the source hash is checked under the lock;
- low-level activation refuses without a validator, and batch activation refuses;
- the drift fingerprint includes the write policy.

Turning on `allowWrites` does not unlock any hidden mutation in the read tools; the mutating `SAPDiagnose` actions are not on the multi-target allowlist.

The blockers are a read regression, contradicting governance docs, and the open live qualification. Everything below comes from reading code; nothing was executed. The `@arc-mcp/xsuaa-auth` internals are not in the snapshot.

## Blockers

### B1: Multi-target transport reads regress, including aggregate and Basic routes
- **Where:** `src/server/multi-target-runtime.ts:117-118` copies `base.allowedTransports` (and packages) into every runtime, whatever the mode or grant. Before this PR the list was always `[]` (`src/server/destination-registry.ts:909-921`).
- **Why it matters:** `checkTransport` applies the whitelist to reads (`src/adt/safety.ts:348-355`) through `getTransport` (`src/adt/transport.ts:174`), which `SAPTransport` `get`/`diff` call (`src/handlers/transport.ts:255`, `src/handlers/transport-review.ts:18`).
- **Trigger:** follow the new guide (`SAP_ALLOWED_TRANSPORTS: "DEVK9*"`), then call `SAPTransport(action="diff", id="QASK900045")` on `/multi/mcp` or the read-only QAS route. The call is blocked.
- **Also hits:** upgraded standard-mode deployments that set this list only for a side-by-side `/mcp`. This breaks "Basic reads unchanged" and plan §3.
- **Fix:**
  - Keep `allowedTransports: []` in multi-target runtimes.
  - Carry the server list in `MultiTargetWritePolicy` (for example `serverAllowedTransports`) and use it only in `checkPinnedRequest` (`src/adt/pinned-write-policy.ts:28-35`).
  - Add runtime tests for aggregate, Basic, read-only and writable pinned routes with a non-empty global list.

### B2: Normative docs and governance contradict the shipped code
- **AGENTS.md:** `AGENTS.md:23-27` and `:389-397` forbid multi-target writes without an accepted ADR. `:126`, `:149`, `:206`, `:313` and `:399` are also stale.
- **ADR-0010:** still "Proposed" (`docs/adr/0010-pinned-pp-multi-target-writes.md:3`). Its acceptance rules (`:56-62`) require a new `docs/security-model.md` risk entry, which is missing.
- **Operator docs that still say multi-target is mutation-free:**
  - `docs_page/btp-overview.md:42-53`
  - `docs_page/btp-cloud-foundry-deployment.md:7-9, 580, 616-617`
  - `docs_page/deployment-best-practices.md:8, 17`
  - `docs_page/enterprise-auth.md:56`
  - `docs_page/security-guide.md:226`
  - `docs_page/xsuaa-setup.md:154, 178` (no `MCPTargetDeveloper` either)
  - `docs_page/arc-1-vs-sap-abap-mcp-server.md:103, 482`
  - `docs_page/roadmap.md:171-184` (FEAT-93 still "Needs research")
  - `examples/btp/multi-pp/README.md:4`
  - the quarantine message at `src/server/destination-registry.ts:293`
- **Missing artifact:** the plan requires a complete, validated writable example, but `examples/btp/multi-pp/` is unchanged.
- **Fix:**
  - Accept ADR-0010 once the evidence is in.
  - Add the security-model risk row: retained refresh grants, whole-owner activation, asynchronous audit, and code execution via written code plus ABAP Unit.
  - Update AGENTS.md and the docs above.
  - Ship a validated mtaext plus destination example.

### B3: Live qualification does not yet cover the advertised scope
The deployed MCP artifact has evidence only for a local CLAS create/save. A re-run after the CRLF fix is not recorded. Still missing on the frozen artifact:
- Transportable create, update and edit_method, with both request and task input, including the observed `recording=false, local=false` shape.
- INTF.
- Update/edit_method using a hash taken from `SAPRead(format="editable")`.
- Activation, local and transportable.
- A real SAP preaudit confirmation response, or an explicit decision to accept fail-closed when SAP prompts.
- The HTTP negative matrix: aggregate, `/authorize`, Basic, write B, read-only token, admin-only scope, and omitted-action deny.
- Lock release after an injected failure.
- A second SAP identity.
- A repeat of the refresh-revocation test.

## Fix before merge

### S1: No-replay mode applies to the whole client, not just mutations
- **Where:** `src/server/server.ts:245-246`. With it, `src/adt/http.ts:388, 530, 694, 762, 785-789, 952` disable the 401, CSRF, negotiation and 503/429/DB retries for **every** request of a write-granted user.
- **Scope of impact:** that covers every read tool on that user's pinned connection and the shared per-target feature probe (`src/server/server.ts:864-873`). The probe result is cached for all users of the target (`src/handlers/feature-cache.ts:79-97`), and a 503/406 "unavailable" is kept.
- **Trigger:** a read needing 406 fallback, or one transient 503, fails for a writer but not for a reader. If a writer makes the first call after a restart, that failure can be cached for every user of the target.
- **Fix:**
  - Add a per-request no-replay option, used only for create, lock, PUT, unlock, activation and CTS preflight (or a strict client inside `withStatefulSession`).
  - Leave the per-user client's defaults alone.
  - Test that read behavior is identical on writable and read-only routes.

### S2: Definitive SAP rejections are reported as unknown
- **Where:** `src/handlers/write/pinned.ts:116, 161, 207` with `:25-48`. Every create/PUT failure becomes `creation-unknown`/`source-save-unknown` with `PINNED_WRITE_INCOMPLETE`, including 400/403/409/423.
- **Regression:** `postCreate` treats only 429/5xx/network as unknown (`src/adt/create-request.ts:15-21`).
- **Lost diagnostics:** unchanged-state failures (lock conflict, 404, authorization) get "SAP did not confirm the complete operation" and lose the dispatch classification (`src/handlers/dispatch.ts:745-819`).
- **Trigger:** creating an existing name returns 400, which is reported as a possible stub.
- **Fix:**
  - Report unknown only for network, 429, 5xx and abort after send.
  - Report 4xx as rejected, keeping the precise state.
  - Include a safe classification code.

### S3: Cleanup can leak the lock, and the payload overclaims
- **Budget:** unlock (`pinned.ts:179-185`) and session close (`http.ts:327, 338`) each get 5 s, and that includes waiting for the shared semaphore (`http.ts:362-366`).
- **Swallowed failure:** a failed session close is only logged (`http.ts:340-347`), yet the payload says "the owning session was closed" (`pinned.ts:43`).
- **Lost hash:** the `cleanupFailed` result drops the saved `sourceHash` (`pinned.ts:192`).
- **Trigger:** if `ARC1_MAX_CONCURRENT` stays saturated for more than 5 s, neither unlock nor close is sent. The object stays locked until the SAP session times out.
- **Fix:** give cleanup a reserved semaphore slot or a larger budget. Report session closure as `true`/`false`, and return the hash when the save completed.

### S4: Ambiguous CTS lock evidence is accepted
- **Where:** `src/adt/pinned-write-policy.ts:84-105`. The parser keeps only the first lock holder's `REQ_HEADER` but collects tasks from all holders (`src/adt/transport.ts:1342-1368`).
- **Fix:**
  - Refuse when there are locked tasks but no `lockedTransport`, or more than one distinct holder.
  - Otherwise resolve each locked task's parent and require it to equal the canonical request.
  - Add fixtures for these shapes.

### S5: Raw mutations without an adjacent `checkOperation` (invariant I1)
- **Where:** the create POST (`pinned.ts:119-125`) and the PUT (`pinned.ts:166`) bypass the guarded `crud.ts` primitives. Only `:60` checks. `docs/security-model.md:284, 296-299` and `AGENTS.md:399` list this as a fail-review anti-pattern.
- **Risk:** not exploitable today, because the per-call safety config is immutable, but likely to drift.
- **Fix:** add `checkOperation(..., Create/Update, ...)` immediately before each call.

### S6: `MCPTargetDeveloper` grants global `write` outside pinned routes
- **Where:** `xs-security.json:119-131`; its description reads "write explicitly selected PP targets".
- **Trigger:** in a standard-mode app with a writable side-by-side `/mcp` (`docs_page/multi-target-setup.md:614-620`), or any single-target app using this descriptor, `arc1_write_targets` is ignored. The user gets unrestricted single-target write.
- **Fix:** correct the description and add a warning to the guide.

## Optional improvements
1. **Schema drift.** The pinned schema inherits general field text (`src/server/multi-target-tools.ts:133-151`, from `src/handlers/tools.ts:634-638, 661-665, 720-728`), all of which contradicts the pinned runtime:
   - "hash omitted means no protection"
   - "package default $TMP"
   - "SAPTransport create"
   - "lhc_/lcl_ auto-routing"

   The lint error suggests `lintBeforeWrite=false`, which pinned writes reject (`write-helpers.ts:1247-1249`). There is also no pinned fixture in `tests/fixtures/tool-definitions/`.
2. **Guide accuracy and gaps in `multi-target-writes.md`:**
   - It calls the request "optional" for transportable creates; it is required (`pinned-write-policy.ts:97-101`).
   - Undocumented: editing a destination immediately returns `TARGET_CONFIG_CHANGED` for that target, a useful emergency stop.
   - Undocumented: on upgrade, previously quarantined destinations become readable.
   - Undocumented: non-admins see `SAPTargets` diagnostics only when more than one target is visible.
   - Undocumented: writes plus `SAPDiagnose(action="unittest")` let a writer run newly written ABAP as their SAP user, and the risk level is self-declared.
3. **Dropped write policy.** `deriveUserSafetyFromProfile` drops `multiTargetWrite` (`safety.ts:496-506`). That would select the legacy branch at `activate.ts:115`; it is unreachable today, but spreading the field is safer.
4. **Duplicated matching.** `checkPinnedRequest` duplicates `isTransportInWhitelist` (`safety.ts:312-328`); reuse it.
5. **Unbounded checks under the lock.** The re-check under the lock and the syntax check carry no deadline or signal (`pinned.ts:134, 157`; `client.ts:1694, 1294`).
6. **Large requests refused.** The 1 MiB / 256-task CTS bounds (`pinned-write-policy.ts:43-56`) apply after a full read and can refuse large project requests.
7. **Activation details.** The include URI forms (`pinned-activation.ts:17-25`) are not backed by wire evidence. Also, `beforeSubmit` fires before the send (`devtools.ts:225`), so a cancellation before sending is reported as `activation-not-confirmed`.
8. **Audit.** Add a structured outcome event (state, phase, policy digest, cleanup) for refusals inside the handler.
9. **Single-target change.** `closeStatefulSession` now uses a 5 s budget with no retry for single-target sessions too (`http.ts:327, 338`), contrary to "single-target unchanged".
10. **Lint config on read routes.** `abaplintConfig` now reaches `SAPLint` on aggregate and Basic routes (`multi-target-runtime.ts:76-77`); confirm and document.
11. **One signal, not two.** `isLocal` is derived from `DLVUNIT` (`transport.ts:1318-1319`); the lock's `IS_LOCAL` is the only independent second signal. Adjust the wording.
12. **Formatting churn.** Revert the unrelated `xs-security.json` reformatting and the `\u2014` escape.
13. **Generic denial.** The pre-lookup denial is generic (`multi-target-server.ts:624-630`); a safe reason code would help callers already granted the route.

## Test gaps
- B1: transport-read isolation with a non-empty global list.
- HTTP-level `tools/call` refusals (not just `tools/list`) for aggregate, `/authorize`, Basic, write B, and admin-only or read-only tokens.
- The `prepareMultiTargetCall` negative tests (`tests/unit/server/multi-target-writes.test.ts:153-196`) assert only `handled`; assert the error code and add a positive control.
- Transportable create with and without a request, a lock `CORRNR` mismatch, a recording change under the lock, and transportable activation.
- The shared 64 KiB attribute-limit case.
- The `buildAdtConfig` throw on a missing write policy.
- The conditions under which PRM advertises `write` (`http.ts:786-789`).
- The S1–S3 behaviors.

**Go/no-go:** go once B1–B3 are closed and S1–S6 are fixed, or explicitly accepted as documented and tested residual risk. The gate design does not need rework, and most fixes are local.

### Follow-up review

I found **no blockers**. The three properties you asked about all hold in ef2b14c7. There is one Medium issue I'd fix before merge, because this delta introduced it and the fix is a few lines. There are also two Low items and one thing to check live. This was a read-only review: I didn't run anything. I checked the code against the live `task-lookup.xml` artifact.

## Findings

### 1. Medium: the new trailing-newline regex is quadratic, so one write can freeze the server
- **Where:** `src/handlers/write/pinned.ts:170`, in `.replace(/\n+$/, '')`.
- **Trigger:** an authenticated writer submits CLAS/INTF source with a long run of blank lines that is *not* at the end. For example, 50k newlines inside a method body. That is valid ABAP and SAP saves it.
- **Why it's slow:** without the `m` flag, `/\n+$/` retries from every position in the run. Each try takes the rest of the run, fails `$`, and backtracks, so the cost grows with the square of the run length. This is the same shape as CVE-2021-33623 (`/[\r\n]+$/` in trim-newlines).
- **Both sides are scanned:** both operands of `!==` always run. So the user's own `source` is scanned whatever SAP returns, and SAP's read-back is scanned too.
- **Impact:**
  - At the default 100 KiB request cap, that is about 10⁹ backtracking steps per call, so seconds of blocking. This is estimated, not measured.
  - If an operator raises `ARC1_MAX_HTTP_REQUEST_BYTES` (up to 16 MiB), it is effectively unbounded.
  - Every user and health check on the instance stalls. The comparison before this delta was linear.
- **Fix:**
```ts
const comparable = (value: string) => {
  const text = value.replace(/\r\n/g, '\n');
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) end--;
  return text.slice(0, end);
};
```
`/(?<!\n)\n+$/` would also be linear. Outside this delta, `src/adt/diagnostics.ts:1855` has the same pattern (`/\s+$/` on dump text).

### 2. Low: when activation isn't confirmed, SAP's own messages are dropped
- **Where:** `src/adt/devtools.ts:1018-1028`.
- **Trigger:** SAP returns warning or info messages together with `activationExecuted="false"`, or with no `properties` element.
- **What happens:** the messages already parsed above are lost when the error is thrown. `pinnedFailure` (`src/handlers/write/pinned.ts:30-33`) then returns only the generic text. Failing closed is correct; this only makes the failure harder to diagnose. The success path already returns these texts, so including them exposes nothing new.
- **Fix:** attach a bounded set of the parsed texts to the error and include them in the `activation-not-confirmed` payload. Keep `success=false` and `retryable=false`.

### 3. Low: the new catalog reasons have no tests, and one test uses the old string
- **No coverage:** nothing in `tests/` exercises the reason chain at `src/server/multi-target-server.ts:257-276`. That includes the new `WRITE_TARGET_GRANT_MISSING`, `WRITE_TARGET_GRANT_MALFORMED` and `WRITE_TARGET_GRANT_LIMIT_EXCEEDED`, and `EXACT_WRITE_GRANT_REQUIRED`.
- **Stale string:** `tests/unit/server/multi-target-catalog-enforced.test.ts:158` still uses `TARGET_WRITE_GRANT_LIMIT_EXCEEDED`. It passes only because it has the same length as the reserved string at `multi-target-catalog-enforced.ts:176`.
- **Fix:** add a table test over the grant statuses, and share one "longest reason" constant between the size reservation and the test.
- **The production logic is sound:**
  - The statuses come from the closed `TargetGrantFailure` enum.
  - The new branch can only disable writes, and it agrees with the runtime gate (`multi-target-runtime.ts:113`).
  - The 33-character reason is still the longest, so the +1024-byte size reservation is still correct.

## Check live (not a defect)
I don't know what SAP 758 returns when you activate an owner that has no inactive version.
- **If it's an empty body or `activationExecuted="false"`:** the pinned path now reports `PINNED_WRITE_INCOMPLETE` / `activation-not-confirmed`. That fails closed, but it looks alarming.
- **How you'd hit it:** the new normalization reports an update that differs only in trailing newlines as `saved-inactive`, even if SAP created no inactive version. Activating that owner then lands in this case.
- **Suggested next step:** one probe on 758. Then document the result, or give that case a clearer message while keeping `success=false`.

## The three properties
- **Normalization doesn't hide real source changes.**
  - Only two things are normalized: CRLF→LF everywhere, and newlines at the very end.
  - Every interior byte, lone CR, trailing space and BOM is still compared exactly, and any difference ends as `source-save-unknown`.
  - The returned hash is computed over SAP's raw read-back bytes. Those are the same bytes `assertSourceHash` checks on the next edit (`pinned.ts:141-142,175`; `source-precondition.ts:5-15`).
- **Task-to-parent matching fails closed** (`src/adt/pinned-write-policy.ts:54-77`).
  - The fallback runs only when the first document gives no match. It needs exactly one task node with that exact number, status D, and a valid parent different from the task ID.
  - The `parent` attribute only chooses which document to fetch next.
  - Membership is proven again from the parent's own tree: the request ID must equal the parent, and the task must be listed there.
  - The usual checks are then applied: type K, status D, at most 256 tasks, task status D (`:87`), and both allowlists checked against the parent (`:89`).
  - Missing, duplicate, wrong-parent and released cases all throw. A task-only allowlist entry doesn't authorize its parent.
  - The structure matches the live artifact (`tm:root object_type="T"`, a sibling `tm:request` without tasks, and `tm:task tm:parent=…`). `task` and `messages` are always parsed as arrays (`xml-parser.ts:77,97`), so single-node documents work.
- **Activation doesn't report unknown responses as success** (`src/adt/devtools.ts:235,242-244,357,962-1029`).
  - In multi-target mode, each of these now throws and is reported as `activation-not-confirmed`:
    - an empty body;
    - an HTML or login page;
    - an `inactiveObjects` document with no object references (the old code called this success);
    - a missing or duplicated `properties` element;
    - `activationExecuted` other than `"true"`.
  - SAP error messages still give `success:false`. If SAP asks for confirmation again in the second call, the result is `success:false` and no third POST is sent.
  - References are still validated before each confirmation.
  - The strict check only applies when multi-target writes are enabled. Single-target behaviour, where an empty body counts as success, is unchanged (`tests/unit/adt/devtools.test.ts:782,868`).
  - Every other `activate()`/`activateBatch()` caller already refuses in multi-target mode (`devtools.ts:209-213,264`). So the strict parser covers the only multi-target activation path that can be reached.


### Review of 293cbaf2

I found no security regression in 293cbaf2. B1 and S1–S5 are fixed in code, and S6 is half done: the docs are fixed, the role descriptor is not. There is one new Medium finding (N1). It fails closed, so it is not a security issue, but it falls inside the transportable scope you are shipping.

Everything below comes from reading the snapshot and its private artifacts (`task-lookup.xml`, preflight JSON). I ran no tests and made no live calls. Live claims are quoted from the qualification log.

## Prior findings

**Implementation review (a68537d5)**

| Item | Status | Evidence / residual |
|---|---|---|
| B1 transport reads | Resolved | Every multi-target runtime keeps `allowedTransports: []` (`multi-target-runtime.ts:118`). The server list moves to `serverAllowedTransports` (`:124`) and is checked only in `checkPinnedRequest` (`pinned-write-policy.ts:21-30`). Every request/task-bearing step goes through it (`:82`, `:144`). A read-isolation test covers aggregate, reader, writer and Basic. Test gap: see N4. |
| B2 docs/governance | Mostly resolved | Added: R23, the I1 note, operator docs, and a validated overlay plus destination example with a parser test. Remaining: the governance update you deferred, the stale lines in N5, and ADR-0005. |
| B3 live qualification | Resolved for ef2b14c7, according to the log | 293cbaf2 needs the retest below. Documented as not qualified: a positive second SAP writer, a repeat of refresh revocation, a real expanded preaudit prompt, and live Basic/admin-only negatives. |
| S1 no-replay scope | Resolved | Client-level strict mode and `retryUnauthorized:false` are gone. Per-request `noReplay` gates the 401 retry (`http.ts:550,702-707`), CSRF retry (`:775`), negotiation (`:798-800`) and 503/429/DB retries (`:538`). It is passed on every send: pinned preflight, metadata, CTS, lock, syntax, PUT and read-back (`pinned.ts:92-97`); create (`:140`); unlock (`:224`); session close (`:232-238`); activation pre-checks and POSTs (`pinned-activation.ts:39-44`, `devtools.ts:215`). Neither the proxy path nor the security-session gate replays a request. Plain reads retry again (test at `pinned-writes.test.ts:267`). |
| S2 rejected vs unknown | Resolved for `state` | 4xx in the create or save phase now gives `*-rejected` (`pinned.ts:257-261`). 429, 5xx and network errors stay unknown, and a synthetic 200 "empty HTML" error stays unknown. Remaining: see N3. |
| S3 cleanup | Resolved | Unlock and session close each get their own 30 s deadline with no caller signal. Close now reports true/false (`http.ts:325-356`). `sessionClosed` and `savedHash` are returned (`pinned.ts:214,241,262`). Legacy close is back to `{probe:true}` (I did not diff this against main). Remaining: the deadline still includes waiting for the semaphore, but the result is now reported correctly. |
| S4 CTS lock ambiguity | Resolved for security | All lock holders are collected. Multiple parents, tasks without a parent, or more than 256 tasks are refused (`pinned-write-policy.ts:101-102`), and every locked task must resolve to the canonical request (`:125-127`). This introduced N1 and N2. |
| S5 adjacent checkOperation | Resolved | `pinned.ts:134` (Create) and `:197` (Update). |
| S6 MCPTargetDeveloper | Partial | The docs warnings were added. `xs-security.json:121` still says "write explicitly selected PP targets", which is what admins see in Cockpit. |

**Optional items from the first review:**
- **1 Schema:** fixed for package, transport, hash and method, and the lint hint is fixed. `source` and `name` still inherit the general text that mentions DDLS, SKTD and edit_unit (`tools.ts:628-644`). This is a nit.
- **2 Guide, 3 dropped policy, 4 duplicated matching, 9 single-target close budget:** resolved.
- **5 Unbounded checks under the lock:** resolved. The package-hierarchy resolver is still unbounded, but the pre-lock check fills its cache for the call.
- **6, 7, 8, 10, 13:** unchanged. On 7, `beforeSubmit` still fires before the send (`devtools.ts:244`); that is conservative.
- **12:** `\u2014` is still at `xs-security.json:83`.
- **Test gaps still open:** the `prepareMultiTargetCall` negative tests still assert only `handled` (`multi-target-writes.test.ts:173-198`). There are still no HTTP-level `tools/call` refusals and no tests for when PRM advertises `write`.

**Follow-up review (ef2b14c7)**
- **F1 quadratic regex:** resolved. The comparison is now a linear loop (`pinned.ts:202-207`), with a test for 50,000 interior newlines.
- **F2 activation messages:** resolved. Up to 5 messages of 500 characters each are attached (`devtools.ts:1044-1052`), and the result still has `success=false` and `retryable=false`.
- **F3 catalog reasons:** resolved. One shared `MAX_PINNED_WRITE_REASON` constant (`multi-target-catalog-enforced.ts:172`) and a table test (`multi-target-writes.test.ts:199-227`). At 33 characters it is still the longest reason in the closed set.
- **Check live (activating an owner with no inactive version):** still not recorded. It fails closed.

## New findings

**N1 — Medium (availability, fails closed): a released task among the lock holders blocks transportable writes and activation.**
- **Where:** the new loop at `pinned-write-policy.ts:125-127` calls `resolvePinnedRequest` for each locked task. That function requires the task to be modifiable (status D) on both lookup paths (`:60` and `:80-81`).
- **Trigger:** an object is locked in request R, and a task in R that contains it has been released. If SAP lists that task in `LOCK_HOLDER/TASK_HEADERS`, every pinned update, edit_method and activation of the object is refused until R is released. That listing is plausible but unverified. The error ("CTS task parent could not be established" or "The selected task must be modifiable") is misleading.
- **Fix:** for locked tasks used only as lock evidence, require just membership in the canonical parent, whatever the task status. Keep the status-D requirement for the task the caller selects. Checking `lockedTasks` against the parent tree you already fetched also removes N extra round trips. Add a `released-task` case to the lock-holder test and do one live probe.

**N2 — Low: single-target `lockedTransport` selection order changed.**
- **Where:** `transport-locks.ts` walks the tree with a stack (`:6`, `:13`), so sibling lock entries are visited in reverse order, and the first parent inserted wins (`:49`).
- **Trigger:** two `CTS_OBJECT_LOCK` entries with different requests. Main picked the first one in the document; 293cbaf2 picks the last.
- **Who is affected:** single-target callers that ignore `lockedTransportAmbiguous`: auto-corrNr in `create-transport.ts:29`, `manage.ts:198,336`, and `handlers/transport.ts:538-569`.
- **Fix:** preserve document order and add a test with two lock holders.

**N3 — Low: the error code and message contradict the new state.**
- `pinned.ts:35` maps only `unchanged` to `PINNED_WRITE_REFUSED`. So a create rejected with 409 reports `creation-rejected` together with `PINNED_WRITE_INCOMPLETE`. The same happens for `source-save-rejected`, even though nothing changed.
- A lock conflict with state `unchanged` gets the message "Inspect … inactive source" (`:36-41`).
- **Fix:** use REFUSED for the `unchanged`, `creation-rejected` and `source-save-rejected` states, and use the "rejected" message whenever state is `unchanged` and the error is an `AdtApiError`.

**N4 — Low (test gap): nothing tests that the server ceiling still denies writes after the B1 refactor.**
- No test covers "destination allows the request, `serverAllowedTransports` denies it" (enforced at `pinned-write-policy.ts:26`).
- The title of the test at `pinned-writes.test.ts:242` ("even when the global list is empty") is stale: the fixture's server list is `['A4HK900001']` (`:26`).
- **Fix:** add a deny test, add a positive control with an empty server list, and rename the stale test.

**N5 — Low (docs outside your pending list): stale "mutation-free" wording.**
- `docs_page/btp-cloud-foundry-deployment.md:8-9` says multi-target is mutation-free "regardless of the single-target ceiling". That is now false: `SAP_ALLOW_WRITES` is the global write switch.
- The `docs_page/btp-administration.md:418` checklist would fail a valid writable deployment.
- `docs_page/arc-1-vs-sap-abap-mcp-server.md:104` contradicts the row above it.
- `README.md:50` and `examples/btp/README.md:10` still say mutation-free.
- The model-facing aggregate instructions say writes are "unavailable in multi-target v1" (`multi-target-server.ts:37`). Wording such as "on this aggregate connection" would be accurate.
- `destination-registry.ts:293` still says "multi-target v1".
- R23 (`docs/security-model.md:263`) has no severity/status line and sits before R21.

## Governance wording (pending; not counted as a blocker)
- **ADR-0010:** Status becomes "Accepted <date> for the scope qualified in PR #1080 at `<final SHA>`"; rename "Proposed decision" to "Decision". Record the accepted residual limits:
  - no positive second SAP writer;
  - refresh revocation not repeated;
  - expanded preaudit covered by fixtures only;
  - Basic/admin-only negatives tested at unit level only;
  - only 758 SP02 qualified, with unrecognized evidence failing closed;
  - your decision on N1.
- **ADR-0005:6:** add ADR-0010 to the "Superseded by" line. This one is not on your pending list.
- **ADR-0006/0007/0008:** add a one-line amendment: "pinned PP routes may expose the scoped CLAS/INTF surface; aggregate, `/authorize` and Basic remain mutation-free."
- **AGENTS.md:**
  - Update `:24-25`, `:126`, `:149` ("Mutation-free schemas"), `:201` and `:206` (the v1 row), and `:390-392`.
  - Change the fail-review rule so multi-target mutation is allowed only through the ADR-0010 path: the `multi-target-write-surface.ts` allowlist, then `handlers/write/pinned*.ts`, with no-replay and the low-level activation validator.
  - Leave `:18` and `:323` (Basic) as they are.
- **v1 plan:** the same one-line qualification.

## Minimum live retest for 293cbaf2
1. **Full matrix:** local and transportable CLAS/INTF create, update, edit_method and activation. Deploy 293cbaf2 plus #1082 only, and record that. 293cbaf2 alone ships `public/` in `.cfignore`, which drops `dist/public`.
2. **Real 758 lock payloads:** a transportable update and activation of an object already locked with a task. Also a transportable create in a package that has many candidate requests, to confirm the new parser raises no false ambiguity.
3. **B1 in both directions:**
   - A request the destination allows but `SAP_ALLOWED_TRANSPORTS` does not must be refused before any mutation.
   - `SAPTransport get/diff` of a request outside that list must still work on the aggregate route and on a read-only pinned route.
4. **Recommended:** a released-task probe for N1, and activation of an owner with no inactive version.

## Readiness
This is a go once:
- the 293cbaf2 retest passes with no uncertain mutation;
- N1 is fixed, or documented as a known limitation and probed live;
- the governance update lands, including ADR-0005 and R23's severity line.

N1, N3 and N4 are a few lines each and fit in one commit. N2, N5 and the S6 descriptor can be fast follow-ups.


### Narrow acceptance review

**Verdict:** N1, N2, N3, N4 and S6 are all fixed at `0632606a`, and so is the other wording you changed. I found no new correctness or security blocker. I accept this fix; governance can go ahead once your 0632606a live run passes.

All paths are relative to the `review-0632606a` snapshot. I didn't run any tests or make any live calls; the test and live results are as you reported them.

| Finding | Status | Key lines |
|---|---|---|
| N1 released historical tasks | Fixed in code with a unit test; no live probe recorded yet | `pinned-write-policy.ts:71`, `:91-95`, `:136-143`, `:161` |
| N2 lock display order | Fixed | `transport-locks.ts:8`, `:36`, `:46`; new `transport-locks.test.ts` |
| N3 refusal codes | Fixed | `pinned.ts:35-43` |
| N4 server ceiling test | Fixed | `pinned-writes.test.ts:242`, `:366-377` |
| S6 Cockpit description | Fixed | `xs-security.json:121` |
| Other wording | Fixed | see below |

**N1**
- **Task the caller selects:** it still has to be modifiable (status D), checked on the task lookup (`:71`) and again in the parent's task list (`:91-95`).
- **Tasks from lock evidence:** each must appear exactly once in the parent's task list, which has already been verified. The parent must be a modifiable Workbench request with at most 256 tasks, allowed by both the server and destination lists (`:84-96`). Task status is ignored and no extra lookups are made (`:141-143`).
- **Lock request number:** `lockedTransport` must now equal the parent's ID exactly (`:137`), which is stricter than before. The `corrNr` from the fresh lock only has to belong to the parent (`:161`).
- **758 returns the full task list:** in the live `task-lookup.xml`, the request and the task sit side by side and the request lists no tasks. So a selected task always falls back to loading the parent's own full task list. Lock tasks are never checked against a partial list.
- **Regression test:** the `released-task` case (`pinned-writes.test.ts:322-352`) would have failed at 293cbaf2, because the old per-task lookup required status D.

**N2:** `.reverse()` restores document order, and `!parents.has` keeps the first holder's owner. This matches main's parser (unchanged at `a68537d5`, `src/adt/transport.ts:1338-1368`): the first `REQ_HEADER` wins, and the legacy `HEADER` is used only when there is none. Without the fix, the new test picks `A4HK900003`, so it really guards the regression. Conflicting holders are still flagged (`:53`) and refused (`pinned-write-policy.ts:115-116`).

**N3, N4, S6**
- **N3:** the mapping is exactly what I recommended. `created-source-rejected` and every `*-unknown` state stay `INCOMPLETE`.
- **N4:** the destination allows the request in both cases. When the server list excludes it, the write is refused with 0 saves; when the server list is empty, it saves once (`safety.ts:315`).
- **Other new tests:** the PRM test matches `http.ts:786-789`. All 7 hidden-input negative tests now assert `MULTI_TARGET_OPERATION_FORBIDDEN` (`multi-target-writes.test.ts:173-201`).
- **S6:** the descriptor test checks only scope and attribute references (`xsuaa-target-descriptor.test.ts:68-71`), so the new description can't break it.

**Other wording:** every line I listed is fixed:
- `btp-cloud-foundry-deployment.md:7-9`
- `btp-administration.md:418`
- `arc-1-vs-sap-abap-mcp-server.md:103`
- `README.md:50-54`
- `examples/btp/README.md:10`
- R23's severity line and position (`docs/security-model.md:285-287`)

The changed instruction text is used only on the aggregate route; writable pinned routes get their own text (`multi-target-server.ts:62` vs `:81-88`).

**Why there's no new blocker:** both relaxations only loosen the checks on lock evidence. The parent request must still be a modifiable Workbench request allowed by both lists. The task the caller selects must still be modifiable, and create and save still record into the parent (`pinned.ts:134`, `:197`). These cases all still refuse:
- a request outside the allowlists;
- a parent that isn't a Workbench request, or is released;
- conflicting or orphan lock holders;
- a task that is missing from the parent's list or listed twice.

**Non-blocking follow-ups**
1. **Misleading message (`pinned.ts:41-43`):** state `unchanged` with an error that isn't an `AdtApiError` still pairs `REFUSED` with "SAP did not confirm the complete operation… inspect inactive source". Examples are the plain `Error` thrown for fatal CTS messages (`transport.ts:1239`), network errors and cancellation. It's safe, just misleading. Use a neutral message whenever the state is `unchanged`, for example "No create or source save was sent."
2. **Test gaps:**
   - No test asserts the `error` code. Add it to the existing checks at `pinned-writes.test.ts:257` and `:315`.
   - `toThrow('modifiable')` at `:364` would also match the parent-request error. Assert "The selected task must be modifiable" instead.
   - The mocked lock always returns the request ID (`:87`), so a task ID as `corrNr` at `pinned-write-policy.ts:161` is never tested.
3. **Schema text (`multi-target-tools.ts:155`):** "only the existing main method body" doesn't match `spliceMethod`. It also accepts a complete METHOD…ENDMETHOD block, and asks for one when a body-only edit fails (`method-surgery.ts:650-652`, `:693-694`).
4. **Docs:**
   - `xsuaa-setup.md:182-183`, `:271` and `:276` say only "eligible" pinned PP routes advertise `write`. The code and your new test advertise it on every pinned route, including unknown ones, when writes and enforced mode are on. That's correct because it doesn't reveal which targets exist, so the docs should say that.
   - `README.md:230` still calls Multi-System Setup "read-only".

**Before governance**
- The qualification record has no released-task entry yet. Either run that probe in the 0632606a live run, or record "released-task lock evidence: unit tests only" as a residual limit in ADR-0010, as the N1 disposition.
- Confirm the XSUAA service update accepts the new role description.
