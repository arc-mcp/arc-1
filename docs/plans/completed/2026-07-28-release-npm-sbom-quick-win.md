# Release npm SBOM Quick Win

**Status:** Implemented and validated
**Scope:** GitHub release asset for the production npm dependency graph
**Target:** The next release (expected `1.0.0`) and every later release

## Objective

Attempt to publish `arc-1-<version>-sbom.cdx.json` on every GitHub Release. When produced, the
document must be a valid CycloneDX application SBOM derived from the release commit's
`package-lock.json`, contain only the npm production dependency tree, and match the release tag
exactly. SBOM generation and upload are best-effort and must never fail the artifact release.

This is deliberately smaller than the remaining Tier 2 attestation plan. It does **not** claim to
inventory Alpine packages in the Docker image, the assembled MCPB contents, or dynamically loaded
extensions.

## Research and pre-implementation evidence

- `origin/main` at research time was `8103452f17d19fe680ea930aa3494f7be68632d1`; the worktree was
  clean and detached at the same commit before the feature branch was created.
- Release Please exposes root-component `release_created`, `tag_name`, and `version` outputs. The
  workflow already forwards the first two; this change also forwards `version` so filenames and
  metadata never depend on ad-hoc tag parsing.
- The release workflow pins Node 22 and npm `11.11.1`. That exact npm version documents and accepts
  `--package-lock-only`, `--omit=dev`, `--sbom-format=cyclonedx`, and
  `--sbom-type=application`. The older Tier 2 plan's proposed `--sbom-set-version` option is not
  part of npm 11's documented command surface and must not be used.
- The exact command generated a 130 KB CycloneDX 1.5 document with 153 components from the current
  lockfile. Selected development-only packages (`vitest`, `typescript`, and `@biomejs/biome`) were
  absent, and every dependency reference resolved to a component.
- A temporary copy of `package.json` and `package-lock.json` was advanced to `1.0.0` with scripts
  disabled. npm `11.11.1` generated an `arc-1@1.0.0` application SBOM successfully without a
  `node_modules` directory. CycloneDX CLI `0.32.0` validated both the current and simulated 1.0.0
  files against CycloneDX 1.5.
- GitHub's `gh release upload --clobber` deletes the old asset before uploading its replacement. It
  is therefore unsuitable for failure recovery. GitHub release assets expose a SHA-256 digest,
  which permits safe idempotency without deletion.
- The pending 1.0 preparation is tracked separately in PR #610. The SBOM implementation must remain
  version-agnostic and must not edit package versions or Release Please policy.

## Reviewed design

1. Add a dedicated `publish-npm-sbom` job after `publish-npm` succeeds.
   - This keeps `contents: write` out of the npm OIDC publishing job.
   - The job is independently rerunnable if GitHub asset upload has a transient failure.
   - No `npm ci` is needed: `--package-lock-only` intentionally ignores `node_modules`.
   - Job-level `continue-on-error: true` keeps all SBOM failures non-gating for the release.
2. Check out the immutable release tag, not an implicit moving branch, and disable persisted Git
   credentials so the job's write token exists only in the upload step environment.
3. Install the same pinned npm `11.11.1` used by package publication.
4. Refuse version drift before generation: Release Please's `version` output, `package.json`, and
   the root `package-lock.json` entry must agree.
5. Generate one production application SBOM with the exact tested flags. Validate its JSON shape,
   root name, root version, application type, and non-empty component/dependency arrays with `jq`
   before any upload.
6. Upload with the runner-provided `gh` CLI and a job-scoped `contents: write` token. Do not use a
   new third-party release action.
7. Make upload retries non-destructive:
   - skip an existing asset only when GitHub's digest equals the local SHA-256;
   - fail on a conflicting same-name asset;
   - retry a missing asset up to three times;
   - never use `--clobber`.
8. Add a unit-level workflow contract test so accidental permission, ordering, flag, validation,
   tag-checkout, or destructive-upload regressions fail before release day.
9. Document the release asset, verification command, and its npm-only scope. Reconcile the broader
   Tier 2 plan so it no longer says ARC-1 publishes no SBOM.

## Rejected alternatives

- **Generate inside `publish-npm`:** fewer lines, but unnecessarily combines `contents: write` with
  npm's OIDC token and makes an upload-only retry repeat package-publishing work.
- **Generate in `build-mcpb`:** reuses an existing write token but incorrectly couples npm metadata
  to MCPB assembly and withholds the SBOM when an unrelated MCPB step fails.
- **Use `softprops/action-gh-release`:** adds a third-party action and another pinned dependency when
  `gh` is already installed on GitHub-hosted runners and already used by this workflow.
- **Use `--clobber`:** can destroy a valid asset before a failed retry completes.
- **Add image or MCPB contents now:** materially expands scope and failure modes immediately before
  1.0. Those need artifact-specific generation and attestation, as retained in the Tier 2 plan.

## Implementation checklist

- [x] Add Release Please's `version` output and the isolated `publish-npm-sbom` job.
- [x] Add deterministic generation, fail-fast validation, and digest-safe upload retries.
- [x] Add the release workflow contract test.
- [x] Update operator/security documentation and the broader Tier 2 plan.
- [x] Run focused tests, workflow lint, repository lint/typecheck/build, and the full unit suite.
- [x] Re-run the exact npm 11.11.1 generation and official CycloneDX validation after implementation.
- [x] Review the final diff for scope, permissions, release ordering, and version independence.

## Acceptance criteria

- A release tagged `v1.0.0` produces `arc-1-1.0.0-sbom.cdx.json` with root component
  `arc-1@1.0.0` and type `application`.
- The SBOM job starts only after npm publication succeeds and has only `contents: write` permission.
- A malformed, empty, wrong-name, or wrong-version SBOM fails before upload.
- A transient upload failure retries without deleting an existing asset; a conflicting asset fails
  loudly inside the non-gating SBOM job.
- Any SBOM job failure leaves the overall release workflow able to succeed.
- No package version is hardcoded in the workflow.
- Documentation explicitly limits this SBOM to the production npm dependency graph.

## Validation record

- `actionlint v1.7.12 .github/workflows/release.yml` — passed.
- `npx vitest run tests/unit/server/release-sbom-workflow.test.ts` — 3/3 passed.
- Mocked upload execution — existing matching asset, clean upload, accepted-upload/lost-response,
  and conflicting-asset paths behaved as designed.
- Extracted the generation shell directly from the parsed workflow and ran it with npm `11.11.1`
  against a temporary `arc-1@1.0.0` package/lock pair with no `node_modules`. It produced
  CycloneDX 1.5, 153 components, 154 dependency entries, root `arc-1@1.0.0`, application type, and
  a SHA-256 step output.
- CycloneDX CLI `0.32.0 validate --input-version v1_5 --fail-on-errors` — passed for that file.
- `npm run lint` — passed (existing Biome configuration deprecation notice only).
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm run check:sizes` — passed.
- `npm test` — 162 files and 4,653 tests passed.
- `npm run docs:build` — passed in strict mode (upstream MkDocs 2 migration warning only).

A live upload was intentionally not performed during development because that would require
creating or modifying a real release. The upload logic was tested with controlled `gh` responses;
the next actual release is the end-to-end execution point.
