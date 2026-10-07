# Function-module API release state: nested URI encoding

Issue [#928](https://github.com/arc-mcp/arc-1/issues/928), PR
[#931](https://github.com/arc-mcp/arc-1/pull/931). Research and verification:
2026-10-07, SAP_BASIS 758 SP02, HTTPS/Basic, client 001, TLS verification enabled.
Tests invoked `handleToolCall` from the local TypeScript source, including normal
argument validation and safety/package gates. The tested source is the correction
in this PR on merge `9f074b0503467e02cbf6d3ce5a5f4c9484e7de25` (contributor head
`0e8913d7` plus current main).

## Root cause and candidate comparison

The deployed version reproduces the issue before contacting `/apireleases`:
`objectBasePath('FUNC')` intentionally throws because a function module needs its
parent function group. The API-state handlers must use the same explicit/resolved
group routing as existing function-module reads.

The contributor's group resolution fixes ordinary function modules, but the
additional raw-URI helper breaks namespaced functions. These live results were
obtained for `/BOBF/CL_DAC_UPDATE` in group `/BOBF/CL_DAC_UPDATE`:

| URI passed to `getApiReleaseState` | Result |
| --- | --- |
| `/sap/bc/adt/functions/groups//bobf/cl_dac_update/fmodules//bobf/cl_dac_update` | HTTP 400, `SY/530 An exception was raised` |
| `/sap/bc/adt/functions/groups/%2Fbobf%2Fcl_dac_update/fmodules/%2Fbobf%2Fcl_dac_update` | HTTP 200, `FUGR/FF`, C0/C1 `NOT_RELEASED` |

`/BOBF/CONF_CTS_AFTER_IMPORT` in `/BOBF/CONF_CTS` gives the same comparison.
The raw metadata URL also returns HTTP 404 from `resolveObjectPackage`; the
encoded URL returns `/BOBF/DATA_ACCESS`.

There are two encoding layers: the group and function name are nested path
segments; the complete object URI then becomes one `/apireleases` path segment.
The second request therefore contains `groups%2F%252Fbobf%252F...`. This is the
working SAP contract, not accidental double encoding. The existing
`functionModuleObjectUrl` already constructs the correct object URI and also works
for metadata/package resolution. Reusing it removes the need for a new helper.
Do not copy the generic CLAS raw-URI handling to this nested FUNC path, or change
the generic CLAS behavior as part of this fix.

## Final implementation verification

- `BAPI_CONVERSION_EXT2INT`: explicit `group="BACV"` and search-resolved group both
  return C1 `RELEASED`, visible in ABAP Cloud.
- `/BOBF/CL_DAC_UPDATE`: search-resolved namespace read succeeds.
- `/BOBF/CONF_CTS_AFTER_IMPORT`: explicit namespaced group read succeeds.
- Missing function name: actionable group-resolution error, no release request.
- With `allowedPackages=['$TMP']`, created disposable group `ZARC931GMUXQL9MH` and
  function `ZARC931FMUXQL9MH`, activated the function, set C1 `RELEASED`, read back
  the released state/ABAP Cloud visibility, set C1 `NOT_RELEASED`, and read back
  the revoked state. Both writes reported `changed:true`.
- Deleted the function and group. Final `ZARC931*` search returned no objects.

Namespaced write routing and allowed/denied/missing package checks are covered by
unit tests; no SAP-owned function module was changed. A fresh API release GET on a
warm function-group cache is also covered. Three corrected namespace regression
tests fail on the contributor implementation and pass with the existing helper.

Automated checks: 260 unit files / 7,853 tests passed; typecheck, lint, policy
validation, file/schema budgets, and build passed. Biome reports two unrelated
informational suggestions in existing files.

## Limits

SAP_BASIS 750 SP02 resolves `BAPI_USER_GET_DETAIL` to `SU_USER`, but the API release
request returns HTTP 404 (both explicit and resolved group). This does not add API
release support to a backend that lacks it: discovery has no `/apireleases`, and a
class control (`CL_ABAP_CHAR_UTILITIES`) also returns HTTP 404. SAP_BASIS 816 rejects logon with
`E 00 179` (license check), so final-source verification there was unavailable.
The contributor's earlier 816/PP read success remains separate evidence; our tests
used local direct Basic authentication, not a BTP/PP deployment.

Roadmap checked before and after implementation: no roadmap impact.
