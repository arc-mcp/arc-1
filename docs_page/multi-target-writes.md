# Write to a pinned SAP target

Multi-target writes use the existing pinned URL and the existing `SAP_ALLOW_WRITES` switch.
They require Principal Propagation (PP), target-filtered authorization, destination opt-in,
and a separate exact write grant. Enabling the global switch alone grants no multi-target writes.

This page describes the explicit capability matrix integrated in PR #1142, not blanket single-target
parity or completed release acceptance. Final native CTS, current-build PP and restoration checks
remain pending. Use the documentation for the artifact actually deployed; historical qualification
records below apply only to their named source and operation.

| Connection | Reads | Built-in mutations |
|---|---|---|
| Pinned PP `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp` | Subject to access grants and SAP authorization | Only when every write gate below agrees |
| Aggregate `/multi/mcp` | Explicit target on each call | Never |
| Copilot `/authorize` compatibility connection | Aggregate reads | Never; register a separate pinned connection for writing |
| Pinned BasicAuthentication | Shared technical identity | Never |
| Independent single-target `/mcp` | Existing single-target rules | Existing single-target rules; this guide does not change them |

Use the [CF deployment runbook](btp-cloud-foundry-deployment.md),
[multi-target destination setup](multi-target-setup.md), and
[target authorization guide](multi-target-authorization.md) first. Target-filtered mode cannot coexist
with an independent single-target destination in the same application. The example below adds writes
to a configured target-filtered PP deployment; it is not a second deployment recipe.

## Configure one writable and one read-only target

