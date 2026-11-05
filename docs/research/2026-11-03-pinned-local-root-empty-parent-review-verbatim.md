# Independent review: native empty package-parent representation

2026-11-03. **GO for private integration of f1fd62d8ea65e5fd95352c86c3729ab63a0849af only**, relative to ba58d31bc126c7dd6f5fa1043a79f89e5d8eef25. No actionable findings. This is not native execution, PP, public admission or whole-PR approval.

## Scope and conclusion

Reviewed the bound six-file delta and author report, the native lifecycle assessment, exact captured parent serialization, the namespace-aware XML evidence parser, actual private root wrapper and shared package reader/create/delete consumers, package move and service-binding dependencies, and FEAT-93 at start and finish. The production change is the narrow 11-line normalization in `readPinnedPackage`; it adds no selector, endpoint, public input or policy exception.

The new nameless-reference branch requires a present, uniquely selected packages-namespace `superPackage`, no native name, and an empty canonical content array. Namespace-only declarations and XML comments do not manufacture parent data. Missing reference remains undefined. Foreign/rebound names, duplicate semantic elements, attributes, text and child content cannot become an empty parent. Existing explicit named/empty-name behavior is retained. The real-child create comparison still requires its exact requested nonempty parent; a valid empty root readback cannot satisfy that comparison. Actual package authorization remains independent and is performed before the returned metadata is used. Move/delete/service-binding consumers do not derive a new ancestry grant from this normalized field.

Root completion still needs the registered private profile, exact future-name package policies, both explicit unrestricted request policies, request-bound strict PP and all other identity/local/readback checks. Recording remains `native-governed-unverified`. Rejected readback after an acknowledged create remains `created-unverified`, not unchanged; it does not trigger replay or compensation.

## Native evidence and limitation

Independently rehashed the 10,213-byte captured `$TMP` XML (`48ebdcbb310c677f5942f148aa2c7b06a8e49479666f3081c54b41c479f3c984`) and the captured `CL_PAK_ADT_PERSIST` source (`d1d0642e184eff2c365f7d621b8bb7a5d29472022be22ffd84c94202330c7acf`). The actual metadata contains the present-empty parent form. The source only fills the parent reference when the internal parent is noninitial, but catches URI-mapping failure without propagating it. Therefore an empty exposed reference is **not universal proof that internal PARENTCL is empty**. The documented interpretation is appropriately bound to a freshly requested parentless create plus exact readback; real children still need a nonempty mapped parent. This change must not become an arbitrary package hierarchy grant or hidden-parent oracle. `$TMP` remains protected.

The committed fixture is a sanitized, synthetically rebound representation, not evidence of a new native root creation. Its SHA-256 is `2eec32f99a34d4b201b69235e643e429b77105bdb6fa9b31ffdecfe122d6002b`. Native root/child lifecycle, actual recording and cleanup, platform limits, mapped PP and public qualification remain separate work.

## Independent validation

All checks passed on the immutable source with Node 22.21.1:

- **316 tests in 10 files:** 288 committed affected/compatibility tests across nine files plus 28 independent actual-client HTTP probes. The affected suites cover package reader/create/delete, the actual private root wrapper, package hierarchy, managed move/API state, native XML parsing, package metadata, failure reporting and ordinary cloud create compatibility.
- The 28 independent probes exercise both direct fetch and Connectivity proxy HTTP paths. Positive controls cover alternate/default namespaces and an empty XML-comment form. Negative controls cover duplicate expanded names, nested foreign content, namespace rebinding, foreign-name aliases, nonempty or empty URI attributes, CDATA, numeric-entity text, xsi:nil, whitespace attribute content and duplicate-name namespace spoofing. Every probe asserts exactly GET → HEAD → POST → GET; rejected metadata is `created-unverified`, nonretryable, with no PUT/DELETE or second create.
- All three TypeScript projects passed through `npm run typecheck`.
- Full read-only Biome check passed with only three existing informational style notices; no fixes applied.
- Policy validation passed: 135 entries covering 14 tool schemas.
- Source/test file-size and all tool-schema budgets passed.

The external probe file reuses the existing test's HTTP/registered-context harness prefix, with imports rebound to the immutable snapshot; its test cases are independently authored. MockAgent disabled network access, including an external offline setup file. No CLI entry, dotenv stub, credentials, native request, browser, installation, manual Git operation, delegation, or source mutation was used. No reviewer test failure occurred. A full suite/build/docs rerun was unnecessary for this bounded reader correction; the author reports those gates separately, and this verdict does not relabel them independent checks.

## Binding and preservation

The first and final source actions were the supplied snapshot verifier. **Both verified all 4,771 bound files unchanged** at the exact candidate. Final output is retained in `independent-final-verifier.log`. No further source action followed final verification. Logs, probes, configuration and this verdict live outside `source`.

- Bound author report: `fd1d0e34ecd86e99054a3d37323e95339111ae0afaf3a85ececf49b87db5b7aa`.
- Bound delta: `ec4dcd65b5d9d3838f010dcd5699e5a818b73048ad6fc28d4d6490f7cb1b0a43`.
- Bound snapshot manifest: `8d70c12c4ea2f332d494eb500e97515f9ace7774a063a8ae7e2b41a01918ab3a`.
- Production reader: `7aea96b4a7a0acdf5475aef0e6f17b451fdb68044472e0d6410bc7f436a1738c`.
- Independent probe source: `0c0933494dcbdc7681bc476eeb84602ea841ad1f5026071d58d975584d903f0f`.
- Independent 316-test log: `539321abbb16b3270734cb20ebddee01598a575745327868f34370f00a80369e`.

Additional source, configuration and check-log hashes are preserved in `independent-evidence.json`. Original author failures and native records were not altered. No execution approval is conveyed.
