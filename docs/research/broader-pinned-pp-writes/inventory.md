# PR 2 mutation inventory

Baseline: merged PR #1138, `ac8385fa47b6c40c2c77c6507e03c376bfc3b613`.
This is an implementation review inventory, **not an authorization table or a parity claim**.
[inventory.json](inventory.json) freezes mutation policy rows, write types, relevant slash aliases
and top-level runtime input fields. Full action lists also detect additions classified as reads/tests.
[nested-input-contracts.json](nested-input-contracts.json) snapshots every object-valued field (including nested arrays, batch/activation objects, quickfix
objects, KTD short texts and FLP tiles) in both on-premise and BTP schema variants; custom refinements and handler branch combinations still need separate
behavioral review. The drift tests require deliberate updates as PR 2 proceeds.
Current admission in the integrated PR branch is defined by
`src/server/pinned-mutation-capabilities.ts`, `pinned-management-capabilities.ts` and
`pinned-repository-input.ts`; the historical JSON snapshots above are not that matrix.
The [write guide](../../../docs_page/multi-target-writes.md),
[accepted plan](../../plans/2026-10-26-broader-pinned-pp-writes.md) and
[ADR-0011](../../adr/0011-broader-pinned-pp-mutations.md) define the operator and acceptance boundaries.

## Branch constraints

