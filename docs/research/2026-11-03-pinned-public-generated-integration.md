# Reviewed public routing and private generated V4 deletion integration

This source candidate combines the reviewed public routing/input correction and private generated
V4 parent-delete components on `a73cb2e4f72abf506647c28797d958912f1c8f1a`. It supplies no native
execution, PP, deployment, public-release or whole-PR/merge approval.

## Preserved independent reviews

The following reports are copied byte-for-byte. Their scopes and qualifications remain intact.

| Report | Exact reviewed source | Disposition | SHA-256 |
| --- | --- | --- | --- |
| [Original public wiring review](2026-11-03-pinned-public-admission-review1-verbatim.md) | `ec7a98e2b25c2a6a6e137bd727d1cad4c1db3bb3` | NO-GO: two P2 raw-input preservation gaps; other reviewed boundaries retained | `ba02806e14c5c32f0031f367b6b0bdeb2f87feec7a1aca252e1ae28ef0dc2257` |
| [Narrow public correction closure](2026-11-03-pinned-public-input-correction-review2-verbatim.md) | `327d4d8417f0404ac2ffaef0e5b4f13f3158178a` | F1/F2 closed; correction-only source GO | `dc93d26f85b07bb3c347eca94113e5e061de3e57ab93820df081e6f62968abfd` |
| [Generated V4 parent-delete review](2026-11-03-pinned-generated-v4-delete-review1-verbatim.md) | `a52dac67603548f1570bc9acf3a7bdebbdeab949` | GO for private integration only | `87524833df6f7a62c34e537a49f6531fa04c652f64e46ceea3460a78cda7da3d` |

The correction reviewer authored the earlier broad public wiring but not the root-authored
correction. The original package_continue review remains the independent whole-wiring assessment;
its raw NO-GO is preserved, not replaced by an invented retrospective approval. Original review
probes, initial failures and their later passing results remain bound in the private review packets.

## Components and interactions

Public implementation commits `8917cec6edd83268aad6cbd1d3ef8ff4c3521ffa`,
`ec7a98e2b25c2a6a6e137bd727d1cad4c1db3bb3` and
`327d4d8417f0404ac2ffaef0e5b4f13f3158178a` were cherry-picked, followed by generated-delete
implementation `402efe43b0d4ceb92a855c2d66ed26f95c17e1ef` and clarification
`a52dac67603548f1570bc9acf3a7bdebbdeab949`. There were no conflicts; roadmap context auto-merged.
No qualification script, native fixture or retained V5/package execution record was changed.

The public correction rejects meaningful API revoke visibility and inapplicable raw function
processing selectors, including nested batch items and non-update `updateTaskKind`, before the
legacy normalizer can erase them. Null/blank optional handling, valid aliases/options and legacy
single-target normalization remain. The later nested post-Zod preservation check stays in place.

The generated profile remains a private callable entry with all four explicit unrestricted
package/request policies, exact verified target/raw scopes and final dispatch checks. Its full
native metadata/parent implementation binding, existing parent CTS/owning lock lifecycle and
bounded one-shot DELETE are unchanged. Typed parent absence remains distinct from generated
cleanup accepted-unverified and downstream recording unverified. It creates no child/SRVD delete
route or public bypass. Ordinary public SRVB deletion still refuses generated owners.

An initial isolated integration check exposed one stale assertion: the generated component's old
test expected every public SRVB delete to be closed. Public integration intentionally admits the
ordinary supported SRVB profile. The integration test now exercises real public dispatch and
verifies that generated-owner deletion still refuses without a DELETE; private hash input also
refuses before further I/O. No production adapter or permission was relaxed to satisfy the test.

The generated review also retains its synchronous injected AbortController/Undici limitation.
No production caller is added for the new private entry. A future source-bound native caller must
keep the reviewed final proof checks synchronous/check-or-throw and independently review any
new cancellation behavior; the prior failed injected probe is not erased by integration.

## Combined validation and remaining gates

Combined validation uses a clean Git archive with per-dependency links/copies, guarded process and
Vitest workers, and before/after immutable verification. The final author report binds the full
unit suite, three TypeScript projects, lint, policy, file/schema budgets, build and strict docs
results and preserves failures. Runtime checks operate against mocks. No environment file,
credentials, SAP/native phase, browser, deployment, dependency installation or push is needed.

The supported public rows are source integration, not native capability evidence. Remaining
backend variants/batch families stay named and refused where unsupported. Current-build successful
two-writer PP, appropriate native lifecycle/recording/cleanup qualification, operator/support docs,
CI and final review remain acceptance gates. Generated-parent native cleanup and eventual public
routing remain separate. FEAT-93 stays open; Git and custom plugins remain outside this expansion.
