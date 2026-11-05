# Private DDIC and server-driven adapters — 2 November 2026

PR 2 now has private native profiles for the DDIC metadata, table and server-driven families below.
They enter the existing shared handlers and owning-session lifecycle. **Public admission remains
closed:** no capability row, tool schema or catalog entry changed, and the `SAPWrite`/`SAPActivate`
routes still refuse these types. This work ran offline only: no SAP system, cloud service, browser or
credential was used, and it is neither live nor PP evidence.

The independent Codex fallback review requested four P2 corrections; the
[implementation and verbatim report](2026-11-02-pinned-ddic-review-followup.md) preserve their
dispositions. The corrected candidates await a fresh independent review and all native qualification.

Base `13f5518a`. Evidence replayed from the repository: `tests/fixtures/xml/{domain-metadata,domain-with-fixvalues,dataelement-metadata,tabletype-stringtab,lockobject-emekkoe}.xml`,
`tests/fixtures/sdo/*`, `tests/fixtures/table-{settings,index-metadata}-758.xml`, the
[table settings](2026-10-12-table-technical-settings.md) and [index](2026-10-12-table-indexes.md) contracts and
`docs/research/abap-types/types/{msag,tabl}.md`. Those identify native wire shapes on their recorded
releases; they do not qualify these new adapters on any release.

## Supported surface

| Type | Create | Update | Delete | Activation | Precondition on update |
| --- | --- | --- | --- | --- | --- |
| DOMA | POST + read-back | Under-lock merge | Yes | Exact owner | Optional `expectedMetadataHash` |
| DTEL | POST + required locked PUT | Under-lock merge | Yes | Exact owner | Optional `expectedMetadataHash` |
| TTYP | POST + required locked PUT | Plain standard tables only | Yes | Exact owner | Optional `expectedMetadataHash` |
| ENQU | POST + read-back | JSON merge | Yes | Exact owner | Optional `expectedMetadataHash` |
| MSAG | POST, plus locked PUT with messages | Under-lock merge; master language only | Yes | Exact owner | Optional `expectedMetadataHash` |
| TABL/DT, TABL/DS | POST with `_package` + source save | Source replace | Yes | Exact owner | Required `expectedSourceHash` |
| TABL/DTT | No: parent owns it | Partial patch | No: parent owns it | Exact resource; `new` settings refuse and direct to TABL | Optional `expectedMetadataHash` |
| TABL/DTI | Inherits parent package | Source replace | Yes | Exact owner; a warning is unverified | Required `expectedSourceHash` |
| DESD, DTSC, CSNM, EVTB, EVTO, COTA, DSFD, DTDC, DRTY, SAJC, SAJT | Registry POST + source save | Source replace | Deletion check, then DELETE | Exact owner | Required `expectedSourceHash` |
| APLO, UIAD | Same; saved active | Source replace; UIAD runs its candidate check and read-only refusal | Same | Refused: SAP saves them active | Required `expectedSourceHash` |

