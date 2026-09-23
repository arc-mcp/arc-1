# PR #768: text-elements root cause, review and verification

Date: 2026-09-09. Original head: `416cdfe9aee538b4c4db48e4c447ce51cf4fb557`.
PR: https://github.com/arc-mcp/arc-1/pull/768.

## Decision and root cause

Keep PR #768 and add review commits. Its extracted `adt/text-elements.ts` module, typed collection
routing and existing lock/PUT/unlock protocol are the right base. A replacement PR would duplicate
working code and lose the useful review history. No force-push is needed.

Before the PR, `getTextElements()` always called
`/sap/bc/adt/programs/programs/{name}/textelements`. The handler discarded `objectType`, so even
class requests went to that program URL. The working API lives under the separate top-level
`/sap/bc/adt/textelements/{programs|classes|functiongroups}` service. Existing class-only symbol
helpers used it, but program selection texts and headings had no write route. This is a client
routing/feature gap, not a missing SAP configuration or an ABAP syntax fix.

The original PR's 474 focused unit tests passed. Live A4H/758 checks of the unmodified PR then
confirmed all three program/function-group parts could be written and read back. Both uniquely
named `$TMP` objects were deleted. This establishes that the central design works, including
function-group selection screens defined in the TOP include.

## Review findings and implemented plan

1. **P2 — Broken compatibility fallback.** The new 7.50 fallback called the same legacy resource
   the original bug used. The July research already recorded 404s on NPL/750 and A4H/758, and this
   review reconfirmed the A4H 404. Remove the fallback. Loaded discovery must fail cleanly when
   the requested collection is absent; unknown discovery still lets SAP answer the real request.
2. **P2 — Incomplete reads reported as successful.** Catching every HTTP 406 and continuing
   discards source parsing/consistency failures. Fetch only class symbols for the class whole-pool
   route and propagate all actual part-read failures. Explicit unsupported class parts must be
   rejected consistently at the client boundary as well as the write handler.
3. **P2 — Explicit clears rejected.** `stripLlmEmptyValues()` removed `source=""` before the write
   handler could distinguish an empty replacement from missing input. This pre-existing problem
   also affected the new program/function-group surface. Preserve string source only for
   `SAPWrite.edit_text_symbols`; omitted/null source still fails. Do not broaden empty-source
   handling for unrelated actions.
4. **P2 — Raw content trimmed.** Whole-pool reads used `body.trim()` as output, changing the final
   value's spaces and line endings. Use trimming only to decide whether a body is empty; output
   the original body. These are editable properties bodies, not display-only summaries.
5. **Contract and test gaps.** Document complete-part replacement and `objectType` defaults in the
   tool schema, derive the part enum centrally, validate at the client HTTP boundary, and retain
   the old documentation anchor. Avoid an unverified `>=7.51` release claim and the false claim
   that every unsupported class read produces HTTP 406.

The new regression suite initially had **9 failures and 11 passes** against the original PR.
All 20 passed after these changes. The failures cover the first four findings and invalid direct
client part routing. Additional passing controls cover write ceilings, real-package checks,
missing-package denial and missing/null source. No new authorization capability or opt-in was added.

## Live SAP contract observed

Target: `https://a4h.marianzeis.de`, HTTPS/443, client `001`, SAP_BASIS `758` SP02.
The discovery document advertises all three collections with
`application/vnd.sap.adt.textelements.v1+xml`.

| Check | Observed result |
|---|---|
| Legacy `programs/programs/RSPARAM/textelements` | 404 `No suitable resource found` |
| Program `RSPARAM` selections | 200, maintained `ALSOUSUB` label |
| Class `CL_GUI_ALV_GRID` symbols | 200, maintained symbols |
| Class selections / headings reads | 200 empty selection body / empty-value heading placeholders |
| Function-group `SYST` parts | 200, empty symbols/selections and heading placeholders |
| Disposable program + FUGR write all three parts | Successful PUT and immediate read-back |
| `PARAMETERS` and `SELECT-OPTIONS` labels | Both persist; SAP pads keys to eight characters |
| Write only one symbol after two exist | Omitted symbol removed: this is complete-part replacement |
| Malformed symbols (missing per-entry `@MaxLength`) | 406, previous symbols unchanged |
| Valid write immediately after malformed write | Succeeds: lock cleanup permits continued editing |
| Explicit empty symbols and selections | Clear successfully; other parts stay byte-identical |
| Cleanup | Objects deleted; follow-up object reads return 404 |

SAP normalizes properties bodies to CRLF and pads selection keys. Tests compare semantic entries
where appropriate and exact before/after bodies to prove sibling parts did not change. They do
not require a write response to echo the caller's original whitespace.

## Repeatable verification

New `tests/unit/handlers/text-elements.test.ts` tests dispatch and direct-client failure boundaries
with mocked HTTP. Updated client tests no longer manufacture a working 7.50 legacy endpoint.
New `tests/integration/text-elements.integration.test.ts` runs through real `handleToolCall`, using
restricted `$TMP` package policy, actual discovery, create/update/activate, every text part,
replacement/clear/error recovery and verified deletion. Existing class-symbol lifecycle coverage
continues to exercise the compatibility client methods.

