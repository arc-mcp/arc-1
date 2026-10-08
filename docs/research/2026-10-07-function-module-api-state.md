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
The initial investigation left generic CLAS raw-URI handling unchanged. That
assumption was incorrect: the later review and independent reproduction below
show that a namespaced non-FUNC object also requires both encoding layers.

## Initial function-module implementation verification

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

## Follow-up review: generic namespaced API state and VERSIONS group

The external review's F2 and F4 were independently checked on PR head `53df9955`,
containing main `907b02c0`. On SAP_BASIS 758 SP02, the current handler's raw URI
failed with HTTP 400 for each existing released object below. Calling the same
client with the existing encoded `objectUrlForType` returned real contracts:

| Object | Type | Encoded result |
| --- | --- | --- |
| `/IWBEP/CL_CP_FACTORY_REMOTE` | CLAS | C1 `RELEASED`, C4 `NOT_RELEASED` |
| `/IWBEP/IF_CP_CLIENT_PROXY` | INTF | C1 `RELEASED`, C4 `NOT_RELEASED` |
| `/AIF/IFNAME` | DTEL | C1 `RELEASED` |

For the class, `set_api_state` by name reached a raw metadata URI and failed with
HTTP 404. Its encoded metadata URI resolved the real package `/IWBEP/CP_RUNTIME`.
This bug predated #931. It is now fixed at the same two API-state call sites using
`objectUrlForType`; the redundant `objectUrlForTypeRaw` helper is removed. The
complete encoded URI is still escaped once for `/apireleases`, preserving `%252F`
for namespace slashes in its nested object-name segment. This applies equally to
CLAS/INTF/DTEL and FUNC; empty contracts for a nonexistent sample are not evidence
that a URI works for a real released object.

`SAPRead(VERSIONS)` without a group for `BAPI_CONVERSION_EXT2INT` resolved `BACV`
and returned its revision. The incorrect required-group tool clause is removed,
and the public documentation explicitly includes VERSIONS auto-resolution.

The follow-up plan was independently reviewed before implementation. Four focused
namespace regressions (three reads and the real-package denial path) failed on the
published head because its URLs were raw. The tests replace the old test that
incorrectly forbade nested encoding; a permitted-package write test also covers
the encoded metadata lookup followed by GET/PUT/GET and confirmed release state.
The existing FUNC/cache/safety tests remain unchanged.

Final follow-up validation used `npm run build` output from the correction on
`53df9955`, again through `handleToolCall`, HTTPS/Basic and verified TLS:

- All three namespaced objects return the expected C1 release contracts; an
  ordinary class control also succeeds.
- Explicit/resolved `BAPI_CONVERSION_EXT2INT`, resolved `/BOBF/CL_DAC_UPDATE`, and
  explicit-group `/BOBF/CONF_CTS_AFTER_IMPORT` reads retain their expected states.
- With `$TMP` allowed, class `/IWBEP/CL_CP_FACTORY_REMOTE` and FUNC
  `/BOBF/CL_DAC_UPDATE` are rejected at their real `/IWBEP/CP_RUNTIME` and
  `/BOBF/DATA_ACCESS` packages. Neither reaches any `/apireleases` request.
- VERSIONS resolves omitted groups and returns revisions on both 758 and 750.
  750 still lacks API-release discovery and returns HTTP 404 for the explicit and
  resolved FUNC requests and the ordinary CLAS control. 816 was not retried.
- A harness rejected all POST/PUT/DELETE calls; zero mutation attempts occurred.
  The earlier disposable FUNC lifecycle remains the write evidence for the
  unchanged function-module mutation path; no SAP-owned object was modified.
- Focused regressions and snapshots: 6 files / 257 tests passed. Complete suite:
  261 files / 7,857 tests passed. Typecheck, lint, policy, file/schema budgets,
  build and diff whitespace checks passed; the same two existing Biome infos
  remain. Roadmap rechecked: no impact.

Two independent final reviews on 2026-10-08 found no runtime issues. The second
review caught another misleading `FUNC needs group` phrase in the `objectType`
description; that phrase was removed and all seven snapshots regenerated. The
focused handler/snapshot tests and size/schema budgets passed after this final
prose-only correction. No additional SAP mutation testing was needed.
