# Native function-resource ownership evidence

Status: read-only investigation plus an offline candidate adapter for PR #1142. Public admission
remains disabled for FUGR, FUNC and group-owned INCL. No mutation or PP qualification is claimed.

Six GETs on A4H / client 001 / SAP_BASIS 758 at `2026-11-01T22:07:41.898Z` captured the native
resource shapes. The [sanitized fixture](../../tests/fixtures/function-owners/a4h-758.json) records
response byte counts and SHA-256 hashes alongside selected identity/package/container fields.
Private originals retain complete XML. Sanitized XML is not the original hashed body; authors,
descriptions and source text are omitted. The exact requests returned HTTP 200 and used no mutation.

| Resource | Observed native identity |
|---|---|
| `SU_USER` function group | `group:abapFunctionGroup`, namespace `http://www.sap.com/adt/functions/groups`, type `FUGR/F`, own package `SUSR` |
| `BAPI_USER_GETLIST` function module | `fmodule:abapFunctionModule`, namespace `http://www.sap.com/adt/functions/fmodules`, type `FUGR/FF`; explicit `SU_USER` / `FUGR/F` container URI and package name |
| `LSU_USERTOP` structural include | `finclude:abapFunctionGroupInclude`, namespace `http://www.sap.com/adt/functions/fincludes`, type `FUGR/I`; explicit group container and package. It is not a standalone `abapInclude`. |
| `/AIF/ADV_MSG_SUM_UI` group and `/AIF/LADV_MSG_SUM_UIF01` include | Same group/include contracts, package `/AIF/INTERFACE_MONITOR`; encoded namespace separators appear with lowercase hex in the container URI |
| `SU_USER` function-group text pool | `rept:textElement`, type `FUGR/PX`, name `SU_USER`, package `SUSR`, native state active from the explicit inactive selector |

These are metadata identities. They do not establish the types/names of activation-preaudit entries,
which may use main-program conventions. An inactive-selector response reporting active state also
does not prove selection when a distinct inactive draft exists.

## Candidate implementation

`pinned-function-owner.ts` proves the native parent independently and then binds each child through
its exact container URI, name, type and package. Both server and destination package ceilings apply.
Every check is fresh and namespace-bound, including under the selected child's lock. Only hex case
in encoded namespace separators is equivalent; queries, source paths, other percent escapes and
foreign containers refuse. The 40-character input bound is an internal limit, not a newly verified
SAP naming contract.

The private source factory selects existing shared FUNC update/signature and structural-include surgery
handlers with hashes, no replay, native CTS checks and owning-session cleanup. Invalid action/hash/
source inputs refuse before optional function-group resolution. FUGR text replacement uses the shared
native pool engine. Candidate FUGR deletion holds its owner and pool locks, refuses an inactive pool
and preserves typed absence/cleanup evidence. FUNC/group-INCL deletion uses its selected resource
lock and independently verified parent package.

Offline tests include captured native owner shapes, namespace/container/package negatives, function
source/signature preservation, structural FORM neighbors, native group pool parts, exact deletion
resources and removed-lock receipts. Renamed resources in mutation fixtures are authored variants;
they do not imply that these standard SAP objects were changed.

Private creation and processing metadata now have offline tests, including observed structural-include membership and cleanup failures. FUGR main-source replacement is refused; native FUNC signature normalization remains unresolved. Activation identities, transportable cases and two distinct propagated SAP writers still need implementation and/or qualification. See the [seventh-review follow-up](2026-11-02-pinned-activation-review-followup.md). The extracted function-processing metadata helper preserves existing single-target
behavior and has a strict private candidate branch; that branch is not reachable through public
function creation yet. DDIC/RAP, batches, other types, management, CTS, traces and FLP remain separate
required parts of the accepted PR #1142 scope. Git and custom extensions/plugins remain excluded.
