# PR 1142 public admission and generated-binding integration author report

2026-11-03. Offline integration is complete and clean at `c59dd43f597dc99fcebfd52b48617e0b71e51740` on `codex/pinned-public-generated-integration`, based exactly on `a73cb2e4f72abf506647c28797d958912f1c8f1a`. This is a source/test integration checkpoint, not native, PP, deployment, release, or whole-PR merge approval.

The primary checkout and the active native package execution checkout were not edited. No native protocol or SAP phase was invoked, no credentials or environment-file contents were read, no external connection was made, and nothing was installed, deployed, or pushed. The guarded test attempts described below are retained; this report does not claim that the tests made zero network or `.env` attempts.

## Commit sequence and interactions

| Original component | Integrated commit |
| --- | --- |
| `8917cec6edd83268aad6cbd1d3ef8ff4c3521ffa` public adapter dispatch | `6a717e22fcbe27cd760fdbcf70bb84a4c69ae6a1` |
| `ec7a98e2b25c2a6a6e137bd727d1cad4c1db3bb3` catalog/schema reconciliation | `998dbdefaebff23aae227907ee89bdaf2b677b22` |
| `327d4d8417f0404ac2ffaef0e5b4f13f3158178a` raw public-input correction | `9edf61e1269ccf58fdbc9da5cde51a12dc18ad80` |
| `402efe43b0d4ceb92a855c2d66ed26f95c17e1ef` generated-delete implementation prerequisite | `154fc6e41652fa48cd7db6ea9a7ce61879ee7547` |
| `a52dac67603548f1570bc9acf3a7bdebbdeab949` generated native-metadata clarification | `604a5cc329577798790e1be6b100617a3b3eb0ad` |
| New combined test/provenance/plan/roadmap reconciliation | `c59dd43f597dc99fcebfd52b48617e0b71e51740` |

There were no cherry-pick conflicts; the roadmap merged automatically. The generated candidate's implementation prerequisite was included before its final clarification commit, with parent notification. All prior branches remain preserved.

The initial guarded generated-delete suite exposed one expected integration interaction: its blanket assertion that every public SRVB DELETE was closed became stale once ordinary supported SRVB deletion was admitted. The retained initial result is **116 passed / 1 failed**. The integration commit changes only that test and documents/reports: the replacement traverses real public dispatch, confirms that generated state still refuses with zero DELETE submissions, and confirms that public `expectedMetadataHash` cannot select the private generated profile. Ordinary supported SRVB deletion remains advertised. No production guard or permission was relaxed to satisfy the test.

`git diff a73cb2e4f72abf506647c28797d958912f1c8f1a..c59dd43f597dc99fcebfd52b48617e0b71e51740 --name-only -- scripts/qualification tests/fixtures` was empty. All independent V5/package scripts and fixture bindings were preserved. The author checkout was clean at final binding.

## Independent review provenance and scope

The following reports are copied byte-for-byte into `docs/research`, with their dispositions in `2026-11-03-pinned-public-generated-integration.md`:

| Verbatim report | SHA-256 | Meaning |
| --- | --- | --- |
| `2026-11-03-pinned-public-admission-review1-verbatim.md` | `ba02806e14c5c32f0031f367b6b0bdeb2f87feec7a1aca252e1ae28ef0dc2257` | Original independent broader-wiring NO-GO; retains both raw-selector findings. |
| `2026-11-03-pinned-public-input-correction-review2-verbatim.md` | `dc93d26f85b07bb3c347eca94113e5e061de3e57ab93820df081e6f62968abfd` | Correction-only GO on root-authored 327d4d84; original review remains the whole-wiring assessment. I authored the earlier wiring, not the root corrections, and disclosed that relationship. |
| `2026-11-03-pinned-generated-v4-delete-review1-verbatim.md` | `87524833df6f7a62c34e537a49f6531fa04c652f64e46ceea3460a78cda7da3d` | package_continue's independent private generated-delete integration GO, with native/public limits intact. |

The raw-input correction refuses revoked API visibility and inapplicable nested FUNC processing fields before normalization can erase them. The private generated profile retains its explicit unrestricted policy intersection, exact owner/native metadata proof, actual-send guards, one-shot parent deletion, and separate parent-absence versus generated-cleanup/CTS uncertainty. It remains unrouted from public dispatch. The review's injected synchronous AbortController/Undici construction limitation is retained in the integration disposition; this integration does not introduce a synchronous-aborting production callback.

