# Transport review: useful MCP evidence

**18 October 2026.** Refocus of [#1008](https://github.com/arc-mcp/arc-1/pull/1008).
[Plan](../plans/2026-10-18-transport-review-mcp.md). This supersedes the CLI/HTML scope;
the earlier reports remain historical evidence, not approval of the revised implementation.

## Confirmed problems on main

Main `2cb7b044` retains the original transport code. The eight synthetic observations
were rerun against its production code in the notebook extraction checkout (`84d4aa1b`):
selected class includes can disappear on 404; speculative changed parts can be called
unchanged; REPT-only entries can produce unrelated source diffs; undated work states
can lose their baseline; one wide line can bypass the display cap; malformed or paged
history can look empty/complete. A missing predecessor is described as creation.

The requested value is reliable evidence through `SAPTransport.diff`, including gaps.
No local runner, report schema, HTML, output directory or automatic check orchestration is needed.

## Live baseline

[Sanitized result](transport-review-mcp/baseline-summary.json): existing Basic identity,
A4H/001 over HTTPS 443, real local public dispatcher, writes disabled. Eight existing
inventories plus A4HK906371 used 18 high-level GETs and no mutations. This is not a
Cloud Foundry deployment or principal-propagation test. Previously verified SAP_BASIS
758 SP02; release was not queried again during this baseline.

A4HK906371 still compares 00001 (A4HK906369) to 00002 (A4HK906371):

| Object / part | Observed change |
|---|---|
| ZCL_ARC1_TD_CALC / main | Adds `+ 1` |
| ZCL_ARC1_TD_CALC / implementations | `* 2` becomes `* 3` |
| ZARC1_TD_REPORT / main | One changed literal line |

All three have +1/−1 line counts and exact transport attribution. This is the happy
path to preserve; it does not reproduce every synthetic failure against SAP.

## Source-history families

[Fresh probe](transport-review-mcp/families-summary.json), local ADT facade at `96191c62`,
same identity/system, 25 high-level GETs, no mutations:

| Family | Fresh evidence | Qualification |
|---|---|---|
| CLAS, PROG | Two numbered snapshots with differing bytes and transport IDs | Historical before/after demonstrated |
| INTF, DDLS | One numbered snapshot plus active source | History readable; no two-snapshot change in this sample |
| DCLS, BDEF, SRVD, INCL, FUNC | Readable feed with one active version | Endpoint works; historical pair not demonstrated here |

These are the existing nine mappings. Class includes use their own feeds; function
modules require their owning group. Endpoint availability does not mean every object
has retained history. Method keys identify a source part, not ownership of each hunk.

## Dictionary spike: advertised does not mean usable

Current metadata for DOMA, DTEL and TTYP advertises `relations/versions`. The feed needs
`Accept: application/atom+xml;type=feed`; a plain Atom Accept returned 406 with that
native requirement. The DOMA feed exposes 00001 attributed to A4HK906369. The DTEL and
TTYP samples expose only 00000 attributed to their existing tasks.

However, the advertised content URIs all return HTTP 403: `Request version for
DOMA/DTEL/TTYP is not supported`. Repeating with each feed's exact advertised content
media type gives the same result. [Observed failures](transport-review-mcp/ddic-history-summary.json).
No working historical Dictionary adapter is established; current metadata is not a baseline.
TABL's source response in this sample advertises no history link. Do not generalize that
observation to every table representation or release.

Resume with a backend that returns two historical content snapshots, their media types
and transport attribution. Text pools, group includes, metadata, deletions and Customizing
keys likewise need verified historical contracts. No ABAP helper or RFC fallback belongs here.

## MCP and BTP validation

[Real HTTP MCP replay](transport-review-mcp/http-summary.json): nine IDs, 66 high-level GETs,
zero mutations. A viewer API key called the public Streamable HTTP endpoint; SAP used the
existing read-only Basic identity. The known released request preserved all three +1/−1
changes in 2,207 bytes. Mixed requests returned Dictionary/FUGR/text gaps; the largest response
was 18,186 bytes. The empty request returned an empty inventory. The task ID A4HK906372
returned not found; use the parent request ID on this backend.

Pinned and aggregate server tests verify selected PP identity, read scope, deny rules,
explicit target, target grants, audit context, inherited cancellation and per-read budgets.
Shared Basic tests verify that a history 401 stops fan-out and blocks the next call, and
cancellation releases a queued caller. Per-part 403 notes on multi-target routes expose only
status, not SAP/Cloud Connector bodies. The 20-second collection deadline leaves headroom
below the 30-second shared-target acquisition timeout; startup/identity probes are separate.

This is not a deployed CF/Cloud Connector or live principal-propagation qualification.
No BTP ABAP backend was tested. The existing source endpoints are attempted without inventing
support or an unsupported-platform ban from missing registry entries alone.

## Open-request baseline correction

A fresh read-only probe of A4HK906373 found the active version of ZCL_ARC1_DEMO_CALC
at 11:22:09, while snapshot 00002 was created at 11:23:41. Active source equals 00002;
comparing it to 00001 incorrectly repeats an earlier transport's +1-line change.
An attributed 99999 draft also exists; its changes are outside this active-source review.

Two regression cases (older and tied active timestamps) failed before the fix. Active selection
now examines all historical snapshots, skips same-request saves, and preserves uncertainty
where their ordering conflicts. It never selects the draft. A real HTTP MCP replay preserved
the three released changes and returned 00002 → 00000 with zero changes for the open request:
14 GETs, zero mutations. [Sanitized evidence](transport-review-mcp/http-final-summary.json).

## Review and checks

The design and [BTP follow-up](transport-review-mcp/claude-design-followup.md) were reviewed by
Claude Code Opus 5.5 Max in the GUI. The [implementation review](transport-review-mcp/claude-implementation-review.md) found the
active-baseline defect above. Its documentation/test issues, safe local error notes, pending-draft
visibility and catalog headroom have been addressed. The [final review](transport-review-mcp/claude-final-review.md)
found no remaining blockers at `d595157f`, conditional on CI. Claude independently ran 1,096
focused tests, 13 probes, the final surface checks and a clean merge/schema check with #1020.

| Local check | Result |
|---|---|
| Full unit suite, runtime commit `98c3b028` | 332 files / 9,299 tests pass (`--maxWorkers=2`) |
| Tool surface after wording-only `d595157f` | 127 tests pass; six snapshots regenerated and reviewed |
| Typecheck, build, lint, policy, strict docs, file/schema budgets | Pass |
| Golden live integration case, A4HK906291 | Pass; aligned the old comparison-label assertion, retaining all attribution checks |
| Combined schema with dump-filter #1020 at `60127869` | 74,454 bytes / ~18,614 tokens; all scenarios pass |

The golden integration case failed on its old label assertion before that test-only correction
and passed afterward; no runtime change was needed.

The combined schema failed at 74,504 bytes before the 50-byte wording reduction. No ceiling
was raised. The combined check includes #1020's description-count adjustment; it is a schema
compatibility check, not a test of that PR's runtime. An earlier unrestricted-worker run hit three
startup timing failures; those startup files also passed on clean main. The complete bounded-worker
run above passed without changing startup behavior. Earlier #1008 approvals cover the superseded
CLI/report implementation only.

The SAP Marketplace was re-opened on 18 October: its current feature list still includes
Timeline, Transport Organizer, feeds, Dictionary logs and notebooks. SAP Help's MCP page
returned no readable text, so it adds no new backend-contract evidence. The installed 1.2
research remains pinned in the [archive index](adt-vscode-1.2/README.md).

Raw source and response bodies stay in ignored `test-results/transport-mcp/`. Original local
inputs and uncommitted work are preserved. FEAT-90 retains only the unsupported historical
scope; report renderers and notebook runners are not roadmap commitments.
