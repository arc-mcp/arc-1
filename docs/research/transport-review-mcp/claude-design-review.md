# Claude design review — refocusing #1008 as MCP transport review

| | |
|---|---|
| Base | `origin/main` **`2cb7b044ae7c8e7805219deaf77b32f34228c2ea`** |
| Old PR head | #1008 **`19c728722e87b59f4915f6252af4ecee4dbf8e36`**, merge-base `ce649ca9`: 63 files, +4,933/−326. Main has not touched `transport-diff.ts` or the transport handler since that merge-base. |
| Pilot | `docs/research/2026-10-17-transport-pilot.md` and its summary JSON at `62eb17b4`. Eight A4H 758 requests run through the CLI at `56c1d518`. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-18 |
| Method | Read-only `git show` at fixed commits. One tool-schema budget run on a private archive of main. No SAP, GitHub, branches or shared edits. This is a design review, not an approval of #1008. |

## Verdict

**Main already ships the core MCP feature.** `SAPTransport action="diff"` already does the
following:

- pairs each object's revision under the request or its tasks with its predecessor;
- rolls LIMU entries up to their owning class;
- selects class includes from CTS components;
- includes request-level objects, which covers transports of copies;
- labels evidence with `baselineStatus`;
- pages objects with `offset`/`limit` (default 20, maximum 40).

Sources: `src/adt/transport-diff.ts:135-632` and `src/handlers/transport.ts:262-330`.

**What #1008 adds that is worth keeping:**

- about nine correctness fixes;
- bounded per-call collection;
- an output size cap.

**Drop everything else:** the CLI, workflows, artifacts, HTML, `reviewMode`, `continuation`,
`resultFormat` for `diff`, source hashes, the coverage buckets and most new per-part fields.

**Recommendation.** Build one focused `fix:` PR on a fresh branch from main:

- no new tool, action or parameter;
- no new module;
- roughly a few hundred lines of product code plus ported regression tests;
- close #1008 once it merges.

## Keep or drop

