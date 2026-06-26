# Deep Issue — research & validate an external GitHub issue against real sources

Deeply research a community-filed issue on **`arc-mcp/arc-1`** before anyone touches code. The whole point: **decide whether the issue is real, and why, from verified evidence — not from the reporter's claim and not from memory.** ARC-1's worst bugs come from reasoning about ADT behavior instead of checking what the system actually does; the same trap turns a plausible-sounding issue into a wrong fix.

Use this for any non-trivial external issue (bug report, feature request, "X doesn't work on release Y"). For an obvious typo-fix or a duplicate you can close in one line, just do that directly.

The output is a **validated dossier + a paste-able GitHub reply + a recommendation** — not a code change. When the verdict is "fix it," hand the dossier to **`/deep-feature`** (which owns research→plan→implement→PR).

---

## Input

An issue number or URL (e.g. `379` or `https://github.com/arc-mcp/arc-1/issues/379`). If the user gives a vague description instead, ask for the number, then start.

---

## The prime directive

**No verdict until you have the full picture.** "Full picture" means you can answer, with evidence: is the reported behavior real on a live system, what the ADT endpoint actually does, whether HEAD already fixes it, what the true root cause is, and which releases are affected. Until then you are still in Phase 1.

A reporter saying "reproduced on SAP_BASIS 8.16" is a lead, not a fact — confirm it. A `200 OK` does **not** mean a filter/type/parameter was honored; ADT silently ignores unknown ones. Verify response *content*, not just status. The issue may be **already fixed on HEAD** (cf. #378: the fix existed, only a stale comment + doc hint remained) or a **duplicate** of a known dossier.

---

## Research Sources (concrete — same sources `/deep-feature` uses)

All `~/DEV/*` repos are **read-only references** — never modify them. If a path is missing, note it and continue.

| Source | Where | Use it for |
|--------|-------|------------|
| **The issue itself** | `gh issue view <n> --comments`; linked PRs via `gh issue view <n> --json` | The claim, the repro steps, prior maintainer replies, any linked fix attempt |
| **ARC-1 project guide** | `CLAUDE.md`, `INFRASTRUCTURE.md` | Conventions, Key-Files map, code patterns; the **3 live systems** + how to reach them |
| **Current HEAD code** | the cited `src/...` files (use `grep -a` — `intent.ts` contains raw NULs) | **Is it already fixed / never was as described?** Read the exact lines the issue cites before believing them |
| **Prior issue dossiers** | `docs/research/issues/` (e.g. `293-ecc-423-invalid-lock-handle.md`) | Duplicate? Same root cause as a solved one? Reuse the proven analysis |
| **ARC-1 live research notes** | `docs/research/`, type-code evidence under `docs/research/abap-types/` | Prior **live spikes & ground truth** — read first so you don't re-derive proven facts |
| **Competitor / reference trackers** | `docs/compare/` (esp. `docs/compare/05-fr0ster-mcp-abap-adt.md`, `docs/compare/01-vibing-steampunk.md`) | Did a sibling client hit the same SAP bug? Issues often cite `fr0ster`/`vibing-steampunk` precedent |
| **Eclipse ADT — apidoc + contracts** | `~/DEV/arc-1-eclipse-adt/` (`com.sap.adt.core.apidoc-*`, `api/01..20-*.md`) | **Exact ADT endpoint URIs, media types, request/response contracts.** Ground truth for "what should this endpoint do" |
| **SAP ADT language server** | `~/DEV/arc-1-lsp/` (`vendor/adt-ls`, `docs/adt-ls-*`) | How SAP's **own** server calls ADT — a second independent witness |
| **Reference ADT-over-MCP impls** | `~/DEV/mcp-abap-adt/`, `~/DEV/mcp-abap-adt-fr0ster/` | How **others** implement the same op — and whether they fixed this exact bug |
| **ABAP language reference** | `~/DEV/abap-docs/docs/` | ABAP keyword/syntax semantics when the issue touches language constructs |
| **SAP docs / Notes (MCP)** | `sap-docs` MCP (`search`, `fetch`, `sap_community_search`, `sap_search_objects`, `abap_feature_matrix`) + `sap-notes` MCP (`search`, `fetch`) | Official docs, community threads, and SAP Notes/KBAs for known corrections — **cite the Note number** when a fix depends on it. For broad web research, `/deep-research` |
| **Live SAP systems** | `arc1-cli call <Tool> ...`, `npm run probe -- --save-fixtures tests/fixtures/probe/<name>`. Systems: **NW 7.50** (`npl`), **S/4HANA 2023 / 758** (`a4h`), **ABAP Platform 2025 / 816** (`a4h-2025`) — creds + recipes in `INFRASTRUCTURE.md` | **Ground truth.** Reproduce the issue yourself, on the release(s) it names |

---

## Phase 1: Triage & frame

1. **Fetch everything** — `gh issue view <n> --comments` plus `--json title,author,labels,body,closed,stateReason` and any linked PRs/issues. Note the **author** (external contributor?), the **claimed release**, and any prior maintainer reply (don't contradict yourself across the thread).
2. **Restate the claim** in one paragraph: what the reporter did, what happened, what they expected. Identify the SAP objects/operations and the exact ARC-1 files/endpoints cited.
3. **Classify** — `bug` / `feature-request` / `question-or-support` / `duplicate` / `already-fixed`. A quick `grep` of `docs/research/issues/` and open+closed issues (`gh issue list --search`) catches duplicates before you spend an hour.

## Phase 2: Verify the claim (this is the work)

Work the sources above until the prime directive is satisfied:

4. **Read HEAD first** — open the cited files (`grep -a` for `intent.ts`). Frequently the code already disagrees with the issue (fixed, or never behaved as described). State what HEAD actually does, with `file:line`.
5. **ADT contract** — in `~/DEV/arc-1-eclipse-adt`, find the endpoint(s) the issue touches: exact URI, verb, Accept/Content-Type, request/response shape. Cross-check `~/DEV/arc-1-lsp` and the `mcp-abap-adt*` repos. Check `sap-notes`/`sap-docs` for a known SAP-side correction.
6. **Reproduce live** — the deciding step. Run the reporter's scenario via `arc1-cli call ...` (or `npm run probe`) on the **release they named**, and on a second release if the area is release-sensitive (DDIC routing, locks, activation, lint, release detection). **Capture the real response body.** Distinguish the three outcomes: reproduces / doesn't reproduce / reproduces differently.
7. **Root cause** — explain *why*, grounded in the captured evidence. If it's the same mechanism as an existing dossier, say so and link it. If the reporter's proposed cause is wrong (cf. #293, where Note 2727890 was the wrong fix), correct it explicitly.
8. **Map impact** — using the Key-Files table in `CLAUDE.md`, list every file a fix would touch (source + tests + docs + the three-file schema trio when a tool surface changes), and the per-release behavior.

### Phase 1–2 exit gate — do not write the verdict until all are YES:
- [ ] I reproduced the issue live (or proved it does **not** reproduce), on the release(s) it names, with the response body captured
- [ ] I read the cited HEAD code and stated what it actually does today
- [ ] I checked the ADT contract (eclipse-adt) and ≥1 reference repo / SAP Note
- [ ] I checked for a duplicate in `docs/research/issues/` and open/closed issues
- [ ] I know the true root cause and the per-release behavior

## Phase 3: Write the dossier

Capture findings in **`docs/research/issues/<n>-<short-slug>.md`** (the existing convention — model it on `docs/research/issues/293-ecc-423-invalid-lock-handle.md`):

- **Status** + one-line verdict (e.g. "Confirmed bug, root cause validated live 2026-06-09" / "Not reproducible on 816, likely client-side" / "Already fixed on HEAD — docs gap only" / "Duplicate of #NNN").
- **TL;DR**, **live validation** (the `arc1-cli` commands run + observed before/after, ideally a small table), **root cause**, **affected files**, **out of scope**.
- This dossier is durable and is the input `/deep-feature` builds on — write it for a reader who wasn't here.

## Phase 4: Reply & recommend

1. **Draft the GitHub comment** — paste-able markdown in a fenced block in the dossier (as #293 does). Lead with the verdict, give the evidence, be precise and kind to the external reporter, cite Note numbers / `file:line` / releases. **Do not post it** — hand it back for the user to review and post (origin = `marianfoo`).
2. **Recommend the next step**, explicitly:
   - **Fix it** → "hand this dossier to `/deep-feature`" (point it at `docs/research/issues/<n>-*.md`). For a one-file surgical fix, `/implement-feature` instead.
   - **Close** as duplicate / already-fixed / works-as-designed → the drafted comment is the closing rationale.
   - **Needs info** → the drafted comment asks the reporter for the specific missing piece (release SP, exact payload, response body).

---

## Guardrails & notes

- **Verify-first is non-negotiable** — the value of this command is Phase 2. If you're about to write a verdict on an unverified ADT fact, stop and reproduce it.
- **Never auto-post, label, or close** the issue, and never push anything — return paste-able markdown; the user acts on origin (`marianfoo`).
- `~/DEV/arc-1-eclipse-adt`, `~/DEV/arc-1-lsp`, `~/DEV/mcp-abap-adt*`, `~/DEV/abap-docs` are **read-only**. Understand behavior; don't copy SAP code.
- If a live system is unreachable, see `INFRASTRUCTURE.md` (Docker stop/start, start Cloud Connector manually) before concluding "can't reproduce."
- **Related:** `/deep-pr` (review the fix PR), `/deep-feature` (own the fix), `/deep-research` (broad web research), `update-competitor-tracker` (if the issue mirrors a sibling-repo bug).
