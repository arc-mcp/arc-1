# Independent retained-v2 entry correction review — GO for the exact source candidate

Candidate: `18985372f68fe81acecad0826d8edcdb80ab059a`.
Base: `3a1743da101b453fa74f8226a44a616dfbc1bf81`.
Independent snapshot: `pr1142-native-v5-retained-entry-review2-20261103-105752/source`.

**Verdict: GO for this limited source correction. No actionable finding in the reviewed delta.** This is not a native execution, public capability, PP, merge or whole-PR approval. A fresh source-bound preflight, actual SM12 prerequisites, operator isolation gates and the one new consumed v2 execution remain separate requirements. Neither prior failed attempt becomes successful through this review.

## Independence and scope

Root authored both correction commits and their committed tests. I authored the earlier independent prewrite failure audit and performed prior source reviews, but did not author this correction. That earlier audit remains the evidence for the actual consumed-v1 failure; this review independently assesses its closure. Its verbatim committed copy still hashes to `c336ace51aebc5360a8c64555303c425d5b8857afa4d2e4f5af2fb8a78801c77`. The bound author report matches `aa30af65ff0625942c8a68e70505ec4c6956eb477e676ad29761048c74b66643`.

I reviewed the actual entry/client/driver composition, the new stopped-history verifier and fixed v2 mapping, and the existing final-send/once-only/deadline/cleanup boundaries they reuse. All **420 production src files are byte-identical to the reviewed base**. The fixed owners, source bodies and six continuation stages remain unchanged. This is a runner correction, not a production guard relaxation.

## Closure and boundaries

The actual execution entry merges the existing recovery policy into the client's safety: A4H/001, independent local `$TMP` package ceilings, enabled pinned mutation context and no permitted recording requests. Preflight omits that policy and retains the separate GET-only transport. Prepare and check do not construct a native client or load credentials. The corrected entry drives the actual AdtClient and six-stage production-helper sequence successfully in isolated mocked HTTP, with exactly the two fixed source PUTs, SRVD-before-view DELETE order and confirmed owning cleanup. Removing the policy reproduces the original pre-mutation refusal.

`nativeLockBinding` and `RETAINED_PROTOCOL` both select the distinct `pr1142-native-declarative-v5-retained-v2` root. Intent/prerequisite validation uses that protocol and exact reviewed revision; existing exclusive claim creation prevents a second execute before another credential load or native request. The old v1 root is not reused, reset, chmodded or repaired.

The hash-fixed stopped ledger binds all 217 consumed-v1 files, seven operator files and the two independent audit documents, while invoking the unchanged older-history verifier first. File-count/membership, bounded bytes/hash, path-component checks, no-follow file reads, directory ownership and symlink refusal remain fail-closed. Readable historical-report exceptions are limited to the two named operator reports and the two audit files; they remain exact-hash-bound and cannot be group/world writable. Other raw files remain owner-only. The previously readable audit directory is accepted only when owned, a real directory and not shared-writable.

The actual complete recursive verifier passed offline against the saved original evidence in 0.065 seconds. The stopped ledger hash is `95d0704ab910f4e8a2f8a7499b4512eeb44590a5446f382b269e63d1bbee3f8e`; the v2 root did not exist before or after this pure verification. No native phase function was invoked against real state.

## Independent validation

- All **8 committed focused suites / 142 tests pass**, including actual entry composition, history, driver, final-send boundaries and native binding.
- **15 external independent probes pass.** Six compose the real entry/client/driver and test successful completion, dropped policy, disabled write, denied package, historical drift during CSRF waiting and baseline expiry during that wait. They also check the nonclaiming offline check, fixed write bodies/DELETE order, preservation of a prior-root sentinel and refusal to re-execute a consumed claim without new credential access. Nine clone the complete real stopped-history packet into isolated temporary directories and test its positive binding plus ledger drift, ancestor/file symlinks, readable raw files, writable report/audit paths, added files and foreign ownership.
- All three TypeScript projects, full Biome lint, policy validation and file/schema budgets pass.
- The first and final snapshot verifier passes bind **all 4,832 files unchanged**. No source or repository edit occurred during review; final verifier was the final source action. No full-suite repeat was needed.
- Process and worker guards were inspected. The harness controls both Undici Agent and Client, uses a MockAgent with external connections disabled and asserts zero OS socket calls. Vite has `envDir:false`; the archived source has no credential `.env`. Existing harness dotenv mocks were unchanged; this review added none. Runtime guard logs show zero blocked network attempts and zero environment-file read attempts; only permitted local loader IPC occurred.

## Preserved review/author limitations

The author's original import-order/mock failure and historical-permission failures remain disclosed and preserved. Two review setup/expectation issues are also retained, without changing source: an external `.ts` helper outside the ESM package initially transformed import.meta.resolve incorrectly, then succeeded as an `.mts` helper; and an overly broad disabled-write assertion initially expected GET/HEAD only. The unchanged private engine performs one CTS precheck before refusing LOCK/PUT when an injected client contradicts the entry's enabled-write configuration. The final probe asserts that exact observation and zero LOCK/PUT/DELETE. This does not describe native CTS checks as side-effect-free, and is not this correction's real preflight path, which remains GET-only. The actual fixed execute entry supplies enabled writes; a public/read-only invocation remains outside this qualification entry.

No native connection, browser, deployment, credential content access, installation, push, source mutation or new agent was used. Whole-PR native/PP acceptance and FEAT-93 completion remain open. Preserve every original consumed claim and evidence file.
