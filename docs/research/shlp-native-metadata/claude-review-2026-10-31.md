# Claude Code review — SHLP — 2026-10-31

Initial review: `e5fcfdcdde6ef20c7128fb4dac20bb8affc3aa42`, base `90abdfc3dcd2b9ac04c4c2d4c21dd07d4dec0d98`. Claude Code 2.1.308 used
`claude-opus-5-5` with Read/Glob/Grep only, isolated tracked sources, no hooks or MCP servers,
and no permission denials. It completed successfully after 1021.1 seconds.
The review was static; validation claims came from the recorded test evidence.

## Disposition

- **B1:** fixed in the shared handler with the existing target-aware `isBtpSystem()` guard. Both
  tools have zero-network auto-mode regressions; live BTP smoke now probes with `auto` and passes
  8/8, including explicit and detected BTP refusals.
- **B2:** the missing evidence is addressed by [live backend-source qualification](active-version-2026-10-31.md)
  on both supported releases and a durable native-contract integration check (8/8 on each).
  SAP's provider selects active state through `DDIF_SHLP_GET`'s default `A`; no draft-editing
  experiment is claimed.
- **P2 size guidance:** SHLP-specific limit text explains that metadata cannot be narrowed or paged
  and that no partial metadata was returned. Tests reject data-preview/maxRows/WHERE guidance.
- **P2 transport coverage:** 429, 503, DB-error 500 and 302 each make one send; default 401 and
  401→406→200 recovery, the four-send ceiling, default deadline, stalled direct/proxy bodies and
  cancellation text are asserted. The focused suite passes 44/44.
- **P3 deny parity:** documentation names both deny actions. The other optional diagnostics,
  description-order, filler-tolerance and extra routing cases remain follow-ups; they were not
  identified as merge blockers and do not alter this feature's contract.

Follow-up Claude review pending after the fixes and final validation.

## Initial review (verbatim)

# PR #1141 review: don't merge yet

Two blockers remain:
- **BTP exclusion:** a confirmed code path breaks it on the default configuration. The fix is one line plus a test.
- **`active` label:** this contract claim has no evidence behind it. Settling it takes one live control.

The reader, parser, transport wiring, input validation and source-URL guard otherwise hold up. This was a static review: I ran nothing, so test results come from the PR's validation document.

## Blockers

### B1 (P1): BTP exclusion only works with an explicit `SAP_SYSTEM_TYPE=btp`

**Where:** `src/handlers/read.ts:203`, `src/handlers/context.ts:92`, `src/handlers/search-help.ts:11`

**Failure path:**
1. A BTP ABAP system runs with `SAP_SYSTEM_TYPE` unset, which is the default `auto` (`src/server/config.ts:780`, `AGENTS.md:113`).
2. Detection caches `systemType: 'btp'`, but `config.systemType` stays `auto`. `src/handlers/tools.ts:89` and `:389` therefore advertise SHLP, and `src/handlers/dispatch.ts:1000` selects the on-prem schemas.
3. The runtime guard is `isBtpSystem()` at `src/handlers/read.ts:232`, but the SHLP return at `:203` runs first. `SAPContext` has no guard, so the native GET reaches BTP.

**Impact:**
- This is not a privilege problem, because the request uses the caller's SAP authorization.
- It does return an unqualified result from a system the PR says is excluded. What BTP returns for this collection is unknown.

**Evidence gap:** the BTP tests force `systemType: 'btp'` (`tests/unit/handlers/search-help.test.ts:265`, `tests/integration/btp-abap.smoke.integration.test.ts:127`). The 7/7 smoke therefore never exercises the default path.

**Fix:** add this as the first line of `handleSearchHelp`, matching `src/handlers/application-log.ts:11`:

`if (isBtpSystem()) return errorResult('SHLP metadata is not qualified for BTP ABAP.');`

`storeFor` resolves the target or destination from request context, so this covers both tools.

**Verify:**
- Add a unit test with `setCachedFeatures({ systemType: 'btp' })` and `systemType: 'auto'`, through both tools, asserting zero requests.
- Repeat the BTP smoke with `auto` after a feature probe.

**Accepted limits:** before the probe completes, the system type is unknown and the GET proceeds. `tools/list` under `auto` also stays on-prem. Existing on-prem-only types share both limits.

### B2 (P1, missing evidence, not a proven bug): `sourceVersion: 'active'` is asserted, not enforced

**Where:** `src/adt/search-help.ts:143`, `:166`

