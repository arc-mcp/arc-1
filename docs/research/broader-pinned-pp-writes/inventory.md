# PR 2 mutation inventory

Baseline: merged PR #1138, `ac8385fa47b6c40c2c77c6507e03c376bfc3b613`.
This is an implementation review inventory, **not an authorization table or a parity claim**.
[inventory.json](inventory.json) freezes mutation policy rows, write types, relevant slash aliases
and top-level runtime input fields. Its drift test requires deliberate updates as PR 2 proceeds.
The current runtime still permits only ADR-0010's scoped subset. The full
[plan](../../plans/2026-10-26-broader-pinned-pp-writes.md) and proposed
[ADR-0011](../../adr/0011-broader-pinned-pp-mutations.md) define acceptance.

## Branch constraints

The type registry is not a Cartesian product. The JSON's CRUD lists describe candidate single-object
paths for review; native discovery and the actual handler determine support. These constraints must
be reflected in the later runtime matrix, including nested batch validation:

| Family/action | Branch evidence and constraints | Current pinned qualification |
| --- | --- | --- |
| CLAS/INTF create/update | `write/pinned.ts`; main source only, explicit create package, source hash on update | ADR-0010 only |
| Class surgery | `write/class-surgery.ts`, `class-edit.ts`; CLAS only; definitions/implementations/macros/testclasses routing and local-method inference differ by action | Existing main `edit_method` only; other combinations pending |
| Procedural surgery | `write/unit-surgery.ts`; PROG or INCL; FUGR structural include is INCL plus `group`, not `type=FUGR` | Pending |
| FUNC/FUGR/INCL CRUD | `write.ts`, `write/create.ts`, `write/update-delete.ts`; FUNC resolves group, structural INCL locks the include and inherits group package; class includes are update paths | Pending |
| Text elements | `write/update-delete.ts`, `adt/text-elements.ts`; CLAS symbols only, PROG/FUGR supported parts; pool lock differs from owner, save may invoke activation | Pending exact-pool adapter and native active-version readback |
| TABL/DTT | `write/table-settings.ts`; update only, parent table package; new settings require parent activation | Pending |
| TABL/DT, TABL/DS | Write normalizer preserves subtype; `STRU/DS` maps to TABL/DS; bare TABL resolves tables/structures | Pending |
| DOMA/DTEL/MSAG/TTYP/ENQU/ENHO/SRVB | Metadata update/create branches; DTEL, TTYP and others have post-create saves; ENHO requires BADI_IMPL technology; publication is separate | Pending |
| SKTD/KTD | Alias handling, reference fields, short texts and native draft merge; no assumption that generic batch creation reproduces single SKTD creation | Pending |
| Server-driven types | Explicit SDO registry, AFF/DDL distinctions, per-type MIME and native discovery; UIAD has a dedicated branch; TABL/DTI inherits parent table package; APLO is immediately active | Pending per-type adapters/evidence |
| Batch creation | `write/create.ts`; rejects SDOs and FUGR structural includes. FUNC needs group. Per-item fields/defaults differ from top level. Audit each supported type rather than importing the full write enum | Pending |
| RAP helpers | `write/rap.ts`; CLAS, potentially creates/edits local implementation includes; may invoke activation | Pending every nested mutation/activation |
| Activation | `activate.ts`, `adt/devtools.ts`; owner/type resolution, SDO discovery, table/index postconditions and expanded references; batch currently explicitly refuses multi-target | ADR-0010 whole CLAS/INTF owner only |
| Package/API state/publication | `manage.ts`, `adt/api-release.ts`, `adt/refactoring.ts`, `adt/devtools.ts`; actual owners, both move packages and native recording behavior need separate treatment | Pending |
| CTS | `transport.ts` at handler and ADT layers; low-level whitelist and recursive-release gates cannot simply inherit runtime `allowedTransports=[]` | Pending verified native request scope |
| Trace/proposals | `diagnose.ts`, `adt/diagnostics.ts`; profiler two-stage create, explicit PP user, ST05 per-instance state; quickfix returns edits without persisting source | Pending |
| Formatter | `lint.ts`, `adt/devtools.ts`; current settings writer replaces the XML document, so pinned partial updates need a preserving adapter | Pending |
| Classic FLP | `manage.ts`, `adt/flp.ts`; five mutations through PAGE_BUILDER_CUST, relationships and membership evidence differ by operation | Pending PP non-ADT path/CSRF/recording/readback qualification |
| Git/custom extensions | Explicit owner exclusion; retain hidden-call denial and plugins-off topology | Excluded |

## Identity fields

| Location | Current dependency | Required pinned treatment |
| --- | --- | --- |
| `write/create.ts`, including batch | `config.username || client.getEffectiveUser()` becomes responsible | Omit optional responsible when mapped user is unverified; verify native author independently |
| `write/metadata-update.ts` | Same responsible fallback during metadata merge | Preserve native stored responsibility; never insert JWT username as mapped identity |
| `manage.ts create_package` | Explicit responsible or configured username; cloud internal user fallback | On-prem explicit valid SAP responsible; no omission/JWT fallback. Preserve topology restrictions |
| `transport.ts list/create` | Default list user and explicit create owner from `client.username` | Native logged-on read default; omit optional create owner; retain explicit authorized reassignment target |
| `diagnose.ts trace_start/requests` | Default trace username from client | Explicit SAP username when native default is not authoritative; do not infer from IdP name |

The native source author, person-responsible and requested trace/reassignment subject are different
concepts. Tests must not assert that an explicit responsibility field establishes PP acting identity.

## Remaining gates

Resolve every action/type/input combination, aliases and nested fields into the runtime admission
matrix as its guarded adapter lands. The snapshot tests only catch top-level drift; they do not
replace branch-level behavioral tests, backend qualification, native identity evidence or review.
Keep pending combinations refused and document them. Full PR 2 remains in progress.
