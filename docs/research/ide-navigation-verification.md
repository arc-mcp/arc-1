# IDE navigation: verification and remaining gaps

Evidence collected 17–19 October 2026; consolidated 20 October for
[draft PR #1025](https://github.com/arc-mcp/arc-1/pull/1025).
[Setup](../../docs_page/ide-integration.md) · [Design and retired alternatives](ide-navigation-decisions.md)

**Current result:** simplified BTP → SAP ADT MCP → clicked VS Code source passed for pinned and
aggregate routes. Eclipse native opening passed, but direct Eclipse Copilot dispatch remains
unconfirmed. No editing/activation acceptance is implied. The shared BTP app was restored after tests.

## Final simplified-runtime acceptance

Runtime `7b00407a10c06c79eba93c127ca935f39235ef36`, 19 October **21:23–21:29 UTC**.
VS Code **1.142.0**, SAP ADT **1.2.0**, MCP **3.62.0 / 33 tools**, macOS ARM64,
actual Copilot **Local / Gemini 3.8 Flash**.

The existing `arc1-multi-beta` CF app temporarily used candidate droplet
`c9c57ec0-d39f-44bb-b60c-10ce50a61780` with existing routes, bindings and environment.
`ARC1_IDE_LINKS` stayed off. Pinned and aggregate entries had no IDE headers or copied bearer token.
Cached XSUAA OAuth worked; local ADT required its separate browser logon.
The personal instruction confirmed `A4H/001` → local `A4H2023-2` against backend and SAP client 001.
Only SAP's resolver tools were selected for navigation; Bridge tools were deselected.

| Case | Observed calls | Click/open result |
|---|---|---|
| Aggregate INTF `IF_SERIALIZABLE_OBJECT` | `SAPTargets` → `SAPRead` active with `A4H/001` → native `abap_object_get_file_uri`, confirmed alias + name/type | `if_serializable_object.intf.abap` opened; expected interface declaration visible |
| Pinned DDLS `/DMO/I_FLIGHT` | `SAPRead` active → native `abap_object_get_file_uri`, confirmed alias + name/type | `(dmo)i_flight.ddls.acds` opened; expected CDS entity declaration visible |
| Missing CLAS `ZARC1_NONEXISTENT_1025_TEST` | Exactly one pinned `SAPRead` → 404 | No native call, alternate server or invented link; pass for this explicit negative test |

Serialized BTP tool definitions contained the **new simplified initialize hint** on every call.
Prompts supplied neither URI format nor repository path. Final Markdown compared with resolver
responses gave **2/2 exact inner URI matches after one outer decode**, including spaces/namespaces.
Call counts were 3, 2 and 1. Neither successful opening needed another logon after initial sign-in.
No Bridge, native edit or activation tool was called; source was not changed.

[Runtime CI](https://github.com/arc-mcp/arc-1/actions/runs/39317167241) passed. Evidence-only
head `50ba71c6` then passed all 16 checks, including Node 22/24, SAP integration, E2E, reliability,
MTA, docs, CodeQL and dependency checks
([run](https://github.com/arc-mcp/arc-1/actions/runs/39328086693)). No CI repair was needed.
Local simplified-runtime suite: **9,388 tests / 339 files**, no failures/skips; build, typecheck,
lint, policy, file/schema budgets and strict docs passed. Tool-definition snapshots were unchanged.

**Restoration:** original 0.9.27 droplet healthy at 21:28:45 UTC; environment, process settings,
route destinations and binding IDs matched baseline. Workspace bytes and all 81 previously selected
tool IDs were restored. Native MCP was disabled again in the isolated workspace; its window and two
completed login tabs closed. Other VS Code window preserved. Private CF snapshots/logs deleted.
Sanitized local evidence: `/tmp/arc1-pr1025-final-live/` (`candidate.json`, `copilot-evidence.json`,
`editor-observations.json`, `acceptance-summary.json`, `rollback-verified.json`,
`workspace-restored.json`, CI snapshots). Temporary paths are not durable repository artifacts.

## Consolidation checks — 20 October

The setup guide now separates three VS Code steps from the two Eclipse deployment cases. Nine
chronological notes became this verification record and the decision record; the full originals
remain linked below. The roadmap lists remaining work rather than repeating the test chronology.

The small code cleanup reuses the existing SID grammar directly and makes formatter guards explicit.
All **9,388 unit tests / 339 files** passed. Build, typecheck, lint, policy, file/schema budgets,
strict documentation build and the eight-call/four-client HTTP smoke passed. The rendered setup
page was inspected and 199 local/repository Markdown links checked. No tool schema or default changed.
This cleanup was **not redeployed**; live opening evidence remains tied to `7b00407a` above.

Fresh Claude Code **Opus 5.5 / max** read-only review confirmed code equivalence. Two documentation
gaps were corrected: explicit ADT 1.2 minimum/recovery guidance and Eclipse qualification limits.
Identity-probe scope and always-sent hint wording were clarified; the destination-settings command
title was verified in the installed manifest. The reviewer inspected local evidence but ran no tests.

## Native resolver contract tests

On 19 October, native SDK tests against confirmed local destination `A4H2023-2`
(A4H backend, SAP client 001) made **18 calls**:
12 expected successes, two expected errors and **four unexpected mismatched-type successes**.
Separately, 18 exported-schema assertions passed. These counts are not 18 acceptance passes.

| Input | Result |
|---|---|
| Name/type: `CL_ABAP_TYPEDESCR`, `IF_SERIALIZABLE_OBJECT`, `SAPMSSY0`, `I_CURRENCY`, `/DMO/I_FLIGHT` | Main source resolved; five list calls returned `mainFile` and source/metadata/include entries |
| Class `/source/main` or `.clas.abap` AFF filename | Same canonical source as name/type |
| Class base ADT URI | `.clas.json` metadata; unsuitable as the source link |
| `read_file`, class name/type, ACTIVE, offset 1 / limit 5 | Five source lines and continuation offset 6; total 607 lines |
| Missing class | `UNRESOLVED_IDENTIFIERS`, no fabricated URI |
| Mixed `uri` and `objectName` identifier | Schema rejection |
| `CL_ABAP_TYPEDESCR` supplied as INTF (get and list) or ZZZZ (get); `SAPMSSY0` as CLAS (get) | All resolved the actual class/program instead of rejecting the type |

Minimal mismatch reproduction: call `abap_object_get_file_uri` with the normal
[name/type input](ide-navigation-decisions.md#vs-code-resolver-contract), changing CLAS to INTF.
This does not establish same-name collision behavior. Verify returned identity before linking.
No upstream type-mismatch report was sent during this investigation.
Program lists also contained duplicate text-property URIs: select `mainFile`, not the first item.
Canonical include resolution passed; include **opening** remains unqualified.
Evidence: `/tmp/arc1-oneof-20261019/` (`tools.json`, `live.json`, `wrong-types.json`, `schema.json`).

## Earlier local, Eclipse and client tests

These experiments include removed VS Code direct-link settings; they are retained as evidence,
not instructions for configuring the current implementation.

| Test | Observed result / boundary |
|---|---|
| Flat VS Code handler, 17 October | CLAS, INTF, PROG, namespaced DDLS and class definitions/implementations opened. Macros/testclasses failed while disconnected; not qualified. Copilot rendering/opening was tested separately from ARC-1 dispatch. |
| Packed `npx` ARC-1, links off / old VS Code / Eclipse | Live class reads had identical source hashes; only explicit modes added their links. Four Eclipse main-object types returned expected URIs. |
| Local HTTP `/mcp` | Explicit preferences, opt-out and wrong mappings behaved correctly; source unchanged. Later native-only SDK smoke: eight calls from four concurrent clients, links only for Eclipse. |
| Eclipse native dialog and Chrome handler | Dialog opened CLAS/INTF/PROG/DDLS in A4H_2023; namespaced opening remains unverified. Chrome opened class source after OS confirmation and enabled `adt` handler. Duplicate A4H SID/client caused chooser. |
| Eclipse Copilot local stdio | Per-server `env` arrived unchanged; one live class read and link rendering passed. Automated click did not establish a fresh opening. |
| HTTP anchor / 302 → Eclipse | Both browser-to-Eclipse prototypes opened class source. User separately confirmed Copilot opens a browser. Full sequence not observed together; screenshots cannot distinguish direct link from handoff. |
| Real VS Code `npx` + envFile/per-server env | Packed branch source read and exact generated-link rendering passed; uses the retired direct-link mode. |
| Real Claude Code, two `npx` servers | Same source hash; only opted-in server linked. Eight SDK cases across four client names confirmed process preference wins over claimed identity. |
| Claude plugin configuration | Real isolated plugin probes qualified default and saved-value env substitution, then isolated strict manifest validation passed. Installed ARC-1 UI / Desktop opening was not qualified. |

Actual clients' identity probes: VS Code sent `Visual Studio Code/1.142.0`, Eclipse
`GithubCopilot/1.527.0`, Claude `claude-code/2.1.302 (sdk-cli)`. Initialized clientInfo was unavailable
in later stateless handlers; made-up claims were accepted. Real VS Code/Eclipse relays reached BTP
and read source. These were identity/transport tests; direct client OAuth was tested later below.

Plugin false starts are not passes: empty strict MCP config excluded the plugin; an explicit-env
probe did not connect; old Homebrew launcher/model rejection and `posix_spawn` failures preceded a
successful fresh NVM Node/Claude probe with an exact tool permission. Root strict validation still
warned about ignored CLAUDE.md; an isolated manifest pass does not erase it. Dropdown `enum` failed,
`options` passed but was deferred for its minimum-version requirement.

## Historical BTP matrix

18 October runtime `adfae1e1`: four targets passed pinned and aggregate reads with the then-current
VS Code mapping: PP `A4H/001`, duplicate-SID `A4H-2025/001`, `NPL/001`, shared Basic
`A4H-BASIC/001`. The initial 30 reads had 29 successes and one A4H/100 timeout.
Eight post-restart/token-refresh reads passed. Only A4H/001's real local alias was clicked;
other aliases tested serialization, not laptop-to-backend matching. Both workspaces used one human
identity, not two SAP users.

19 October runtime `ecf89bde`, deployed head `22b9ff49`, added Eclipse using the since-removed
combined `ARC1_IDE_LINKS=on` mode. The current `eclipse`-only HTTP mode has automated coverage but
has not been deployed for a fresh live Eclipse check:

| Checks | Outcome |
|---|---|
| Four baselines + four targets × both editor styles × both routes | 20 successful source reads |
| Missing/user-agent-only/unknown/conflicting preferences and wrong/conflicting maps, both routes | 12 successful reads without links |
| Concurrent preferences and preference-free follow-up | Four passed; no leakage |
| Eclipse INTF, PROG, DDLS | Three source reads + expected native URI paths |
| Both routes × both styles/no preference, after restart and again after token refresh | Six + six passed |
| No bearer / unknown pinned / unknown aggregate | 401 / 404 / tool error, no link leakage |
| A4H/100 pinned active class | Timeout after 121.3 seconds; one error block, no link |

Original source blocks matched per-target baselines. Actual VS Code and Eclipse Copilot each made
three successful BTP reads across pinned, aggregate and restart cases. VS Code clicked class source
after local ADT login recovery; Eclipse rendered the link, direct click remained inconclusive.
[CI on `22b9ff49`](https://github.com/arc-mcp/arc-1/actions/runs/39228587820):
9,684 unit passes per Node version, integration 261 passed/98 skipped, E2E 143 passed/4 skipped.
Skips are not acceptance evidence; CI merge-ref counts differ from local branch counts.

**Client 100 remains unreliable.** SYSTEM discovery and pinned/aggregate active source samples
succeeded, but 120-second source timeouts also reproduced with explicit active selection after restart
and on original app **0.9.27**. Active version is not a workaround. Trace anchors:
18 October `REQ-15` 20:59:42–21:01:42 UTC and `REQ-37` 21:01:51–21:03:51;
19 October `REQ-230` 09:54:46–09:56:46. IDs are process-local; use timestamps.
Destination setup succeeded first; SAP/Connectivity source-read cause remains undiagnosed.

Initial isolated deployment hit route/memory quotas (10 routes/instances, 4096 MiB); stopped candidate
deleted. Later authorized tests reused the existing one-instance app and restored it each time.
One historical `cf push --no-route` temporarily unmapped the route; remapping restored effective
routing but changed route-destination metadata. Later tests retained routes unchanged. CF login,
BTP application OAuth and local ADT login are three separate sessions.

## Failures worth retaining

| Observation | Recovery / what it does not prove |
|---|---|
| ADT 1.2 installed but resolver tools missing | Older 1.1.2 process owned port 2237 (20 tools); isolated 1.2 provider exposed 33. Temporary ports 2240/2242/2243 were test isolation, not setup requirements. |
| Destination listed but `No ABAP project found` / `PROJECT_NOT_LOGGED_ON` | Browser logon then native **Open Object** recovered the confirmed alias. Automatic logout/debugger HTTP 400 was observed; timing does not establish cause. |
| Bare canonical `abap:` Markdown not clickable | SAP `/open?abapUri=` wrapper fixed rendering; final two URI comparisons/openings passed. |
| Disconnected/file-not-found preview | Local Retry Logon, close stale preview, retry identical link. Do not create a missing file or switch destinations. |
| Pinned schema cached for aggregate tool name (`must NOT have additional properties`) | Window reload + stable separate entries recovered actual Copilot reads/restart. Reset Tools/Restart Server alone did not clear that validator cache; do not remove required `target`. [VS Code #321662](https://github.com/microsoft/vscode/issues/321662). |
| Old initialize hint after server restart | Reset Cached Tools + Reload Window + fresh chat delivered the new hint, verified in serialized tool definitions. |
| Model retried native/search/Bridge after resolver error; once guessed alias A4H | Failed stop-behavior tests. Revised runs preserved alias; final explicit ARC-1 404 case stopped. All-model/native-error stopping still unqualified. |

## Review, retained regressions and next tests

Actual Claude Code **Opus 5.5 / max** reviews covered implementation and evidence. Fixes retained:
CLI exports suppress decoration; nested audits precede it; per-server preferences avoid cross-system
alias contamination; source/name/type verification; malformed UTF-16 labels respect instruction budgets.
Latest native-only review found no P1/P2; malformed-name/cache tests and minor wording corrections landed.
Reviews are not substitutes for the separate live runs.

Deterministic coverage remains for pinned/aggregate PP and shared Basic, both authorization modes,
two users, scope/target/drift denials, duplicate headers, absent/untrusted client hints, cache ETag/304
revalidation without preference leakage, original source/JSON preservation, bounded identities,
hyperfocused audits, no extra SAP calls, CLI exports and 2,048-character instruction limits.
Removed tests belonged to the retired VS Code formatter/parser.
Early local subprocess deadline failures also reproduced on base; later complete runs/CI passed
without weakening timeouts or assertions.

| Remaining work | Tracking |
|---|---|
| Client-100 diagnosis; second authorized SAP identity; known-but-ungranted live `xsuaa-attribute` target; PP-only multi-instance deployment (do not scale shared-Basic test app) | [COMPAT-19](../../docs_page/roadmap.md#compat-19) |
| Native session recovery, type collisions, include opening, unusual aliases, other OS/models/harnesses; local destination picker; dirty buffers, Keep/Undo, save/transport/activation | [COMPAT-20](../../docs_page/roadmap.md#compat-20) |
| Fresh direct Eclipse Copilot click with handler enabled; exact project selection/collisions/missing/cloud projects; installed Claude/Desktop UI | [COMPAT-21](../../docs_page/roadmap.md#compat-21) |

No credentials, source bodies, vendor implementation excerpts or private environment snapshots are
committed. Full dated logs, historical hashes/counts and superseded setup details remain in the
[immutable nine-note archive](https://github.com/arc-mcp/arc-1/tree/50ba71c6f0ce4da16fcbc73d7e907bb67a57685c/docs/research).
