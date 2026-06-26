# Deep Feature — full research → plan → ship lifecycle for ARC-1

The way to start a substantial ARC-1 topic. Drives a feature from **deep, cross-source research** through a verified plan, autonomous implementation, live testing, and a PR. The whole point: **get the full picture from real sources before planning anything** — ARC-1's bugs come from planning ADT behavior from memory instead of checking what the system actually does.

Use this for any non-trivial change (new ADT operation, behavior change, bug with unknown root cause, anything SAP-touching). For a tiny surgical edit you already understand, just do it directly.

This replaces the long "first research in detail using docs, other repos, eclipse adt code, adt-ls, adt apis, sap test systems… then plan, review, implement, test, PR" prompt — the sources below are now concrete.

---

## Input

The user gives a feature/bug/topic description (free-form, a gap-analysis item, a GitHub issue, or a run log). If it's vague, ask 1–2 targeted questions, then start researching. Don't over-interview.

---

## The prime directive

**No planning until you have the full picture.** "Full picture" means you can answer, with evidence: what the ADT endpoint actually is and returns (verified live, not assumed), how SAP's own tools call it, how others implemented it, which ARC-1 code is affected, and how behavior differs across SAP releases. Until then, you are still in Phase 1.

A `200 OK` does **not** mean a filter/type/parameter was honored — ADT silently ignores unknown ones. Verify response *content*, not just status.

---

## Research Sources (concrete — this is what "docs / other repos / eclipse adt code / adt-ls / adt apis" mean)

All `~/DEV/*` repos are **read-only references** — never modify them. If a path is missing, note it and continue.

