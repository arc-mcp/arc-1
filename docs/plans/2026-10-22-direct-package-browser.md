# Bounded direct package browsing (#1065)

## Problem and decision

Legacy quick search ignores `packageName`; #999 correctly refuses that route.
Add an explicit `SAPRead(type="DEVC", name="…", packageScope="direct")` mode.
Omission retains indexed search and its existing response. Direct mode uses the
native package tree, includes direct subpackages as entries, and never visits them.
It does not alter `getSubpackages` or any write authorization evidence.

## Research completed before implementation

The [initial study](../research/2026-10-22-legacy-package-browser.md) established the
root/type-ID protocol and the ignored result cap. Further read-only controls on
22 October used main `d3c0191c`, direct Basic authentication, SAP_BASIS 750 SP02
and 758 SP02. No 740 SP04 system is available.

- Multiple `TV_NODEKEY` elements work in one expansion: 750 `SABP_UNIT_CORE`
  returned 105 objects across 14 types in 48,434 cumulative bytes / 791 ms;
  758 `SABP_UNIT_CORE_RUNTIME` returned 152 across 15 in 115,091 bytes / 1,704 ms.
- The root already contains direct subpackages. Excluding its DEVC/K folder from
  expansion avoids redundant package reads and any descendant traversal.
- 758 `/AIF/MAIN` returned 52 subpackages plus two interfaces in two requests.
- `$TMP` controls: 750 returned 162 objects / 69,631 bytes / 736 ms; 758 returned
  398 expansion objects / 264,749 bytes / 1,873 ms for the first 16 of 19 non-package
  folders. This is an observed load sample, not a bound on SAP work or the largest
  possible package. Client cancellation cannot undo work SAP has already begun.
- 750 `/IWBEP/SB_WB_EXTENSION` returned five namespace objects. 758 `SABAPDEMOS`
  advertised 46 types; 16 non-package folders returned 777 objects / 570,018
  cumulative bytes / 1,982 ms. Its `AMSD/TYP` folder returned `AMSD/ASD` objects: a
  folder selector must preserve returned types rather than post-filtering them.
- A missing package returned an empty body on both releases. Metadata GET is also
  unavailable for existing packages on 750. An empty tree cannot establish absence
  or emptiness: return an explicit ambiguous-result error, without another lookup.
- Omit descriptions in direct mode: 750 has none, while newer nodestructure text
  has a documented name/text alignment defect. Preserve reliable indexed descriptions.
- Native 750 handler source confirms the multi-ID array, no result limit, and
  omitted expansion texts. The public client implementation also uses a multi-ID
  envelope: <https://github.com/marcellourbani/abap-adt-api/blob/master/src/api/nodeContents.ts>.

## Small implementation

1. New `src/adt/package-browser.ts`: package-scoped root and one expansion using
   only validated IDs returned by this root. Validate a nonempty exact package
   name (including namespaces and `$TMP`) before any HTTP request. No broad search,
   recursion, per-object description calls, cross-call node cache, RFC or helpers.
2. Reuse streaming `DataResponseBudget` (2 MiB cumulative), absolute deadline
   (10 s), cancellation context, and `RequestAttemptBudget` (8 actual sends,
   including CSRF/retries). Disable transient replay. At most 16 expansion IDs.
   Exceeded bytes/time/attempts and auth/transport/parser errors propagate as errors;
   never return a success prefix after a failed request.
3. Optional existing `objectType` selects one exact advertised native folder in direct mode
   (for example `CLAS/OC`), so callers can narrow large packages or skipped folders.
   Preserve slash subtypes during SAPRead normalization only for this mode. Native
   returned types may differ from the selected folder; never discard those rows.
   An unadvertised folder is an explicit error, not an empty-package claim.
   Otherwise expand the first 16 distinct non-DEVC/K IDs and report skipped types.
   Validate XML shape and scalar identity fields, preserve native name/type/URI,
   deduplicate entries, and apply the existing 1–1000 result cap locally.
4. Return the existing text shape (objects array, then listing metadata), or
   structured `{objects, listing}`. Direct metadata states `scope=direct`,
   `coverage=adt-nodestructure`, `completeness=unknown`, `total=null`, effective
   limit/returned/limitReached, `possiblyTruncated`, and `unexpandedTypes`.
   Never claim an exhaustive repository inventory or point-in-time snapshot.
5. Thin guarded `AdtClient` wrapper, existing DEVC handler branch, synchronized
   on-prem/BTP runtime + public schemas. `packageScope` accepts only `direct`
   and only with DEVC; exact-name validation exists at schema and sink. No CLI
   special path: generic tool-call JSON already carries the input.

## Validation and review sequence

- Review this plan in Claude Code Opus 5.5 Max GUI before implementation.
- Capture sanitized 750/758 fixture projections; deterministic tests for root +
  multiple folders, namespaces, direct-only scope, absent/misaligned descriptions,
  duplicate nodes, missing/empty/malformed XML, local result/folder limits, type
  narrowing, denied reads/scopes, invalid inputs and no fallback.
- Exercise real HTTP streaming byte limit, caller cancellation/deadline and shared
  attempt budget. Keep existing indexed-search, package hierarchy/safety and
  multi-target contracts green; review tool snapshot diffs.
- Full unit/static/build/policy/size/docs gates, then native final-code 750/758
  handler checks against the same controls, including truncation and narrow types.
- Claude implementation review, corrections with regression tests, final review
  of the final commit and evidence. Create one linked PR; do not merge.

## Plan review: approved with these incorporated requirements

Claude Opus 5.5 Max reviewed the plan and native controls before implementation
(`/tmp/arc1-1065-plan-review.md`, 22 October). Its six required clarifications:

- Preserve the trimmed, uppercased exact folder selector only for direct DEVC;
  reject DEVC `objectType` without direct mode. No bare-type expansion. Narrowed
  calls omit root subpackages unless `objectType=DEVC/K` explicitly selects them.
- Validate unique six-digit root IDs; never use expansion-response IDs. A DEVC/K
  expansion row is a protocol error. Validate native scalar fields and ADT paths;
  deduplicate on type/name/URI without enforcing folder/returned-type equality.
- Folder selection follows root document order, not numeric ID order. Results
  retain root-subpackage then expansion order. `unexpandedTypes` includes folders
  excluded by narrowing; `possiblyTruncated` is limit reached or skipped folders.
- Use the standalone byte budget (not the data-result semaphore). Give byte-limit
  errors a package-specific hint: narrow `objectType`; lowering `maxResults` does
  not reduce the native response. All requests share time and send allowances.
- Both empty bodies and well-formed roots without any folders or nodes remain
  ambiguous errors. Suggest a manual exact-name check; never run that fallback.
- Preserve the selected target's identity and test direct reads through the
  multi-target route. BTP is explicitly unverified; extension APIs stay unchanged.

The existing #999 refusal will point to direct mode. Native probes already used
`withShortDescriptions=false` (758 still sends descriptions); discard them. `$TMP`
inherits SAP's caller-specific workbench view; it is not an all-user inventory.
Do not infer a user filter beyond the observed backend contract.

## Scope and roadmap

Implement the bounded direct mode for demonstrated native contracts. Unsupported
740 and other releases fail explicitly; do not claim native 740 validation.
Remove COMPAT-17's implemented feature gap while retaining any concrete unverified
740 compatibility work with an evidence-based resume trigger. Keep #1063/#996's
original reporter-confirmation gate separate. Document client budgets and backend
load limits briefly in user docs; keep protocol detail here and in research.