Bare `TABL` means TABL/DT on create. Elsewhere the subtype comes from an exact repository-search hit, and
the metadata root at that collection must agree. An assertion that disagrees, a search failure and an
ambiguous hit all refuse; there is no collection probe, because writing a transparent table through
`/ddic/structures/` changes its table class (#285).

Not adapted, each refusing with its reason in `pinnedDdicSelection`:

| Type | Why |
| --- | --- |
| SHLP, VIEW, TRAN | No ARC-1 write path exists. These are read-only readers; nothing was invented for them. |
| SRVB | Metadata CRUD is bound to publication state (`published`, `bindingCreated`). Needs the publication family's adapter and native evidence for updating a published binding. |
| ENHO | Its builder preserves implementations through a separate mechanism, and spot/filter reads run during merge. The projection guard has no evidence for this document shape yet. |
| SKTD/KTD | Parent reference validation, multi-node drafts and the envelope merge need their own adapter. |
| `batch_create` | Tracked as its own inventory row; its nested activation path still refuses multi-target. |

## Metadata preservation

Metadata PUTs replace a whole document, so `pinned-metadata-write.ts` reads `?version=inactive` under
the lock, because an unversioned read can hide another user's draft. It merges through the existing
`mergeMetadataWriteProperties`, and legacy reads are unchanged. Three additions:

- `pinned-metadata-projection.ts` flattens stored and target documents and refuses any difference
  outside the paths the explicit inputs select. Unknown native fields, `doma:style`, a sorted table
  type or a documented message refuse instead of silently resetting. This is stricter than single-target:
  a non-standard table type with `rowType` is rewritten there on request and refused here.
- Field paths preserve namespace identity. Numeric equality is limited to known dimension/count
  fields; labels, descriptions and character values stay exact. Extension fields cannot disappear
  under a selected subtree, and only exact native/profile-derived metadata is excluded.
- Root `masterLanguage`, `masterSystem`, `responsible` and `abapLanguageVersion` carry the stored values,
  or none where SAP stores none. The legacy `config.username`/`H00`/session-language defaults are not used.
- Read-back compares the saved document with the target. Only values SAP derives during a save are
  excluded: domain-derived DTEL dimensions, dictionary-row `builtInType` and derived lock parameters.
  Activation uses the captured definition mode for the same exemptions; explicit built-in definitions
  and explicit ENQU parameters must match. MSAG updates require usable, agreeing native language and
  master-language identity; absent or ambiguous evidence refuses before PUT.

An explicit DTEL `domainName` now takes effect. The shared merge keeps the stored `typeName`, which
silently ignored it; the pinned profile promotes it. The single-target path is unchanged. Hash values
exclude server bookkeeping such as `changedAt`, so they detect stored-value drift, not every native change.

## Policy, outcomes and activation

Every call goes through `withLockedMutation` with the shared lock policy, which rechecks identity,
package and CTS recording under the lock. CTS requests resolve to the verified parent and tasks stay
modifiable. Requests inherit the five-minute deadline, cancellation and no-replay policy, with separate
cleanup. Technical settings and indexes prove their package from the native TABL/DT parent; a caller
package can only confirm it. Native metadata reads have a 1 MiB budget and server-driven source reads 4 MiB.

Outcomes stay truthful: `metadata-save-unknown`, `created-metadata-unknown`, `created-source-unknown`
and the `*-rejected` states are never retried. A create that succeeded is never repeated after a later
failure. Immediately active types verify native `active`; otherwise they report the failed phase.

Activation uses `runPinnedActivation` through a separate internal grant that tool arguments cannot supply.
Only the exact owner reference proceeds; every expansion refuses before confirmation. Draft metadata and
source are captured at both preaudit phases, and a change stops confirmation. Success then requires
native `active` from the default, explicit active and explicit inactive reads, so a remaining draft
fails, plus the same source hash for source-backed types and preserved definition fields for metadata types. Warnings on TABL/DTI remain unverified because 758
reported active metadata after a failed unique-index build. The result warns that DDIC activation can
adjust dependents the references do not list.

## Fresh native evidence required before public admission

Run these once per family on a disposable `$TMP` object, then on a recording package, then through real
PP. Only the listed fixtures record any of these shapes, and none has seen these adapters.

1. Whether `?version=inactive` substitutes the active document for DOMA, DTEL, TTYP, ENQU and MSAG when
   no draft exists. A 404 currently refuses every update, so this can block the whole metadata family.
2. Round-trip fidelity of real stored documents: which paths produce false refusals, especially TTYP
   dictionary rows, DTEL reference kinds, ENQU secondary tables and MSAG flags.
3. Whether PUT accepts the stored root attributes, and whether a save changes `responsible` or
   `masterSystem`.
4. `IS_LOCAL` and CORRNR in LOCK responses for each collection, and `transportchecks` for the settings and
   index URIs (`LIMU TABT`, `LIMU INDX`), through the unchanged `pinnedRecording` parser.
5. The typed `ExceptionResourceNotFound` absence after DELETE on each collection, including `Accept` under
   the registry metadata MIME, and whether SDO source reads accept the bare MIME requested here.
6. Preaudit references for each activation, in particular a new table with new settings: whether SAP lists
   `TABL/DTT`, which is refused today and would need an explicit expansion decision.
7. Post-activation metadata and derived fields, and whether the explicit inactive read substitutes the
   active document after activation. The adapter relies on that instead of parsing `objectstates` links.
8. Release coverage for 750, 758, 816 and BTP, and two-writer PP evidence with an IdP name that differs from
   the SAP user. Every statement above is unqualified until then.

The [editable read companions](2026-11-02-editable-native-read-companions.md) now expose native
metadata/source preconditions through ordinary `SAPRead(format="editable")`, including TABL and
server-driven types. Their independent review and native view qualification remain open. Write
capability rows, raw-field checks, write schemas/snapshots and catalog review remain separate work.

## Validation

Offline checks added here: `tests/unit/adt/pinned-{ddic-owner,metadata-projection}.test.ts` and
`tests/unit/handlers/pinned-{ddic-metadata,ddic-table,server-driven,ddic-activation}.test.ts`, on a
stateful fake in `pinned-ddic-harness.ts`. They cover success, drift, wrong package/owner/type/subtype, CTS,
cancellation, budgets, failed saves, stale preconditions, cleanup, public refusal and read-only routes.
The existing DOMA negative case in `pinned-delete.test.ts` moved to SRVB because DOMA now has a profile.

Mocks prove the control flow only. They replay recorded shapes and cannot show that SAP accepts these
requests. Other families, final two-writer and recording-transport PP remain outstanding, and this file
makes no whole-PR readiness claim.
