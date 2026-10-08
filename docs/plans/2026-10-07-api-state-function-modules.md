# Function-module API release state (#928 / #931)

## Root cause and evidence

`SAPRead(API_STATE)` and `SAPManage(set_api_state)` resolve ordinary object types
through `objectBasePath`. Its intentional FUNC refusal is correct: a function
module URL needs the parent function group. Neither handler previously resolved it.
The existing deployed ARC-1 reproduced this failure for
`BAPI_CONVERSION_EXT2INT` before making an API-release request.

PR #931 resolves the group, but its new raw function-module URL helper assumes
that namespaced names must not be encoded before the whole URI becomes an API
release path segment. Live SAP_BASIS 758 SP02 contradicts that assumption:

- `BAPI_CONVERSION_EXT2INT`, both resolved and explicit `BACV`, returns C1 RELEASED.
- `/BOBF/CL_DAC_UPDATE` and `/BOBF/CONF_CTS_AFTER_IMPORT`: the raw nested URI gives
  HTTP 400 from `/apireleases`; the existing `functionModuleObjectUrl` form gives
  HTTP 200 with C0/C1 NOT_RELEASED. Encoding the complete URI then correctly
  preserves the already encoded group/name segments (`%252F` on the wire).
- The namespaced raw metadata URI gives HTTP 404; the existing encoded helper
  resolves the real `/BOBF/DATA_ACCESS` package. The write package gate therefore
  also needs the encoded form.
- SAP_BASIS 816 live verification is blocked by SAP's license-check logon error
  (`E 00 179`), before any object request can succeed.

Research used the contributor head plus a normal merge of current `origin/main`,
direct current-source calls over HTTPS with Basic authentication, TLS verification
enabled, client 001. Existing contributor unit tests pass, illustrating why the
namespace expectation needs correction using live evidence.

## Plan

Reviewed before implementation and approved. Implemented and verified; see the
[live research and verification record](../research/2026-10-07-function-module-api-state.md).

1. Continue PR #931, preserving its contributor commits and the merge from main.
   The narrow handler fix is suitable; no replacement PR is necessary.
2. Retain explicit `group` and existing bounded resolver behavior for reads;
   retain name/type resolution and explicit `objectUri` for writes. Use the
   existing `functionModuleObjectUrl` in both branches and remove the new raw
   helper. Generic object URI behavior was initially unchanged; the review
   follow-up below supersedes that boundary with new evidence.
3. Correct the namespace regression expectation. Cover a namespaced group resolved
   from an encoded search URI, the metadata package gate with a restricted
   allowlist, rejected/missing packages, read-only rejection, and cached read
   resolution with a fresh API-state GET. No new schema or generic resolver layer.
4. Verify current handler behavior live on 758, including namespaced reads, the
   missing-group path, and a create/release/unrelease/delete round trip on a unique
   disposable `$TMP` function module if SAP permits release there. Record SAP
   capability refusals precisely. Try 750 read compatibility when the shared test
   window is free; record 816's license limitation.
5. Run focused regression suites, typecheck, lint, policy validation, size/schema
   budgets, build, and the complete unit suite. Independently review the final
   patch and repeat affected checks for findings before normal push to #931.

## Boundaries and roadmap

The existing scope/safety checks and real-object package gate remain in place.
Search failures cannot reach the release API. API-state data is always read from
SAP; the existing optional cache stores only group routing. No shared credentials,
new cache policy, raw HTTP exposure, or broad object URI refactor is introduced.

Roadmap checked on 2026-10-07: no item covers this narrow bug; no roadmap impact.

Independent final review covered the complete PR diff, namespace routing, fresh
API-state reads with cached group resolution, package refusals, documentation,
and the live evidence. No actionable findings remained after the namespace fix.

## Review follow-up: namespaced non-FUNC objects and group prose (F2/F4)

The later external review identified a pre-existing generic-URI bug missed by the
initial review. Independently reproduced on PR head `53df9955` (which contains
current main `907b02c0`) using SAP_BASIS 758 SP02, HTTPS/Basic and TLS verification:

- CLAS `/IWBEP/CL_CP_FACTORY_REMOTE`, INTF `/IWBEP/IF_CP_CLIENT_PROXY`, and DTEL
  `/AIF/IFNAME` each fail with HTTP 400 through `SAPRead(API_STATE)`. The existing
  encoded `objectUrlForType` returns actual C1 `RELEASED` contracts for all three.
- For that class, `set_api_state` by name fails at the raw metadata URI with HTTP
  404; the encoded URI resolves `/IWBEP/CP_RUNTIME`. A harness refused every PUT,
  and no SAP-owned object was changed.
- `SAPRead(VERSIONS)` for `BAPI_CONVERSION_EXT2INT` without `group` resolves `BACV`
  and returns its revision. The tool text incorrectly says `group` is required.

Follow-up independently reviewed and approved before code changes:

1. At both generic API-state call sites, use the existing `objectUrlForType`.
   Remove `objectUrlForTypeRaw`, which has no other callers. Preserve FUNC group
   resolution, explicit write `objectUri`, and all safety/package gates.
2. Replace the misleading raw-encoding test with real-object CLAS/INTF/DTEL
   namespace regressions that check a released contract and the encoded wire
   path. Add focused generic namespace write coverage for the permitted package
   path and real-package denial before any API-release call. Run these red on the
   current implementation, then green after the fix; retain all FUNC coverage.
3. Drop the incorrect required-group clause and regenerate the seven tool
   snapshots. Correct the earlier research instruction to leave generic CLAS raw
   URIs unchanged: nested encoding also applies to non-FUNC namespace names.
4. Verify the final handlers read the three live contracts and deny the SAP-owned
   class at its real package without reaching any API release mutation. Recheck
   FUNC and VERSIONS compatibility on 758 and the unsupported API release endpoint
   on 750. Do not retry license-blocked 816 or mutate SAP-owned objects.
5. Run focused and full unit tests, typecheck, lint, policy, file/schema budgets,
   and build; check roadmap again. Obtain an independent final review before a
   normal commit/push to the existing PR. No PR merge.

No roadmap impact: no roadmap idea covers this URI bug or the prose correction.

Follow-up implemented. Final built handlers passed the read-only 758/750 matrix,
including all three released namespace examples, ordinary/namespaced FUNC reads,
real-package denials before any release call, and VERSIONS group auto-resolution.
No SAP mutation was attempted. All gates passed (261 files / 7,857 unit tests).
Two independent final reviews found no runtime issues. The second review caught a
remaining `FUNC needs group` parenthetical in `objectType` prose; it was removed
alongside the earlier `group` correction, and all seven snapshots regenerated.
Focused snapshot/handler tests and size/schema budgets passed after that final
prose correction. Publication was approved as a normal follow-up commit; no PR
merge was requested or performed.