| #1008 element | Decision | Evidence |
|---|---|---|
| No creation claim from a missing baseline | **Keep (wording)** | Main says "no-prior-snapshot = created here" in the tool text (`tools.ts:1554`) and "Created in this transport" in `tools.md:1567`. A missing predecessor can come from purged history, imports or an incomplete feed. #1008's own plan answers "Does no predecessor prove a new object? No." |
| Chronology ambiguity (undated or out-of-order snapshots, undated work state) | **Keep** | Main can label a wrong pair `prior-revision` (#1008 review F7 and its regression tests). This is a pure function with existing labels. |
| A CTS-selected class include that returns 404 | **Keep the row** | Main returns `null` and drops it (`transport-diff.ts:489`), so an object can look whole while a part CTS named is missing (TD-01). |
| A speculative include that returns 404 | **Keep main's drop** | A missing CCAU/CCMAC on a whole-class entry is normal. Counting it as unavailable made nearly every whole class `partial` (#1008 review F9). |
| `suppressUntouchedParts` | **Replace** | Main blanks an unattributed sibling as "not changed by this transport" (`:625-632`), which can hide a real change (TD-02). #1008 removes it but then emits noisy old hunks. Keep the row and counts, omit the hunks, and say "not attributed to this transport" rather than "unchanged". |
| Text pool (`REPT`) handling | **Keep** | On main a REPT-only class change diffs `main`, which CTS never selected (`classIncludesFor`, `:389-390`), and the text change itself is invisible (F5). Return no source parts and name the text-pool gap. |
| Non-source parts of whole-object PROG/CLAS entries | **Keep, compactly** | 13 pilot entries carried these parts, and main shows nothing. Use one short object field, e.g. `notCompared: ["text pool","screens","GUI status"]`, not prose. |
| Strict revision-feed parsing; a `next` link means incomplete history | **Keep, in `xml-parser.ts`** | An empty or invalid body must not read as empty history. The `next` link has never been seen live (research queue), but the guard is about two lines. Don't move the parser into a new module. |
| Released requests never fall back to a different revision | **Keep the behavior, drop the input** | Main falls back to the latest revision (`:159-164`), producing a diff of some other change. Derive the rule from the existing status sets (`transport.ts:56-58`): `R`/`N` use only an attributable snapshot, `D`/`L` use the active state, and `O`/`P` get a note. |
| `reviewMode` parameter (`legacy`/`released`/`active`/`draft`) | **Drop** | The status already determines the intent, and `draft` is not the shipped state. The full on-prem catalog has **41 bytes / ~10 tokens** of headroom (74,459 of 74,500 bytes, ~18,615 of 18,625 tokens on main). |
| Work limit on the diff algorithm (jsdiff `timeout`/`maxEditLength`) and a 16 KiB per-part cap | **Keep** | Diffing is synchronous CPU work. One pathological pair can block the shared Node event loop for every BTP user. |
| Per-call bounds: deadline, MCP cancel signal, byte and send caps | **Keep, using live-relations' options object** | Main passes the cancel signal only when given one (`http-deadline.ts:121-126`). Today a cancelled `diff` keeps fanning out up to 40 objects × 5 parts × 3 reads. Reuse the `{signal, deadline, responseBudget, attemptBudget}` options object from `live-relations.ts:29-34` instead of the `ReviewBudget` class. |
| Stop early and resume an unfinished object on the next page (F1) | **Keep** | Without it, an object cut short by ARC-1's own limit is recorded as missing SAP evidence and then skipped. |
| Dispatch hint for the transport-review limit (F3); local limit text in minimal-errors mode (F8) | **Keep** | Without them the hint gives data-preview SQL advice or reads "request failed". Both are a few lines. |
| A total response cap of 512 KiB | **Lower it** | 512 KiB is about 128k tokens, far above what MCP clients accept; Claude Code caps MCP output at 25,000 tokens by default. Target about 64 KiB: omit hunks beyond the cap, keep the counts, and stop with `nextOffset`. |
| `continuation` token | **Drop** | Released requests are immutable. The token gates nothing, and binding it to user, destination and target adds no safety. A stable sort plus `totalObjects` already exists; document that pages of an open request are not a snapshot. |
| `resultFormat` for `diff` | **Drop** | It creates a second output shape that only the rejected CLI collector needed. Leave release's existing `resultFormat` alone. |
| `sourceHashes`, `retrievedAt`, `revisions{}`, `comparisonMode`, `activationStatus`, `selectionOrigin`, `attribution`, `historyCompleteness`, `statisticsComplete`, `change`, `components`, `scopeNote` | **Drop** | Review F6 measured the default page at **3.6×** its previous size, with hunks only about **13%**: revisions 9.4 KB, labels 5.3 KB, hashes 3.4 KB, scope note 3.1 KB and components 2.6 KB, against 4.3 KB of hunks. Each field is either derivable (`from`/`to`, `baselineStatus`, `added`/`removed`) or has no consumer without stored sessions. Components are already available through `get`. |
| `status` plus `coverage` buckets and `denominator`, `schemaVersion`, `sourceStability`, `metrics`, target and client echo | **Replace with one small summary** | In the pilot, 7 of 8 reviews were `partial`; only the empty request was `complete`, so the label became routine. Instead return counts per existing `baselineStatus`, a count of non-diffable objects, `stoppedBy` (`deadline`/`budget`/`output`) and `nextOffset`. Log metrics to stderr. |
| `isTestTransport` filtering | **Drop** | Parsed, but never observed live (research queue). |
| Rewrites of unrelated `SAPTransport` action descriptions | **Drop** | They risk changing model behavior on unrelated actions. Keep the `diff` wording change byte-neutral. |
| CLI, `src/workflows/*`, HTML, artifacts, demo script, `review-workflows.md`, CLI-guide additions, nav entry | **Drop** | Rejected by you; no consumer on main; local files are meaningless on CF. |
| Research archive (HTML reports, PNG, handoff prompt) | **Link, don't port** | Link to #1008 by commit permalink. |
| Roadmap FEAT-86 "Broader historical transport coverage" | **Re-add under a free ID** | Main's FEAT-86 is now stored-text work; the next free ID on `2cb7b044` is FEAT-88. Re-check at PR time. |

**Optional:**

- `summary=true` for a counts-only overview. It reuses an existing parameter and costs about three
  lines.
- Mapping class hunks to method names. This is an offline step with the existing method parser,
  done later.

## The four mechanisms you asked about

- **continuation: no real value.**
  - The main review case, a released request, cannot drift.
  - For open requests, a drift between pages is rare and visible through `totalObjects`.
  - It costs an input parameter in a catalog with about 10 tokens of headroom, plus identity
    plumbing that protects nothing.
- **resultFormat: drop.** One compact shape is all an LLM needs.
- **Source hashes: drop.** Without stored sessions or reports nobody compares them, and they cost
  64 hex characters per side per part.
- **Aggregate completeness labels: simplify.**
  - Keep the honest part: say what was not compared and whether the page stopped early.
  - Express it with the existing `baselineStatus` vocabulary, as above.
  - Do not add a new reviewed/uncertain/unsupported taxonomy.

## BTP: hosting versus backend

**ARC-1 hosted on BTP Cloud Foundry, with an on-prem backend through Cloud Connector, works with
the existing paths.**

- **Identity.** The per-user principal-propagation client means revisions and sources are read
  under the caller's own SAP authorizations.
- **Policy.** `SAPTransport.diff` requires read scope and the transport feature gate
  (`policy.ts:178`); deny rules apply.
- **Audit.** Dispatch's existing `tool_call` events cover each call.
- **No local files.** The MCP result is JSON only.
- **What the fix adds:**
  - pass the MCP cancel signal through;
  - a deadline of about 30 s that fits client timeouts;
  - output caps.
- **Measure one side effect.** On the Connectivity-proxy path, a budgeted request is sent with
  `Accept-Encoding: identity` and gets a fresh proxy client (`http.ts:1421-1437`). That is
  acceptable, but measure it.
- **Multi-target endpoints stay excluded.** `diff` is left out of multi-target endpoints by design
  (`tools.md:1551-1553`; `multi-target-tools.ts:40` allows only list/get/check/history). Enabling it
  needs the ADR-0006 normative plan, not this PR.

**SAP BTP ABAP as the backend is unqualified.**

- ARC-1 itself does not offer `VERSIONS` or `VERSION_SOURCE` on BTP (`tool-registry.ts:111-112`).
- Release there is a gCTS push (`btp-abap-environment.md:204`).
- There is no live revision-feed evidence on BTP ABAP.
- Until a read-only probe settles it, document `diff` as not verified on BTP ABAP.

## Main correctness risks, ranked

1. **Misattributed diffs** from the fallback on released requests: another change is presented as
   this request's.
2. **False "unchanged"** from suppression; **silent drops** of 404 parts that CTS selected.
3. **Creation claims** from a missing or incomplete history.
4. **Wrong pairs** from undated or out-of-order revisions.
5. **Invisible text-pool and non-source changes.**
6. **Unbounded work and output on a shared server:**
   - no deadline;
   - no cancellation;
   - no byte cap;
   - a jsdiff CPU spike;
   - pages too large for MCP clients.
7. **Unverified attribution cases:**
   - passing a task id such as A4HK906372 (versions carry the request id on 758);
   - transports of copies;
   - 750 history, which was active-only;
   - 816, which only had an empty request.

## Smallest concrete plan

1. **`src/adt/transport-diff.ts`** — keep it a pure-function core:
   - chronology ambiguity;
   - REPT and whole-object `notCompared`;
   - keep 404 rows only for CTS-selected parts;
   - the "not attributed" row instead of suppression;
   - a status-derived strict or active selection;
   - the jsdiff work limit;
   - the 16 KiB part cap.
2. **`src/adt/xml-parser.ts`** — strict feed parsing and `next` meaning partial, in place.
3. **Client methods** — `getTransport`, `getRevisions`, `getRevisionSource` and
   `resolveFunctionGroup` each take an optional `AdtRequestOptions`. #1008 already has these
   signatures.
4. **`src/handlers/transport.ts` (`diff`):**
   - build one live-relations-style options object;
   - process objects sequentially and parts in parallel within an object, bounded by the shared
     semaphore;
   - stop early with `nextOffset` at the first unfinished object;
   - apply a ~64 KiB output cap;
   - return a small summary.
5. **`dispatch.ts`** — the limit hint and minimal-error text.
6. **`tools.ts` / `tools.md`** — byte-neutral `diff` wording: no creation claim, `notCompared`,
   `nextOffset`, "not verified on BTP ABAP", "open-request pages are not a snapshot".
7. **Roadmap** — one deferred idea (FEAT-88) for historical non-source coverage, with the research
   queue's stop conditions.

**Tests.** Port #1008's regressions that encode these fixes:

- REPT-only and whole-object scope;
- undated and out-of-order history;
- TD-01 and TD-02;
- invalid feeds and the `next` link;
- released requests never substituting another revision;
- a page stopping mid-object and resuming;
- cancellation stopping further reads;
- the output cap and the diff work limit;
- minimal-error messages and the dispatch hint.

**Gate.** The snapshot diff is limited to the `diff` description. Run the usual gates plus
`check:sizes`.

## Object families and the evidence needed to expand

Main can diff PROG, INCL, CLAS (five includes), INTF, FUNC, DDLS, DCLS, BDEF and SRVD.

**Live evidence on 758:**

- A4HK906371 (PROG plus CLAS main and CCIMP): three attributed changes.
- A4HK906369: a DDLS diff.

**Pilot mix across 45 objects:**

| Group | Objects |
|---|---|
| Source-diffable | 17 |
| DDIC (DOMA 7, DTEL 7, TABL 4, TTYP 1) | 19 |
| DEVC | 4 |
| FUGR includes | 2 |
| MSAG, SUSO, TRAN | 1 each |

In addition, 13 whole-object entries carried non-source parts.

| Expansion | Native evidence required first |
|---|---|
| DDIC (largest gap) | Two differing historical payloads per type, stable field meaning and deletion semantics. Read-only route: standard SAP DDIC objects that already have multiple versions from support packages or notes, read through VERSIONS. No mutation needed. |
| Text pools | Two historical text-only versions, covering language and symbols/selections/headings. None was observed, so keep `notCompared` until then. |
| FUGR includes | Two numbered include histories plus mapping each `L<group>` include to its group. The sample's history was active-only. |
| Method attribution | Not a correctness need: consecutive versions are scoped to one request. Mapping hunks to methods is an optional offline enhancement. |
| Transports of copies | A released ToC whose revision feed shows whether any version carries the ToC id. Until then, a strict released review reports it as unattributed. |
| BTP ABAP; 750 and 816 | BTP: one read-only probe of a VERSIONS feed and of `SAPTransport get`. 750: a historical pair on 750. 816: a non-empty released pair on 816. |

## Live before/after checks

Run read-only on A4H/001 (758), main `2cb7b044` against the candidate. For each request, record
output bytes, SAP sends, elapsed time and the `baselineStatus` distribution. Explain every part
whose label changes.

| Request | What it proves |
|---|---|
| A4HK906371 (released; CLAS + PROG) | Positive control. Three changed parts stay attributed (main +1, helper `*2→*3`, report literal), with no regression in size or sends. |
| A4HK906372 (its task) | Task-id behavior: correct attribution, or an explicit scope. |
| A4HK906369 (released; CLAS, DDLS, DOMA, INTF, PROG) | DDLS still diffs; DOMA is inventory; whole-object `notCompared` appears; no creation claims. |
| A4HK906379 (open; the 344 KB pilot response) | Output stays under the cap; counts survive truncation; the call finishes within the deadline. |
| A4HK906357 (open; 17 objects, DDIC + FUGR) and A4HK905229 (open; mixed) | Compact inventory output in one page; open requests select the active state. |
| A4HK906578 (released, empty) | The "no reviewable objects" note, with no verdict. |

**Optional checks:**

- **Cancellation.** Cancel an HTTP-mode call partway through A4HK906357; no SAP reads should
  follow.
- **BTP CF.** With explicit approval, run the candidate on the BTP CF instance through Cloud
  Connector against A4HK906371: an identical result, an audit event, and time within client
  limits.
- **BTP ABAP.** A read-only BTP ABAP probe of the VERSIONS feed.

## Limitations

- This is a design review. I ran no tests on #1008 and made no SAP calls.
- Pilot and live facts come from the committed records at `62eb17b4` and `19c72872`.
- The MCP client output limits are general guidance, not measured here.