The validated [write overlay and destination example](https://github.com/arc-mcp/arc-1/tree/main/examples/btp/multi-pp)
provide this configuration with fictional targets. In the application's MTA extension `properties:` (or equivalently `cf set-env`), set:

```yaml
SAP_ALLOW_WRITES: "true"
SAP_ALLOWED_PACKAGES: "$TMP,ZTEAM/**"
SAP_ALLOWED_TRANSPORTS: "DEVK9*"
ARC1_MULTI_TARGET_ENDPOINTS: "true"
ARC1_MULTI_TARGET_AUTHORIZATION: "xsuaa-attribute"
ARC1_CACHE: "none"
ARC1_TOOL_MODE: "standard"
ARC1_UI: "off"
```

Keep the existing XSUAA/Destination/Connectivity bindings and PP configuration. Do not add a
second write-enable parameter. Plugins and shared cookies remain unavailable in multi-target mode.
Repository recording does not require `SAP_ALLOW_TRANSPORT_WRITES`. Explicit CTS management additionally
requires `SAP_ALLOW_TRANSPORT_WRITES: "true"` and the `transports` scope. Git remains excluded even
when `SAP_ALLOW_GIT_WRITES` is enabled.

On the enabled **PP destination** for development target `DEV/001`, add:

```properties
arc1.allow_writes=true
arc1.allowed_packages=$TMP,ZTEAM_COMPONENT/**
arc1.allowed_transports=DEVK900123
```

Keep the destination's real `sap-sysid`, `sap-client`, URL, Cloud Connector location and optional
`arc1.target_alias` from the existing setup. On read-only target `QAS/001`, omit all three write
properties. A pinned URL names the public target ID, including its alias if configured.

**Both package lists apply to repository writes.** A package must match the global list and the destination list.
Here, `ZTEAM_OTHER` is not writable merely because it matches the global subtree. Conversely, a
destination cannot permit a package excluded globally. Existing-object checks use the real SAP
package, not a package supplied by the caller. Package subtree lookup failures deny the write.
Pinned checks fetch fresh subtree evidence during preflight and again under the lock, within the
write call's cancellation and deadline. A slow or unavailable hierarchy can therefore refuse a write
that an earlier check allowed; an earlier positive result is not reused to authorize the save.

Destination package lists support exact names, prefix patterns (`ZTEAM*`), DEVCLASS subtrees
(`ZTEAM/**`) and explicit `*`. Transport lists support exact request IDs, prefixes and explicit `*`.
Lists are bounded to 128 entries, 128 characters per entry and 8192 characters total; use ASCII,
commas and optional surrounding spaces. Empty entries and malformed values quarantine the destination.
A package list is required whenever the destination requests writes, even while the global switch is
off. Missing destination transport policy allows only positively verified local objects.

**Transport policy authorizes requests and their SAP-managed tasks.** In this example only
`DEVK900123` is allowed. If a caller supplies one of its tasks, ARC-1 verifies membership and uses
the parent request for the SAP save. A task-only allowlist entry does not grant its parent. The
request used for repository recording must be a modifiable Workbench request; unknown/mismatched
recording evidence denies the write. Explicit CTS management has its own native type/state checks,
described below; an allowed request is not permission to ignore them.

## Assign the exact write grant

Deploy the updated `xs-security.json` to the application's XSUAA service. It adds the
`MCPTargetDeveloper` template; it does not grant users access automatically. In BTP Cockpit,
create a concrete role from that template with:

| Attribute | Example values | Meaning |
|---|---|---|
| `arc1_targets` | `DEV/001`, `QAS/001` | Targets this user may access |
| `arc1_write_targets` | `DEV/001` | Exact targets this user may write through pinned PP connections |

First enable and verify `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute` on the application.
`MCPTargetDeveloper` carries application-wide read/write scopes; its attributes only restrict access
in that enforced multi-target mode. Do not assign it to standard or single-target apps expecting
target isolation, or reuse an XSUAA service/role collection across apps without checking each app.

Add that concrete role to a collection and assign the collection to the intended user or identity
group. The template supplies `read` and `write` scopes. Read `*` is supported by the existing read
contract; write `*`, globs and comma-separated values inside an attribute value are rejected.
Admin does not bypass the exact write grant. A token containing a write-target attribute but only
read scope cannot write either.

The equivalent BTP CLI role creation was verified during qualification. Target the intended
subaccount first, obtain the actual application ID from `btp list security/app`, and save:

```json title="target-developer-attributes.json"
[
  { "attributeName": "arc1_targets", "attributeValueOrigin": "static", "attributeValues": ["DEV/001", "QAS/001"] },
  { "attributeName": "arc1_write_targets", "attributeValueOrigin": "static", "attributeValues": ["DEV/001"] }
]
```

```sh
btp create security/role "Develop DEV, read QAS" --of-app "<application-id>" \
  --of-role-template MCPTargetDeveloper --attributes target-developer-attributes.json
btp create security/role-collection "ARC1 DEV developers"
btp add security/role "Develop DEV, read QAS" --to-role-collection "ARC1 DEV developers" \
  --of-app "<application-id>" --of-role-template MCPTargetDeveloper
btp assign security/role-collection "ARC1 DEV developers" --to-user "<user>" \
  --of-idp "<configured-identity-provider-origin>" --create-user-if-missing false
```

For CTS managers, the optional `MCPTargetTransportDeveloper` template supplies `read`, `write` and
`transports` with the same two target attributes. Enable the global transport switch, assign that
role deliberately, and request the `transports` OAuth scope on the pinned connection. No destination
transport-enable boolean or extra upgrade acknowledgment is needed.

**Functional scopes merge across roles at application level.** A transport role for `DEV/001` plus
a write role for `QAS/001` can allow CTS management on both targets when each destination's policy
permits it. There is no target-specific transport grant. Use destination request restrictions or
separate applications when transport managers must be isolated from other writers. Existing roles
are not automatically assigned or expanded.

Use the actual trust origin from your subaccount, not a guessed email-to-SAP mapping. SAP PP maps
the signed-in identity to the SAP user; ARC-1 does not use the JWT email as object responsible user.

Restart every ARC-1 application instance after changing destination or server policy. Then register
`https://<arc1-route>/DEV/001/mcp` as a separate MCP connection, request read/write scope, sign in
fresh and refresh the tool catalog. Keep `/multi/mcp` for cross-target reads. A client that exposes
only the aggregate compatibility connection cannot write through that connection.

## Explicit action, type and input matrix

The catalog is a projection of the current capability rows, scopes, platform and deny policy.
It is not a Cartesian product of every displayed action, type and field. The dispatcher validates
meaningful raw fields, including nested inputs, before normalization can strip them; unknown or
inapplicable fields refuse. Only established aliases normalize to the rows below (`KTD` uses `SKTD`).
A type shown in a schema still needs its native endpoint and supported metadata/state on this target.

For repository rows, `action`, `type`, `name` select one owner and optional `transport` selects its
recording request/task. Creation uses an explicit `package` unless native parent inheritance is
specified. Source updates require the matching editable-source hash. ENHO/SKTD/SRVB updates require a
metadata hash; DDIC metadata and technical-settings patches accept an optional metadata hash and otherwise
merge fresh native state under lock. Deletion accepts neither source nor a caller hash and removes
the current complete owner.

| Repository type | Admitted actions | Input and native boundary |
|---|---|---|
| `CLAS`, `INTF` | `create`, `update`, `delete` | Create: `source`, `package`, optional `description`. Update: `source`, `expectedSourceHash`. CLAS update also permits `include=definitions\|implementations\|macros\|testclasses`; INTF does not. |
| Standalone `PROG`, `INCL` | `create`, `update`, `delete` | On-prem source contract; create source/package/description, update source/hash. Generated/container names are not standalone owners. PROG deletion additionally requires a verified active text pool. |
| `FUGR` | `create`, `delete` | On-prem create metadata with package/description, no main-source replacement. SAP owns the generated main program. Whole-group deletion requires its verified active text pool; SAP determines effects on its owned/generated contents. |
| `FUNC`, structural `INCL` | `create`, `update`, `delete` | On-prem native `group` ownership and parent package; child lock. FUNC may resolve its group on existing-owner calls. Create permits source/description and FUNC `parameters`, `processingType`, applicable `updateTaskKind`; the latter two are create-only and updateTaskKind requires update processing. FUNC update supports source and/or structured parameters with the complete source hash. Structural INCL uses source/hash and its exact group. |
| `DDLS`, `DCLS`, `DDLX`, `BDEF`, `SRVD` | `create`, `update`, `delete` | Complete native source; create package/description, update `expectedSourceHash`. Native type, owner, state links and source identity must agree. |
| `TABL`, `TABL/DT`, `TABL/DS` | `create`, `update`, `delete` | ABAP Dictionary DDL source; create package/description, update source/hash. Bare TABL creates a transparent table; existing subtype is resolved and checked against native evidence. |
| `DOMA`, `DTEL`, `TTYP`, `MSAG`, `ENQU` | `create`, `update`, `delete` | Structured metadata inputs below; create package/description, update optionally supplies `expectedMetadataHash`. The current native document is merged under lock, preserving unselected state. |
| `TABL/DTT` | `update` | Partial technical-settings JSON in `source`, optional `expectedMetadataHash`; owner/package is the parent table. Parent creation/deletion controls existence. |
| `TABL/DTI` | `create`, `update`, `delete` | Exact `TABLE~INDEX` name, native JSON source, parent-table package. Update requires the explicit inactive source hash. It is not an independent package owner. |
| `DESD`, `DTSC`, `CSNM`, `EVTB`, `EVTO`, `COTA`, `DSFD`, `DTDC`, `UIAD`, `DRTY`, `APLO`, `SAJC`, `SAJT` | `create`, `update`, `delete` | Discovery-gated server-driven body/MIME contract; source is the registered JSON or text representation, not assumed AFF for every type. Update uses `expectedSourceHash`; create may require native source metadata. APLO/UIAD save active, so there is no separate review-before-activation step; APLO names are at most 20 characters. UIAD native read-only/validation refusals remain. |
| `ENHO` | `create`, `update`, `delete` | Existing `BADI_IMPL` technology only. Source is the structured BAdI implementation definition; create requires enhancement-spot evidence. Update source/description with `expectedMetadataHash`; other enhancement technologies refuse. |
| `SKTD` / `KTD` | `create`, `update`, `delete` | Markdown `source` and/or `shortTexts` node/text pairs. Create package plus exact same-name `refObjectType`/`refObjectName`, optional `refObjectDescription`; supported top-level parents are DDLS/BDEF/SRVD/SRVB/DEVC/SMBC. Update uses `expectedMetadataHash`, optionally `dryRun`; native node routing, reference identity and text obligations remain enforced. |
| `SRVB` | `create`, `update`, `delete` | Create package, description, serviceDefinition, odataVersion (`V2`/`V4`), category (`0`/`1`) and nonzero four-digit version. Update uses `expectedMetadataHash` and the selected binding fields. Ordinary CRUD requires explicitly unpublished, non-generated binding state. |

The structured metadata fields are closed lists; optional `description` is separate:

| Type | Additional fields |
|---|---|
| DOMA | `dataType`, `length`, `decimals`, `outputLength`, `conversionExit`, `signExists`, `lowercase`, `valueTable`, `fixedValues` |
| DTEL | `typeKind`, `typeName`, `domainName`, `dataType`, `length`, `decimals`, `shortLabel`, `shortLength`, `mediumLabel`, `mediumLength`, `longLabel`, `longLength`, `headingLabel`, `headingLength`, `searchHelp`, `searchHelpParameter`, `setGetParameter`, `defaultComponentName`, `deactivateInputHistory`, `changeDocument` |
| TTYP | `rowType`, `rowTypeKind`, `rowTypeLength`, `rowTypeDecimals`; create requires rowType |
| MSAG | `messages` with exact message number/text. A supplied list is complete replacement; validated omissions produce native same-PUT delete instructions. No raw delete markers or recording/lock overrides are accepted. |
| ENQU | `source` containing the supported lock-object JSON definition; table/parameter changes retain the native explicit-parameter restrictions |

| Other SAPWrite action | Types and inputs |
|---|---|
| `edit_method` | CLAS: method, source, expectedSourceHash, optional supported include. `lhc_class~method`/`lcl_class~method` infer implementations and `ltc_class~method` infers testclasses; an explicit include wins. |
| `edit_class_definition` | CLAS: source/hash; main definition surgery, or complete selected class-include replacement. |
| `edit_method_signature` | CLAS main: method, source METHODS clause, hash; preserves body and refuses ABSTRACT transitions. |
| `add_method` | CLAS main: method clause, hash, optional visibility/abstract; explicit abstractness must agree with the clause. |
| `delete_method`, `change_method_visibility` | CLAS main: method/hash; visibility change also requires visibility. |
| `edit_unit`, `add_unit` | PROG/INCL: unit, source/hash, optional group only for structural INCL. Complete FORM/MODULE blocks; shared-line neighbors refuse and add appends at physical EOF. |
| `edit_text_symbols` | CLAS symbols; on-prem PROG/FUGR symbols, selections or headings via `textPart`. Explicit complete raw `source`, including `""` to clear; no optimistic hash. Other text parts can activate with the selected pool. |
| `batch_create` | 1–10 `objects`, optional common package/transport/group and `activateAtEnd`. Per-item create fields above; excludes FUGR, ENHO, SKTD, TABL/DTT and server-driven types (including TABL/DTI). Common/per-item group is FUNC-only; group-owned INCL batches refuse. |
| `scaffold_rap_handlers` | CLAS name, bdefName, optional targetAlias/transport/autoApply/lintBeforeWrite. Registered same-owner RAP structure; caller source/hash overrides are refused. |
| `generate_behavior_implementation` | CLAS name, optional bdefName/targetAlias/transport/dryRun/activate. Existing managed/unmanaged parser limits remain; namespaced owners and ambiguous required-handler collisions refuse. |

| SAPActivate action | Scope and inputs |
|---|---|
| `activate` | One type/name from the repository matrix except APLO/UIAD, or `objects` containing 1–10 type/name selectors. Optional group for a single FUNC/structural INCL; batch group only for FUNC. Batch excludes FUGR/ENHO/SKTD and group-owned INCL. `preaudit` may be omitted or true, never false. |
| `publish_srvb`, `unpublish_srvb` | One SRVB name, exact four-digit `version`, `service_type="odatav4"`, `expectedMetadataHash`. Native-governed on-prem 758 profile and both explicit `*` request policies; no public publication batch or V2 publication contract. |

Whole-owner activation can include existing drafts from other sessions, class includes and the
selected native text pool. FUGR generation does not imply child FUNC activation. A structural INCL
uses its own exact native include reference; FUNC and INCL require their own active metadata/source
proof. Expanded references remain authorized individually. A batch authorizes all initial owners
before preaudit, bounds native expansion and reports partial outcomes; it is not a transaction.
A native success status without the required execution/state proof remains unconfirmed.

## Read, save and activate safely

Read the selected resource with `SAPRead(..., format="editable")`. Source responses provide the
hash for `expectedSourceHash`; native metadata responses provide `metadataXml`, `metadataHash`,
identity/package/view/version information for `expectedMetadataHash`. Ordinary editable reads use
normal read permission, including outside write-package lists. They do not grant a write. Use the
matching version and resource: a class main-source hash does not authorize an include change.

Existing source replacement and surgery recheck the selected source under its owning lock.
A missing optional class include can initialize only after native absence is verified under the
class lock. Clearing an existing include requires exactly empty source with its current hash;
whitespace-only source refuses. Main class surgery preserves the implementation section and checks SAP's structure/ranges against
that source; inherited/ambiguous/shared-line structures refuse instead of guessing. Metadata updates
retain namespace identity, opaque fields and native row state or refuse before PUT. MSAG preserves
unselected rows and their links/attributes. Nonempty native MC corrno/lockhandle values (including
whitespace) refuse; explicitly empty inert values may remain. The native selfexplainatory=true plus
documented=true pair also refuses before PUT because it would delete unrequested long text, including
on a description-only edit. This is an operational side-effect boundary, not invalid SAP data.

Source saves generally remain inactive until explicit activation. MSAG can save active; APLO/UIAD
are immediate-active profiles. Trust the returned native state, not an assumption that every save
creates a draft. SKTD reads the developer view so inactive edits accumulate; selecting one text
node must preserve other nodes, references, short texts and native obligations. Derived operation
reference labels do not weaken its full metadata precondition.

Text-part writes replace the selected part under the pool lock, preserve other parts, unlock and
activate that exact pool in the same session. All pending parts of that pool can activate. The
adapter verifies explicit active metadata and active-version content. A never-activated PROG may
need first owner activation; an already-empty active CLAS/FUGR symbols save can be a verified no-op.
The text-part representation has no optimistic hash; review the full replacement. Source/readback
are bounded to 1 MiB. An inactive pool blocks guarded PROG deletion. NW 7.50's observed missing
textelements service means these operations refuse there; it does not prove all procedural writes
are unsupported on every 7.50 system.

Deletion removes the complete current owner, without a caller source hash. Native typed absence is
required for confirmed repository deletion; a generic 404 does not prove absence. An acknowledged
save/delete with failed unlock or session close retains that fact and separately reports cleanup.
Uncertain results are not rollback or retry instructions. Whole-owner deletion can affect its
owned/generated contents. Parent absence does not prove every independent generated resource is absent; ordinary generated SRVB deletion still refuses.

Global lint applies to the paths that use it; intermediate method-signature edits and class-include
fragments retain their documented exceptions. RAP scaffold exposes its existing lintBeforeWrite
field; there is no generic per-call lint bypass for ordinary source writes. SAP-side checks remain
advisory where documented. ABAP Unit reads can execute authored code under the requesting SAP user;
use `SAP_DENY_ACTIONS=SAPDiagnose.unittest` where that execution is inappropriate. `unittest_ci`, Git,
custom plugins, arbitrary ABAP/RFC execution and installed helpers are not added by this expansion.

## Package, API and service management

| SAPManage action | Inputs and limits |
|---|---|
| `create_package` | name, description, superPackage, responsible, softwareComponent, transportLayer, packageType, recordChanges, transport, as applicable to native local/cloud/recorded construction. Creation requires an explicit SAP responsible user on every platform. `$TMP` is neither a creatable package nor valid ancestry. Root local `$...` creation without superPackage is the bounded on-prem 758 native-governed profile; it requires both explicit `*` request policies. |
| `delete_package` | name, optional transport field in the schema; the installed local profile refuses a supplied transport. On-prem 758 LOCAL development package, recording disabled and empty layer; `$TMP` protected. Native DELETE is non-cascading and authoritatively checks actual contents; an empty browser listing alone proves neither emptiness nor eligibility. Recorded deletion remains refused. |
| `change_package` | objectName, native objectType, oldPackage, newPackage, optional transport. Native objectType must be CLAS/OC, INTF/OI, PROG/P, PROG/I, FUGR/F, DDLS/DF, DCLS/DL, DDLX/EX, BDEF/BDO, SRVD/SRV or SRVB/SVB; real source/target package checks and an exact one-object native preview. Recorded-to-local moves and expanded/ambiguous previews refuse. |
| `set_api_state` | type/name (CLAS/INTF/DDLS/DCLS/BDEF/SRVD/FUNC; FUNC requires group), contract C0–C4, apiState RELEASED/NOT_RELEASED, expectedCurrentState, optional complete apiVisibility (cloudDevelopment/keyUserApps) and transport. Native v10 contract/ReadOnly metadata and the actual APIS recording resource decide eligibility. Revoke (`NOT_RELEASED`) refuses apiVisibility. |

API-state read/merge/write/readback has no qualified atomic compare-and-swap/lock contract; the
expected state check does not eliminate concurrent edits. Ordinary SRVB CRUD requires
unpublished/non-generated state. A separately reviewed internal V4
parent-delete profile exists for source-bound qualification with both package policies and both
request policies explicitly `*`; it sends one parent DELETE and no child/SRVD deletion. It has no
public tool route. Parent typed absence and generated cleanup accepted-but-unverified are distinct.

Publication submits the explicit authorized native job even if the initial getter appears to match.
On-prem 758 platform evidence, exact owner/package/version and fresh full metadata remain required.
The selected public profile lets SAP govern native recording under both explicit unrestricted
request lists. It does not promise non-recording or return a verified CTS receipt. Native acknowledgement
and branch-dependent getters do not prove every frontend/alias or cloud BAdI branch succeeded.
A stronger internal non-recording profile remains separate and lacks a general configuration reader.

## CTS management and source recording

All six management actions require `SAP_ALLOW_WRITES`, `SAP_ALLOW_TRANSPORT_WRITES`, raw `write` and
`transports` scopes, exact target grants, destination opt-in and both request policies. An absent or
empty destination request list denies management. The global list retains its existing
empty-means-unrestricted convention; destination policy never inherits that convention.

| SAPTransport action | Inputs and scope |
|---|---|
| `create` | description and either native target, or package plus optional transportLayer. Creates a Workbench K request; no caller request type/ID. Generated IDs require unrestricted global policy (empty or explicit `*`) **and destination explicit `*`**. Narrow lists require a request created separately. |
| `release`, `release_recursive` | exact id, optional timeoutSeconds (maximum 300 and bounded by the remaining call deadline). Native inactive-object precheck, membership/state verification and terminal evidence; recursive release includes its authorized tasks. |
| `delete` | id, optional recursive/removeLockedObjects. Validated request/task states and complete membership; these flags do not bypass native authority or scope. |
| `reassign` | id, exact native SAP owner, optional recursive. Changes request/task ownership, not an ARC-1 identity mapping or role. |
| `remove_object` | id plus complete pgmid/type/name object key (pgmid defaults R3TR). Removes the CTS entry, not the repository object. |

Allowed parents cover only proven native child tasks. Recursive operations authorize the full initial
set and revalidate before submissions; every observed expansion remains inspection evidence even if
later omitted. Native errors can have partial effects, including recording; no automatic retries or
compensation follow. Release can affect downstream TMS queues outside the selected target. Request
allowlists are not an import-route sandbox; use SAP approvals and, if needed,
`SAP_DENY_ACTIONS=SAPTransport.release,SAPTransport.release_recursive`.

`target` in CTS create is SAP's TMS target, never an ARC-1 connection selector. A native target field
must be present to interpret its value: a verified empty target is local; missing is unknown.
Source recording remains independent of transport-management permission. Enabling source writes
alone can record changes in allowed requests but does not authorize explicit CTS management.

## Runtime controls, quickfix and formatter preferences

| Tool/action | Inputs and scope |
|---|---|
| SAPDiagnose `trace_start` | exact traceUser; processType/objectType supported pair; maxExecutions 1–100 (default 1), expiresHours greater than 0 and at most 24 (default 24); sqlTrace, aggregate, description. One explicit subject and the route's native client, subject to SAP authorization. |
| SAPDiagnose `trace_cancel` | native request id and exact traceUser; verify the requested subject/client and identity before cancellation. No global trace clearing. |
| SAPDiagnose `set_sql_trace_state` | sqlOn; exact user required only for true, no user field for false. Across application-server instances, not client-isolated or necessarily own-user. Active non-SQL traces block a write that would clear them. ON refuses replacing a live filter; OFF resets qualified known filters/non-stack properties to native inactive defaults. Unknown reset shapes and allUsers remain refused; an already-matching state is preserved without PUT. |
| SAPDiagnose `apply_quickfix` | type/name for CLAS/INTF/PROG/standalone INCL, source, line/column, exact proposalUri/proposalUserContent and optional same-owner sourceUri/proposalAffectedObjects. Returns unsaved deltas only; saving still uses guarded SAPWrite. Exact proposal/context/range checks remain, without fictitious package authorization for delta calculation. |
| SAPLint `set_formatter_settings` | indentation and/or style for the mapped user's preferences on this selected system; native read/merge/write/readback, not a package object. |

Profiler process/object pairs are http→url (the default), dialog→transaction/report, batch→report,
rfc→functionModule, or any→any/url/transaction/report/functionModule. Description is one line of
at most 120 characters; sqlTrace and aggregate default true. Explicit trace subjects may be another
SAP user when SAP authorizes it. A same-user HTTP profiler
request can be consumed by the next ADT call, so arming skips the consuming readback and reports
that limit. Existing trace reads keep their scopes; PP trace_requests requires an explicit traceUser
or user because an IdP login name does not establish the mapped SAP user.

Formatter reads/patches require native v5. They preserve untouched visible XML fields, with no lossy
older-version fallback. Accepted styles are keywordUpper, keywordLower, keywordAuto and none;
native toUpper/toLower settings currently refuse even reads. Hidden storage and same-user concurrent
updates are not proven preserved. Strong ETags are sent when present, but native conditional-write
enforcement remains unqualified; observed writes were native-unconditional. Historical
[two-writer and v5 evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-broader-pinned-pp-writes-combined-qualification.md)
applies to its named artifact and styles, not every current combination.

## Classic FLP

| SAPManage action | Inputs |
|---|---|
| `flp_create_catalog` | domainId, title |
| `flp_create_group` | groupId, title |
| `flp_create_tile` | catalogId, tile containing id/title/semanticObject/semanticAction, optionally icon/url/subtitle/info |
| `flp_add_tile_to_group` | groupId, catalogId, exact tileInstanceId |
| `flp_delete_catalog` | catalogId |

These operate on classic PAGE_BUILDER_CUST content shared with the selected client's users, not on
repository packages, modern spaces/pages or Work Zone. Supported tile URLs are same-origin paths,
launchpad hashes or HTTPS; arbitrary scripts/data URLs refuse. Native platform evidence currently
limits mutations to the reviewed on-prem 758 CUST flow. Both effective request policies must
explicitly contain `*`; the native no-dialog recording/authorization flow governs the request or
non-recording decision. Narrow/missing/malformed policies refuse before submission. This is distinct
from CTS create's legacy-empty global rule and does not require a new transport-management gate.

Creation uses the native create-only/duplicate-protection contract and exact returned/readback
ownership; a random name or unknown pre-read is not proof of absence or permission to overwrite.
A generic OData 404 or application `/UI2/FND/604` remains unknown, never an absence classifier.
Successful catalog DELETE can therefore remain acknowledged-but-unconfirmed in the public result.
Multi-step tile/group operations can be partial; no automatic rollback/retry or CTS receipt is
promised. The separately audited fresh ordinary-CUST cleanup protocol is narrower than a universal
public absence guarantee. There is no added public group-delete action.

## Supporting reads and visible catalogs

Writer-only read companions retain normal read scope but also require a writable pinned strict-PP
connection with raw write scope and exact grants: SAPLint `format` (source; returns only formatted
text), `get_formatter_settings`; SAPTransport `layers`, `targets`; SAPManage `flp_list_catalogs`,
`flp_list_groups`, `flp_list_tiles` (catalogId), `features`, `probe`, `cache_stats`. Other readers retain
their existing catalog, including ordinary editable reads and available quickfix discovery. Lists
are bounded and incomplete/truncated native results are not treated as complete or empty.

**A displayed action is not authorization.** An application with writes enabled may show actions on
a destination that is read-only; cached client catalogs can also outlive a policy change. Read-only
applications/destinations must still refuse every mutation at dispatch and the low-level boundary.
There is no extra acknowledgment switch. Refresh the catalog after configuration/role changes.

## Qualification and release limits

The [current acceptance ledger](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-11-05-pr1142-current-acceptance.md)
tracks final checks and remaining native/PP/restoration gates. The table below summarizes evidence boundaries.

| Evidence | What it establishes |
|---|---|
| Historical two-writer PP runs | Only their named builds/CLAS-INTF/include/formatter combinations; not final PR2 acceptance. |
| Current on-prem SAP_BASIS 758 native representatives | Package/API's seven-stage local workflow and four-owner cleanup, ENHO's retained activation/reverse cleanup, ST05 ON/OFF restoration, procedural/table/MSAG fixture cleanup, and RAP v4 publication/unpublication with seven-owner reverse cleanup passed their named native protocols. RAP's implicit table settings are typed absent; generated-resource and recording limits remain explicit. These direct Basic-native results are not multi-target Basic write admission or current PP proof. |
| Remaining acceptance | CTS parent/recursive release and empty-request deletion; final current-build two-writer PP/text/recording, classic FLP and negative-route/Basic evidence; verified cleanup and app/IAM/destination/SAP-role restoration, followed by release review. |
| 750 and 816/other platforms | Historical reads or single-target operations do not qualify the full pinned matrix. Discovery and native contracts decide availability; missing qualification is not evidence that SAP lacks the feature. The observed 750 text-pool absence and the explicit 758-only local-package/FLP/publication profiles are concrete limits. Cloud/BTP type filtering and unrecognized native representations remain enforced. |

The [ADR](https://github.com/arc-mcp/arc-1/blob/main/docs/adr/0011-broader-pinned-pp-mutations.md),
[accepted plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-26-broader-pinned-pp-writes.md)
and [remaining roadmap](roadmap.md#feat-93) distinguish integrated source from final acceptance.
Repository objects are generally cross-client: two clients of one physical system are not separate
development sandboxes. DDIC activation and shared include changes can affect consumers outside the
submitted owners; package checks do not promise a complete dependency sandbox.

## Diagnose, disable, upgrade and recover

SAPTargets is aggregate-only. It reports bounded pinnedWrite status for visible targets; admin
diagnostics add effective flags, rule counts and policy digest without exposing raw lists or
credentials. Admin does not grant execution. With a single target, use its pinned connection/catalog.

| Symptom | Check |
|---|---|
| Missing or refused writer action | Current artifact's exact matrix; global/destination switches, target-filtered strict PP, fresh raw scope, access and exact write grant, deny/feature/platform policy |
| Destination quarantined | Strict property syntax; PP for writes; standard mode rejects write properties; invented destination transport/Git enabling properties are unsupported |
| Package/CTS denied | Both real-owner package lists or both request lists; native request/task membership/state; CTS scope/global switch for management |
| Source/metadata changed | Re-read the same editable resource/version, review changes and use its new matching hash |
| TARGET_CONFIG_CHANGED | Review the destination and restart all instances; never silently remap an old target ID to another backend |
| Partial/unknown result | Inspect native source/state, requests and locks before another decision; a failed response can follow a real save/create/delete |

Before upgrading an already opted-in writer, review the expanded matrix, deny unwanted actions,
confirm both destination restriction lists and merged role scopes, and retain the old application
artifact, MTA properties, destination configuration and XSUAA role assignments. No second switch
or upgrade acknowledgment is introduced. Write-off apps/destinations do not acquire writes.
Older binaries may quarantine newly supported destination properties; restoring the binary alone
is insufficient for rollback. Restore its matching destination/configuration too.

Restart **every instance** after server/destination policy changes; sign in fresh and refresh the MCP
catalog after IAM/scope changes. A changed destination fingerprint rejects subsequent lookups until
the new snapshot is adopted, but already admitted work can finish. Removing a role does not instantly
revoke old access tokens or refresh sessions. Verify effective permissions and denied calls after changes.

For administrative disable, set SAP_ALLOW_WRITES explicitly false and restart, or disable the
destination's write opt-in and adopt the new snapshot. In MTA extensions use the explicit false
value; removing a property does not undo an earlier setting. Never undo uncertain SAP writes by
blindly replaying or rolling back code. Audit delivery retains its asynchronous contract; monitor
sink failures rather than assuming every mutation awaits a durable audit acknowledgement. Deployment,
restart and rollback procedures remain in the [administration guide](btp-administration.md).