**Problem:**
- The GET has no version parameter, and the parser reads no version information from the response, yet the result always says `active`.
- The validation document says no fixtures were created, so nothing shows a control against a pending draft.
- A search of `docs/` found no draft control for Element Info, and the "remaining qualification" sections don't list this gap.

**Failure path if SAP resolves drafts here:**
- A user with an unactivated change gets draft flags or parameters labelled active.
- A never-activated help could return named metadata instead of `not_available`.

Static review can't settle which happens. This asks for evidence behind the label, not for inactive support.

**Verify on a dev system with a disposable Z help:**
1. Activate it, change an import flag without activating, then GET as the editing user and as a second user.
2. Repeat with a never-activated help.
3. Expect the activated value and an unnamed response. Keep the captures as fixtures.

If SAP returns draft content, the label and docs must change.

## Should fix, not blocking

### P2: The size-limit error recommends options SHLP refuses

**Where:** `src/handlers/dispatch.ts:222-243`, `src/adt/search-help.ts:171`

**Failure path:** a body over 2 MiB raises `AdtResponseLimitError` with family `search-help-metadata`, which has no mapped hint. The caller is told:

> The SAP data-preview result exceeded the 2 MiB server limit. Submit a new request with lower maxRows, fewer columns, or a restrictive non-overlapping key-range WHERE clause.

`src/handlers/search-help-input.ts:25-29` refuses `maxRows` and `columns`, and SHLP has no WHERE option. The message also misdescribes a metadata read as data preview. The tests miss this because `/limit|large/i` matches the wrong text (`tests/unit/handlers/search-help.test.ts:106`, `:117`).

**Fix:** add a family branch like `package-browser` at `dispatch.ts:219`, saying SHLP metadata can't be narrowed and no partial result was returned.

**Verify:** assert `not.toMatch(/data-preview|maxRows|WHERE/)` in both size tests.

### P2: Attempt, retry and deadline limits aren't pinned at the SHLP level

**Where:** `src/adt/search-help.ts:170-173`

My trace of the wiring is correct on both routes, but the tests wouldn't catch a regression. Removing `attemptBudget`, `retryTransientErrors: false` or the 15-second ceiling would leave every SHLP test green.

**Why the tests miss it:**
- `setup()` always sets `retryUnauthorized: false` (`tests/unit/handlers/search-help.test.ts:36`).
- The status list is 401/403/404/500 with a non-DB body (`:81`), so there is no 429, 503, DB-error 500 or 302 case.
- The deadline test is direct-only and passes an explicit caller deadline (`:157`).
- The cancellation test asserts only `isError` (`:153`). It catches lost propagation only if the test timeout fires before the 15-second deadline. I couldn't confirm the unit timeout.

**Verify, on both routes:**
- 503, 429 and DB-error 500 each make exactly one call.
- 302 makes one call and isn't followed.
- With default retries, a repeated 401 makes two calls, and 401, then 406, then 200 makes three.
- A stalled proxy body stops at the deadline.
- Cancellation output matches `/cancelled/`.

Three sends is the normal maximum, so four is only a ceiling. To pin it, spy on `http.get` and assert `attemptBudget.limit === 4` and `deadline <= start + 15000`.

## Optional follow-ups (P3)

- **Redirect guidance** (`src/adt/bounded-response.ts:17`, `src/handlers/dispatch.ts:258`):
  - On a system that answers a stale session with 302, ordinary reads reach the login page and get SSO guidance plus a stale-cookie reset (`src/adt/http.ts:981-996`).
  - SHLP gets only "Redirects are not allowed during bounded SAP analysis." The mapped hint exists only for `SAPNavigate` relations, so extend it and test a 302.
  - Whether real systems redirect here depends on their SSO setup.
- **Tool description order** (`src/handlers/tools.ts:109`, `src/handlers/tool-registry.ts:175`):
  - SHLP now leads the primary context tool's description and enum.
  - The budget offset also trimmed on-prem `impact` guidance that BTP keeps (`tools.ts:128`). The options remain documented at `:1428-1436`.
  - Move SHLP after the decision rule and into the DDIC group of the enum. If evals cover SAPContext routing, run them, because the validation document records no eval run.
