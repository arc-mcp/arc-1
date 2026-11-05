# RAP BDEF state-link correction — independent verdict

**GO for private integration** of **7b18bad055b8dfe732d2af7f32df1db95338aee3**, base **c55c59c1861226e27a85de2975678102f848a72e**. No actionable correctness, security or compatibility defect was found in this bounded correction. This is not approval of a native RAP lifecycle, current-build PP, public admission or the whole PR.

Review independence: I authored earlier private RAP implementation work, but did not author this correction, its fixture or its new wrapper tests. This verdict independently assesses the correction and its interaction with the existing wrappers; it is not a claim of independent authorship-free review of the entire original RAP implementation.

## Source and contract

First and final source actions ran the immutable verifier: **4,789 files unchanged**, exact candidate above. Manifest SHA-256: `364b8fd9dacbba0919dc90844873205de26a8e535515f22aa06e0fcca0af7873`. Production `src/adt/pinned-rap-evidence.ts` SHA-256 is `d585d768ff5c114faf16ab83c5abe280ba6a7ff0bfc4a3d03cd7b94fe0da81c6`; sanitized fixture SHA-256 is `5cbdc12881320df3ebd9dd1791ae9c8a8a584b93eec17429fdecae2ffad97a95`. No source action followed final verification.

The 14-line production diff passes the already-selected BDEF owner to the private version reader and reuses the existing literal same-owner state-link helper. The helper is unchanged and the new import is pure. There is no URL resolution/following, new endpoint, user-controlled bypass, write grant, public schema change or capability expansion. Class and class-include alternatives remain on their original absolute source-URI branch.

Native BDEF name/type/package validation still precedes state-link interpretation. Root version remains restricted to active/inactive; duplicate alternatives refuse. A present BDEF objectstates element without an unqualified href now refuses. Exact same-owner relative alternatives and existing absolute source alternatives are accepted; foreign owners, traversal, unsupported encoding/query/fragment forms and malformed/ambiguous evidence refuse.

The raw alternative value, complete canonical metadata hash and native source hash are retained. Metadata is compared before/after the source read, and later dependency revalidation remains in the owning class lifecycle. Individually valid alternate spellings are not normalized away in dependency evidence. BDEF is an observed read dependency: its package is not treated as write authorization, and its URI is never granted a mutation. Invalid proof can be discovered after the intended class LOCK; the required behavior is zero source writes and bounded owning unlock/session cleanup, which the tests verify.

## Independent checks

Node **22.21.1**, existing dependencies, no installs.

- **400 tests passed in six focused files**: private RAP wrappers, evidence, parser/bindings, new state links and shared declarative owned-state helper.
- External `codex-probes.test.ts`: **37 passed**, comprising the 29 copied author cases and **eight additional wrapper tests covering 26 input variants**. Additional checks exercised both helpers with Atom namespace aliases, default Atom namespace, single quotes/spaces around XML attributes; namespaced/missing/duplicate href, duplicate state links, foreign/protocol-relative owners, encoded leaf names, altered version case and extra client/query data; BDEF source drift at the later read; and unchanged absolute class/include alternatives. Successful previews were GET-only, invalid/racing proof caused zero class source writes, BDEF requests remained GET-only, and owning cleanup completed.
- All **three TypeScript projects**, whole-repository Biome check, policy validation and file/schema budgets passed. Biome emitted three informational notices. No unrelated full-suite repetition was needed.
- Tests used the existing fetch-stub native-wire model and synthetic test origins. A setup installed a process-wide `Socket.connect` guard and an after-suite assertion of zero connection attempts for both the focused and external runs. No SAP/native/browser/network, credential/.env, installation, deployment or push action occurred in this review.

An initial external-probe construction mistakenly rewrote relative URI test literals while rebinding imports, producing 16 failed inherited cases. This was a probe-construction issue, not a source finding. The construction log is preserved as `codex-probes-construction1.log`; only import paths were corrected, and all 37 final cases passed. No repository change was made.

## Native representation basis and qualification limit

The two existing private V4 BDEF observations were rehashed read-only and match:

- Default metadata `2ecbdf84c6d8fe9f526e696082cd3def3f40c6dcdbd1cc9abb6d5100a0d4fb00`: inactive root with exact same-owner `?version=active` relative alternative.
- Active metadata `83f7cbec88440910fd6161cedfe8618b67e6015e0b8a925bc520fa789743370b`: active root with the opposite same-owner `?version=inactive` alternative.

The sanitized fixture accurately retains that representation while rebinding the synthetic dependency name/package and omitting unrelated fields. This establishes the observed BDEF link spelling only. It does not establish native managed/unmanaged behavior-pool generation, include initialization, class saves/activation, recording, two-writer PP or public qualification. Research/FEAT-93 explicitly retain those gaps and may now replace this correction's awaiting-review wording with the present bounded approval.

Logs, probes, native-representation hashes and their digests are retained beside this verdict in `codex-evidence.json`; final source proof is `codex-final-verification.json`. All new review artifacts remain outside the source snapshot.