The accepted plan and FEAT-93 roadmap describe the integrated source checkpoint and remaining qualification work. The roadmap was checked again before finishing. No unrelated family status was rewritten.

## Immutable offline validation

Initial immutable packet: `/Users/marianzeis/.local/state/arc1-review/pr1142-public-generated-integration-initial-20261103-093601`. Candidate `604a5cc329577798790e1be6b100617a3b3eb0ad`, **4,844 bound files unchanged** before/after. Its failed initial focused run, JSON receipt and verification are retained.

Final immutable packet: `/Users/marianzeis/.local/state/arc1-review/pr1142-public-generated-integration-final-20261103-094124`. Candidate `c59dd43f597dc99fcebfd52b48617e0b71e51740`, **4,848 bound files unchanged** at initial verification, after all checks, and after final source inspection. The corrected final verifier receipt is `final-verification-after-inspection.log`.

The shared preparation helper was copied outside the repository with only its final pointer-file destination changed from the primary checkout's cache to this author directory. It archived the clean commit, established independent local Git metadata, and supplied dependencies through the normal per-dependency links/copies. It did not install dependencies or copy an environment file. Snapshot sources were never edited. Build/test output was allowed only in scratch/output locations. The snapshot's bound initial author-report copy is the pre-check setup seed; this final report and `evidence.json` bind completed results separately.

One combined guarded full run passed: **569 test files, 17,000 tests, zero failures/skips** (Vitest JSON additionally counts 1,778 nested suites). There was no second full-suite run.

| Check | Result | Seconds |
| --- | --- | --- |
| `full-unit` | exit 0 | 101.623 |
| `tsc-src` | exit 0 | 0.439 |
| `tsc-scripts` | exit 0 | 0.478 |
| `tsc-tests` | exit 0 | 1.026 |
| `lint` | exit 0 | 0.41 |
| `policy` | exit 0 | 0.333 |
| `sizes` | exit 0 | 0.733 |
| `build` | exit 0 | 0.653 |
| `docs` | exit 0 | 1.51 |

All three TypeScript projects were checked. `check:sizes` covers both the file ratchet and MCP schema budgets. `docs:build` runs `mkdocs build --strict`. Lint passed with 14 informational diagnostics in inherited code, with no fixes applied. The strict docs build emitted the installed plugins' upstream MkDocs warning banners but completed successfully. Exact commands and full output are in `checks.json` and the matching logs.

The process and worker guards blocked environment-file reads and all non-loopback/unapproved socket connections; approved mapped-loopback test servers and TSX loader IPC remained available. Child test environments excluded SAP/test-SAP/BTP/CF/ARC1/VCAP configuration variables. There was no dotenv stub.

The full run recorded **14 blocked `.env` read attempts**, **four blocked `test.invalid` connection intents**, and **one blocked `login.microsoftonline.com` connection intent**. These are event counts, not sums of cumulative worker snapshots. Existing CLI imports call dotenv; the rate-limit tests deliberately allow downstream errors using the synthetic `test.invalid` client; the OIDC metadata suite configures a synthetic tenant issuer and tests a bogus bearer token's 401 metadata challenge. Those source paths explain the retained guard events; no successful remote exchange, secret access, native observation, or PP evidence is inferred from them. The guards threw before file contents or external sockets were accessed.

A final verifier command initially used the wrong parent-directory filename and returned Python Errno 2. That invocation did not run verification or alter the source. `final-verifier-invocation-error.log` retains the mistake; rerunning the actual `source/review-input/verify-snapshot.py` returned the final **4,848 unchanged** receipt. The earlier successful post-check verification is also retained.

## Remaining gates

Public capability preparation is not authorization to deploy or qualify unproven native variants. Remaining native/strict-PP acceptance, operation-specific gaps recorded in FEAT-93, generated-group cleanup/recording verification limits, and final whole-PR release review are unchanged. This integration neither treats generic GET 404 as absence nor claims generated-group/CTS cleanup from parent typed absence. Existing private/public boundaries and unsupported-variant refusals remain in effect.

Evidence: `integration-bindings.json`, `review-bindings.json`, `cherry-pick.log`, `integration-commit.log`, both immutable packets, and the hash ledger `evidence.json`. No primary or frozen-execution checkout action is needed to inspect this result.