The table below reflects the admitted code at `d9b9b6a0a`, including the
[reviewed public wiring](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-public-generated-integration.md).
**Admitted means routed through the explicit pinned adapter, not qualified on every backend or in
current deployed PP.** Native evidence and earlier PP runs remain bound to their named source,
identity and operations. Final deployed PP, retained RAP/CTS work and release review remain in
[FEAT-93](../../../docs_page/roadmap.md#feat-93). Internal functions named `private` can be used by
public routing; their names alone do not establish availability.

The type registry is not a Cartesian product. Actions, fields, platform/discovery availability,
parent ownership, recording and nested batch constraints all apply before native submission.

| Family/action | Admitted routing and constraints | Qualification boundary |
| --- | --- | --- |
| CLAS/INTF create/update/delete | Shared source/create/delete profiles; explicit create package, fresh existing-source hash, exact owner/package/recording and typed delete readback | Historical ADR-0010 and later PP evidence is revision-specific; it does not qualify the final integrated deployment |
| CLAS local includes and class surgery | Four update selectors, typed absence for initialization, native structure checks and same owning class lock; explicit method/definition/signature/add/delete/visibility actions | [Local PP include evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-broader-pinned-pp-writes-includes.md) and [shared method profile](../2026-11-01-shared-pinned-method-edit.md); unsupported inherited/parser-unknown shapes refuse |
| Standalone PROG/INCL CRUD and surgery | Exact standalone owner/package and source hash; `edit_unit`/`add_unit`; PROG deletion additionally verifies its active text pool | Missing native creator is unknown, not the responsible user; [type-specific creator proof](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-current-pp-native-creator-evidence.md) keeps CLAS immutable creator mandatory |
| FUNC/FUGR/group-owned INCL | FUNC resolves its exact group; structural INCL owns its lock and inherits group package; FUGR supports create/delete, not whole-source update; group INCL supports unit edits | FUNC, FUGR generation and structural INCL activation use distinct profiles; [exact include activation](../2026-11-03-pinned-structural-include-activation.md) does not activate unrelated users |
| Text elements | CLAS symbols and PROG/FUGR supported parts; whole selected part replacement, own pool lock and explicit active readback | Whole-pool activation can activate other pending parts; submitted errors remain uncertain; final PP text/recording checks remain required |
| DDLS/DCLS/DDLX/BDEF/SRVD | Explicit source CRUD and activation profiles; exact same-owner state links and source hashes | Native declarative and RAP evidence are distinct; an abstract BDEF lifecycle does not prove managed RAP generation/publication |
| TABL/DT, TABL/DS, TABL/DTT, TABL/DTI | Subtype-aware table/structure CRUD; DTT update only and parent activation first; index identity/package is tied to its table | Native definition mode and settings-to-parent state coupling are checked; DTT creation/deletion belongs to the parent, not a standalone public operation |
| DOMA/DTEL/MSAG/TTYP/ENQU | Metadata create/update/delete and activation; per-type post-create saves and complete partial-merge preservation | [DDIC profiles](../2026-11-02-pinned-ddic-server-driven.md); MSAG explicit removal uses the [same-PUT native instructions](../2026-11-04-msag-explicit-native-removal.md), not omission alone |
| ENHO | BADI_IMPL document CRUD/activation with exact dependency identity, opaque-field preservation and native derived-field comparison | [Document profiles](../2026-11-02-pinned-enhancement-documents.md) and [state-link contract](../2026-11-04-enho-relative-state-link.md); other enhancement technologies remain unsupported |
| SKTD/KTD | Normalized SKTD document CRUD/activation, ordinary/editable reads, draft merge, reference fields and short texts | [RAP/document coupling](../2026-11-04-rap-document-parent-coupling.md) remains separate from ordinary owner identity; final retained RAP tail is tracked in FEAT-93 |
| Server-driven types | Explicit SDO registry with per-type discovery/media, AFF/DDL handling and dedicated UIAD/APLO behavior | Registration does not prove every backend variant; immediate-active APLO/UIAD have no separate activation row |
| Batch creation and activation | Up to 10 explicit items; static input/package/recording preflight, shared per-item adapters, inline/deferred activation and honest partial results | No rollback or activation after failed deferred creation. SDO/DTT create batches, FUGR, group INCL, ENHO/SKTD and unsupported nested combinations remain refused; no implicit publication |
| RAP helpers | `scaffold_rap_handlers` and `generate_behavior_implementation` for one behavior-pool CLAS; exact MAIN/CCDEF/CCIMP and fresh-under-lock planning | Admitted orchestration does not imply all RAP shapes; generation, document state, publication and generated cleanup have separate native proofs |
| Activation/publication | Single-owner and bounded explicit batch activation; V4 publish/unpublish require explicit version and metadata hash | Public publication uses the native-governed recording profile with both explicit unrestricted request policies. No fabricated non-recording/CTS receipt; public generated-binding deletion remains refused |
| Package/API state | Exact package create/delete/move and native APIS release resource; SRVB CRUD preserves full metadata | Parentless local roots are not `$TMP` descendants. Package DELETE is local/non-cascading only; recorded package deletion stays closed. MOVE recording/cleanup may have partial effects |
| CTS management | `create`, `release`, `release_recursive`, `delete`, `reassign`, `remove_object`, plus `layers`/`targets` companions; registered native parent/task scope and complete member checks | Management also needs its global ceiling and raw transports scope; recording remains separate. Create needs both unrestricted request policies; remaining retained native CTS and final PP gates are explicit |
| Trace/quickfix | Profiler start/cancel, ST05 state, and exact quickfix proposal computation through scoped adapters | Explicit SAP subject; ST05 spans instances and is not client-isolated/own-user. Quickfix returns edits without saving source; unknown/partial trace outcomes preserve known IDs |
| Formatter | Preserving partial settings XML and ordinary read/format companions | [Earlier PP evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md) is revision-specific; other styles/releases are not inferred |
| Classic FLP | Five PAGE_BUILDER_CUST mutations and bounded listing companions; exact parent/page ownership and final-send recording proof | Both request policies must explicitly allow `*` for native-governed recording. A `/UI2/FND/604` lookup is not absence; accepted deletion can remain unconfirmed |
| Git/custom extensions | Excluded from the multi-target mutation surface; plugins remain disabled in this topology | Hidden calls remain denied for excluded/unsupported combinations, not for all mutations |

## Identity fields

| Location | Current dependency | Required pinned treatment |
| --- | --- | --- |
| `write/create.ts`, including batch | `mutationResponsible` preserves the legacy configured/effective-user fallback | Omit optional responsible when mapped user is unverified; verify native author independently |
| `write/metadata-update.ts` | Shared identity helper during metadata merge | Preserve native stored responsibility; never insert JWT username as mapped identity |
| `manage.ts create_package` | Explicit responsible or configured username; cloud internal user fallback | Explicit valid SAP responsible on every pinned platform; no omission/JWT fallback. Preserve topology restrictions |
| `transport.ts list/create` | Default list user and explicit create owner from `client.username` | Native logged-on read default; omit optional create owner; retain explicit authorized reassignment target |
| `diagnose.ts trace_start/requests` | Single-target default trace username from client; shared Basic retains it for `trace_requests` | Multi-target PP `trace_requests` and the pinned trace adapters require an explicit exact SAP username, never the IdP name |

The native source author, person-responsible and requested trace/reassignment subject are different
concepts. Tests must not assert that an explicit responsibility field establishes PP acting identity.

## Remaining gates

Keep admitted action/type/input combinations, aliases and nested fields aligned across the runtime
matrix, schemas and guarded adapters. The snapshots catch action, type, alias, top-level and nested
field drift in both platform variants; they do not replace branch-level tests, backend qualification,
native identity evidence or final review. Unsupported combinations stay refused. Full PR 2 acceptance
remains in progress; follow FEAT-93 and the write guide rather than treating a historical private
candidate report as the current routing table.