- **Misleading identity error** (`src/adt/search-help.ts:57-60`, used at `:97` and `:104`): a bad name from SAP produces "use a Dictionary name", which blames the caller's input. Use a response-specific message.
- **Filler tolerance** (`src/handlers/search-help-input.ts:25-29`): only `false` is tolerated, while SYNTAX also accepts `[]` and `maxResults: 0` from strict clients (`src/handlers/schemas.ts:149-153`). Such clients get a clear refusal, so this fails safely.
- **Deny parity** (`src/authz/policy.ts:292`): `SAP_DENY_ACTIONS=SAPRead.SHLP` doesn't stop `SAPContext(type="SHLP")`, which returns the same metadata. Other types split the same way, but here the payload is identical, so document it for operators.
- **Small tests:** add `SHLP/DHF` refusal through both tools at dispatch level, and the hyperfocused `SAP` path. By code trace, both behave correctly.

## Checked, no finding

- **Partial contract:**
  - Both tools return the same `completeness: 'partial'` payload with an explicit `missing` list.
  - `src/handlers/context.ts:92` returns before KTD or traversal, and nothing is cached.
  - Unsupported options are refused in Zod and again in the handler, before any request.
- **Error classes:**
  - Unnamed 200 becomes a `not_available` MCP error.
  - HTML, DOCTYPE, identity mismatch and duplicates raise `AdtError`.
  - HTTP failures keep their SAP status with no fallback.
  - Known-absent discovery is a separate plain error.
- **Names and identity:**
  - The regex has no `u` or `m` flag, so non-ASCII case folds and trailing newlines don't pass.
  - Root and parameter identities are both checked.
  - The name is encoded exactly once.
- **Flags:** missing becomes `null`, `false` is preserved, and empty or invalid values raise an error.
- **XML:**
  - DOCTYPE and ENTITY are refused before parsing.
  - Tag and attribute values stay strings.
  - Nested data elements and the package node aren't counted as parameters.
- **Discovery:**
  - The gate uses exact `discoveryMap.has`.
  - Accept-less collections are retained (`src/adt/xml-parser.ts:597-601`, `tests/unit/adt/discovery.test.ts:65`).
  - An empty map means unknown, which leads to the fixed GET.
  - The explicit Accept bypasses cached negotiation.
- **Normalization and source-URL guard:**
  - `SHLP/DH` normalizes to `SHLP`, and `SHLP/DHF` fails the enum and `objectBasePath`.
  - `objectUrlForType` throws for SHLP, including the `SYNTAX` path now admitted at `src/handlers/schemas.ts:139`, before any request.
  - `VERSIONS` has no SHLP builder, and `tadirObjectUrl` returns an empty string.
  - IDE links exclude SHLP (`src/server/ide-links.ts:17`), and relation lookup accepts both forms (`src/adt/relation-objects.ts:216`).
- **Safety and identity:**
  - `checkOperation` runs first, and base read scope and deny checks apply.
  - The caller's `client.http` is used with per-client cookies.
  - No credentials or cache are added.
- **Byte limit:** the cap applies after decoding on the direct route. The proxy route forces identity encoding and rejects compressed responses.
- **Attempts and time:**
  - Each send charges the attempt budget on both routes, and redirects aren't followed.
  - Deadline and cancellation reach semaphore waits, token fetches and stalled bodies on both routes (`src/adt/http-deadline.ts:127`, `src/adt/bounded-response.ts:140`).
- **Registration:**
  - SHLP has `btp: false` and BTP snapshots are unchanged, so explicit BTP mode refuses before any request.
  - Hyperfocused calls re-enter the full pipeline.
- **MCP E2E:** the suite uses a real MCP client against a running server and covers the alias, flags, partial coverage, unavailable results and option refusal. It doesn't cover `auto` on BTP.

## Remaining uncertainty

- **XML library:** `fast-xml-parser` isn't in the snapshot, so its behaviour is inferred from the options, fixtures and tests.
- **Discovery evidence:** the gate uses cached evidence from the probing identity (`src/server/server.ts:504-507`, `:886`). It can only cause a refusal, never expose another caller's data. Whether SAP discovery varies by user is unknown.
- **Multi-target:** SHLP joins that read surface automatically because the check is operation-based (`src/server/multi-target-tools.ts:117-121`). The PR has no target-route test. Live principal propagation and restricted-user behaviour remain unqualified, as the PR says.
- **Parameter names:** the strict regex has only been exercised on the fixtures and live helps in the evidence. One unusual real parameter name would fail the whole read, which is safe but would reduce availability.

**Merge condition:** fix B1 with its test and complete the B2 control. If the control confirms active-only behaviour, the PR is mergeable, and the P2 items are cheap enough to include in the same commit.