| Source | Where | Use it for |
|--------|-------|------------|
| **ARC-1 project guide** | `CLAUDE.md`, `INFRASTRUCTURE.md` (repo root) | Conventions, Key-Files-for-Common-Tasks map, code patterns; the **3 live systems** + how to reach them |
| **ARC-1 live research notes** | `docs/research/` — e.g. `tabl-append-create-spike-a4h.md`, `abap-platform-2025-new-adt-apis.md`, `sapquery-freestyle-capability-matrix.md`, `adt-transaction-source-write.md`; plus the type-code evidence under top-level `docs/research/abap-types/` | Prior **live spikes & ground truth** — read these first so you don't re-derive what's already proven |
| **ARC-1 prior plans** | `docs/plans/completed/` | How similar features were actually built, tested, and verified |
| **Eclipse ADT — apidoc + endpoint contracts** ("eclipse adt code", "adt apis") | `~/DEV/arc-1-eclipse-adt/` — `com.sap.adt.core.apidoc-3.58.1/` (SAP's ADT Javadoc), `api/01..20-*.md` (topic-by-topic endpoint contracts: RAP URIs, lock/create/update/transport, activation/checkruns/inactive, code-nav/completion, where-used, quickfixes/ATC, repository search, DDIC metadata, transports, API release-state, pretty-printer, runtime traces, feature probes), `adt-api-is-documented.md`, `apis.md` | **Exact ADT endpoint URIs, media types, request/response contracts, and observable Eclipse-client behavior.** Start here for any new/changed endpoint |
| **SAP ADT language server** ("adt-ls code") | `~/DEV/arc-1-lsp/` — `vendor/adt-ls`, `vendor/adt-vscode-*.vsix`, `docs/adt-ls-reference.md`, `docs/adt-ls-tool-surface.md`, `docs/adt-ls-headless-notes.md` | How SAP's **own** language server calls ADT; its tool surface; headless behavior — a second independent witness to endpoint contracts |
| **Reference ADT-over-MCP implementations** ("adt code" / "other repos") | `~/DEV/mcp-abap-adt/`, `~/DEV/mcp-abap-adt-fr0ster/` | How **others** implement the same ADT operation — docs/compare approaches, discover endpoints/headers you missed |
| **ABAP language reference** | `~/DEV/abap-docs/docs/` | ABAP keyword/syntax semantics when the feature touches ABAP language constructs |
| **SAP docs / Notes (MCP)** | `sap-docs` + `sap-notes` MCP tools | Official documentation, Discovery Center, community, and SAP Notes for known issues/corrections (cite the Note number when a fix depends on it) |
| **Live SAP systems** ("sap s4 and 7.5 test system") | `arc1-cli call <Tool> ...`, `npm run probe -- --save-fixtures tests/fixtures/probe/<name>`, `npm run test:integration` — creds + recipes in `INFRASTRUCTURE.md`. Systems: **NW 7.50** (`npl`), **S/4HANA 2023 / 758** (`a4h`), **ABAP Platform 2025 / 816** (`a4h-2025`) | **Ground truth.** What the endpoint ACTUALLY returns, per release. The deciding source when docs and code disagree |

---

## Phase 1: Deep Research

Work the sources above, in roughly this order, until the prime directive is satisfied:

1. **Frame** — restate the goal and the SAP objects/operations involved. Read `CLAUDE.md` + relevant `docs/research/` notes first (someone may have already proven the hard part).
2. **ADT contract** — in `~/DEV/arc-1-eclipse-adt`, find the endpoint(s): exact URI, HTTP verb, Accept/Content-Type, request body, response shape. Cross-check against `~/DEV/arc-1-lsp` (adt-ls) and the `mcp-abap-adt*` repos for how each calls it.
3. **Verify live** — confirm the contract on a live system. `arc1-cli tools <Tool>` for the live schema, `arc1-cli call <Tool> ...` end-to-end, `npm run probe` for type availability/response shapes. **Capture the real response body** (save to `tests/fixtures/...`). Re-check on the oldest (7.50) and a newer (758/816) system if the area is release-sensitive (DDIC routing, locks, activation, lint, release detection).
4. **Map ARC-1 impact** — using the Key-Files table in `CLAUDE.md`, trace the call chain and list **every** affected file (source + tests + docs + skills), with stable symbol names. Note adjacent paths that share state (create/update/delete/activate, read/write, the `withSafety()` clone).
5. **Write the dossier** — capture findings in `docs/research/<topic>.md` (dated): the verified ADT contract, the `arc1-cli`/probe commands run + observed output, per-release behavior, affected ARC-1 files, and open questions. This dossier is durable, feeds the plan, and survives ralphex's isolated task sessions.

### Phase 1 exit gate — do not proceed until all are YES:
- [ ] I know the exact ADT endpoint(s) and verified the response **content** live (not just a 200)
- [ ] I checked how SAP's adt-ls and ≥1 other repo call it
- [ ] I know per-release behavior (or confirmed it's release-invariant)
- [ ] I listed every affected ARC-1 file + adjacent paths
- [ ] Findings are written to `docs/research/<topic>.md` with cited evidence

*(These are this skill's gate, not a ralphex plan — checkboxes here are fine.)*

---

## Phase 2: Plan

Only now, invoke the **`/ralphex-plan`** skill to produce the plan. Hand it your `docs/research/<topic>.md` dossier so it builds on your verified evidence instead of starting cold — point it explicitly: *"use the verified findings in docs/research/<topic>.md; cite that evidence in the plan."* ralphex-plan owns the plan structure, format rules, task sizing, and artifact coverage.

---

## Phase 3: Review the plan against the SAP test systems

Before any execution, validate the plan's assumptions live (this is the cheapest place to catch a wrong assumption):
- Re-run the key `arc1-cli`/probe checks the plan relies on; confirm each endpoint, type code, and payload shape the plan cites is real on the target release.
- Run ralphex-plan's adversarial review pass (ideally as a context-free reviewer) — every SAP fact cited, claims about current code literally true, adjacent paths covered, three-file schema sync present.
- Fix the plan, don't paper over gaps. If an assumption was wrong, the research was incomplete — go back to Phase 1 for that piece.

---

## Phase 4: Execute  ▶ default: hand off to ralphex

**Decision point** — pick based on size:

- **Hand off to ralphex (default; medium/large features).** Run `ralphex docs/plans/<name>.md` (or `ralphex --worktree docs/plans/<name>.md` to isolate). ralphex executes each task in a fresh session, runs validation commands, and runs its multi-agent + external review pipeline. Monitor via the progress log or `--serve`. Phases 5–6 below are partly covered by ralphex's pipeline; you still do the live-system verification it can't (it has no SAP creds unless configured).
- **Implement interactively (small, surgical changes).** Use the `/implement-feature` skill (TDD, plan-mode approval) in this session instead of ralphex.
- **Stop at the plan.** Deliver the reviewed plan + dossier and stop; the user runs execution later.

---

## Phase 5: Review the implementation

After execution (ralphex's pipeline or interactive), review the diff:
- Correctness against the plan + dossier; no scope creep; typed errors; LLM-friendly messages.
- Adjacent paths actually handled and tested; three-file schema sync intact.
- `npm run lint && npm run typecheck && npm test` all green.
- Consider `/code-review` for a focused pass.

---

## Phase 6: Test on the SAP test systems

The definitive check — runtime behavior, not just unit mocks:
- Run the live verification the plan specified: `npm run test:integration` / `npm run test:e2e` (needs `TEST_SAP_URL`; creds in `INFRASTRUCTURE.md`), or targeted `arc1-cli call ...`.
- **For object-write features, a successful `SAPActivate` on a live system is mandatory** — activation is the definitive correctness check (RAP CCDEF/CCIMP placement, DDIC table class, behavior-pool rules surface only here).
- Verify on ≥2 releases for release-sensitive areas. Throwaway smoke scripts: don't commit them.

---

## Phase 7: Final review & PR

- Final read of the full diff; confirm docs in `docs_page/` reflect **as-shipped** behavior; mark `docs/plans/<name>.md` done (ralphex moves it to `completed/`).
- Branch from `main` (ralphex already created a feature branch from the plan filename). **Push to `origin` (marianfoo) — never `upstream` (oisee).** Stage files explicitly; don't `git add -A` (the DEV tree accumulates other WIP).
- Conventional-commit title (`feat:`/`fix:` per `CLAUDE.md` Releasing). Open the PR with `gh`, summarizing the change, the live verification done (systems + releases), and linking the `docs/research/<topic>.md` dossier.

---

## Guardrails & notes

- **Research-first is non-negotiable** — the entire value of this skill is Phase 1. If you find yourself planning with unverified ADT facts, stop and verify.
- `~/DEV/arc-1-eclipse-adt`, `~/DEV/arc-1-lsp`, `~/DEV/mcp-abap-adt*`, `~/DEV/abap-docs` are **read-only**. Don't copy SAP code; understand behavior and contracts.
- If a live system is unreachable, see `INFRASTRUCTURE.md` (Docker stop/start, start Cloud Connector manually) before assuming a feature is broken.
- **Related skills:** `/ralphex-plan` (Phase 2 engine), `/implement-feature` (Phase 4 interactive path), `docs/ralphex.md` (how the autonomous runner works).