```bash
npx vitest run tests/unit/handlers/text-elements.test.ts
TEST_SAP_URL=https://a4h.marianzeis.de TEST_SAP_CLIENT=001 TEST_SAP_INSECURE=false \
  npx vitest run --config vitest.integration.config.ts tests/integration/text-elements.integration.test.ts
```

Credentials are loaded by the normal test helper; do not put credentials into commands or evidence.
The integration tests skip before creation if discovery does not advertise the service.

## Initial final review and results (`a4374257`)

The final branch includes current `main` (`31800373`) through a normal merge. Its KTD changes
merged without conflicts. The combined descriptions initially exceeded the schema ratchet;
removing repeated on-prem type lists and shortening duplicated text-element guidance restored
the existing budgets. No budget was raised. BTP snapshots are byte-identical to current `main`.

| Gate | Final result |
|---|---|
| `npm test` | **5,851 passed**, 196 test files; no failures |
| Dedicated text-elements unit suite | **24 passed**, including denial and non-class failure cleanup |
| `npm run typecheck` | Passed for source, scripts and tests |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm run validate:policy` | Passed |
| `npm run check:sizes` | Passed; full-git schema 17,779 estimated tokens, descriptions 12,542 |
| `npm run docs:build` | Passed (`mkdocs build --strict`) |
| Selected live lifecycle tests | **3 passed**: PROG, FUGR and existing CLAS compatibility test |
| Final compiled stdio MCP smoke | Passed: advertised schema, class write, old/new read APIs, whole-pool output, clear, refusal and verified deletion |
| `git diff --check` | Passed |

Seven unrelated CRUD tests were excluded by the live command's `-t` filter; the three selected
tests all executed. The compiled smoke connected the SDK client to `dist/index.js`, created a
unique `$TMP` class, then verified deletion. It exercised actual MCP JSON-RPC rather than only
calling the handler in-process. Local scripts and credential-bearing configuration are not committed.

Final review traced normalization → schema → handler → owning-object package lookup → typed
text-elements endpoint → stateful lock/PUT/unlock. The deny-action and write ceilings remain
effective, caller-supplied packages cannot substitute for the real package, and no text-pool
content is cached by these read routes. All parts use their own media type for both PUT headers;
caller transport overrides the lock transport, and failed PUTs release the lock. The original
class wrapper methods and `SAPRead(type=CLAS, include=text_symbols)` remain available. No remaining
blocking defect was found within this scope; the limits below remain explicit.

## Verification limits

The new writes were tested live on A4H/758. The PR author's 757 checks were reads only; the older
750/816 evidence is in [the July dossier](2026-07-02-class-text-symbols-textpool.md). Do not infer
new cross-release write evidence from this run. Transport-number forwarding is unit-tested;
these live objects use `$TMP`, so no transportable write or transport release was performed.
The BTP tool snapshots must remain byte-identical, and no new BTP support is claimed.

## Follow-up: Claude review, 2026-09-09

The supplied external review approves the PR and proposes six non-blocking refinements. Its
claims are review input, not evidence of tests run in this workspace. The following decisions
were checked against the implementation and the earlier live findings:

| Finding | Decision |
|---|---|
| 1. Description trimming | Retain deliberately. Purpose and type enumeration already exist in `SAPWRITE_LEAD` and the `type` schema. Repeating them would exceed the combined budget; no capability information was removed. |
| 2. Empty-source repair location | Move into `case 'SAPWrite'` alongside the existing action-specific normalization. The previous `toolName === 'SAPWrite'` guard already prevented effects on other tools; this is a behavior-preserving organization change. |
| 3. Class read refusal | Apply. Explicit class `selections`/`headings` reads now return the raw SAP response. Default class whole-pool reads remain symbols-only. Write guards remain at both handler and client boundaries, with accurate wording that these class parts cannot be written through ARC-1. This supersedes the earlier review's explicit-read refusal. |
| 4. Multipart editing guidance | Add one trailer to results containing multiple non-empty parts: read/write individual parts and omit the markers from source. Individual part bodies stay byte-identical; single-part/empty output stays unchanged. |
| 5. Release evidence | Scope user documentation to verified 758/816 and the tested 750 absence. Keep the contributor's 757 read evidence explicitly attributed in this dossier; it is not a new local verification. |
| 6. Redundant checks / lowercasing | Retain the cheap in-memory safety/discovery checks protecting separately callable methods. Remove the ineffective write-handler lowercasing; the public `textPart` enum still requires lowercase, with a rejection test. |

Live confirmation in this workspace on A4H/758: `CL_GUI_ALV_GRID` selections returned HTTP 200
with an empty body; headings returned HTTP 200 with an 81-character placeholder body. Each
`SAPRead` result matched its direct SAP response exactly. A disposable class lifecycle also
checks these readable parts and the unchanged client-side write refusal.

Follow-up verification: **5,855 unit tests passed** across 196 files, including 28 dedicated
text-elements tests. The three selected live lifecycle tests passed (seven unrelated CRUD tests
excluded by the filter). The rebuilt stdio MCP smoke passed, including the now-readable class
headings, the unchanged write refusal, and verified deletion of its temporary class. Typecheck,
lint, build, policy validation, size/schema checks, strict documentation build and diff whitespace
checks passed. The BTP fixtures remain unchanged. No additional blocking finding remains from
the supplied review; the cross-release/transportable-write limits above still apply.
