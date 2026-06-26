# Dependency Security — Tier 2: Supply-Chain Attestation

## Overview

This plan adds **supply-chain attestation** to ARC-1: machine-verifiable proof that an artifact (npm tarball or Docker image) was built from this repository, by this CI pipeline, at a specific commit. Tier 1 (`dependency-security-tier1-foundation.md`) closed the *what's in the artifact* question (no known vulnerabilities, no malicious deps in CI). Tier 2 closes the *what is the artifact* question — for enterprise customers running ARC-1 on regulated landscapes (banks, government, defense, pharma), procurement teams increasingly require SBOM + signature artifacts on every release. SAP partners and BTP enterprise customers specifically check for them during reviews.

The plan adds three release-time attestations:
1. **CycloneDX SBOM** — a complete inventory of every transitive dependency, generated per release and attached to both the GitHub Release and the Docker image (as an attestation).
2. **Cosign keyless image signing** — Sigstore OIDC-based signature on every published image tag, verifiable by `cosign verify` against the GitHub OIDC issuer. Customers running Kyverno / Gatekeeper / Connaisseur policies that require signed images can adopt ARC-1 without operational friction.
3. **OpenSSF Scorecard** — an automated security health score (branch protection, signed releases, dep review, etc.) with a public badge. Procurement teams sometimes consult Scorecard scores for OSS supply-chain risk assessment.

**npm provenance is already enabled** (`release.yml:66` — `npm publish --provenance --access public`). This plan documents the existing provenance and verifies it produces a valid Sigstore attestation, but does not change the publish flow.

Design decisions:
- **Keyless Cosign with GitHub OIDC.** No key management, no `COSIGN_KEY` secret to rotate. The signer identity is the GitHub Actions OIDC token; verifiers validate against `https://token.actions.githubusercontent.com` + the workflow path. This is the modern Sigstore default and the path SAP/BTP customers expect.
- **CycloneDX over SPDX.** Both are valid; CycloneDX is more JS-ecosystem-native (`npm sbom` outputs it natively in npm 10+), tooling is wider, and the OWASP-stewardship aligns with our security posture. Generate one SBOM for the npm package (from `package-lock.json`) and one for the image (from the layered filesystem via Anchore Syft).
- **Scorecard public.** Public score is a trust signal; gate-keeping it (private only) defeats the purpose. Risks of a low score are addressed by *raising the score*, not hiding it.
- **Attestations attached to the image, not just GitHub Releases.** `cosign attest` writes the SBOM as an OCI artifact alongside the image — `cosign download attestation` retrieves it without needing GitHub access. Customers running air-gapped registries can mirror image + attestation together.
- **Tier 1 is a hard prerequisite.** Without Tier 1's CodeQL workflow and the SECURITY.md policy, Scorecard scores poorly and signing only signs vulnerable images. Do not adopt Tier 2 first.

## Context

### Current State

- `.github/workflows/release.yml:66` runs `npm publish --provenance --access public`. npm provenance is **enabled** — every release tarball on npmjs.org carries a Sigstore-signed attestation pointing to this repo + commit + workflow. Verifiable via `npm audit signatures` after install.
- No SBOM is generated or attached to releases. `npm sbom` (npm 10+) is available locally but not invoked in CI.
- No Docker image signing. Images at `ghcr.io/arc-mcp/arc-1:<tag>` are published unsigned (the registry's transport-layer auth is the only attestation).
- No OpenSSF Scorecard workflow. No score is computed or published. No badge.
- The release workflow uses `npm publish --provenance --access public` with `permissions: id-token: write` (`release.yml:28-29`) — the OIDC plumbing for Sigstore is already configured. Cosign keyless signing reuses the same `id-token: write` permission.
- `release.yml:155-156` exports per-arch image digests as workflow artifacts before merging into a multi-arch manifest in `publish-docker-merge`. The merge step is `release.yml:168-205` — the right place to sign the *manifest* (which is what `:vX.Y.Z` and `:latest` tags resolve to), not the per-arch images.
- `Dockerfile` is a multi-stage Node 22 Alpine build. The image surface for SBOM purposes: `node:22-alpine` base + `apk add tini ca-certificates` + `node_modules` (post `npm prune --omit=dev`).
- `docs_page/security-guide.md` does not currently discuss provenance, signing, or SBOM.
- `README.md` has no provenance/signing badge.
- The roadmap last assigned ID is `SEC-11` (after Tier 1). This plan adds `SEC-12`.

### Target State

- Every release publishes:
  1. A CycloneDX SBOM (`arc-1-<version>-sbom.cdx.json`) attached to the GitHub Release.
  2. A second CycloneDX SBOM (`arc-1-<version>-image-sbom.cdx.json`) generated from the published image and attached as a Cosign attestation.
  3. A Cosign keyless signature on the multi-arch image manifest at `ghcr.io/arc-mcp/arc-1:<version>` and `:latest`, verifiable via `cosign verify --certificate-identity-regexp "https://github.com/arc-mcp/arc-1/.github/workflows/release.yml" --certificate-oidc-issuer "https://token.actions.githubusercontent.com" ghcr.io/arc-mcp/arc-1:<version>`.
- npm provenance remains enabled and is **documented** (`docs_page/security-guide.md`) with the verification command `npm audit signatures arc-1`.
- An OpenSSF Scorecard workflow runs weekly, publishes results to the Security tab, and updates a Scorecard badge in `README.md`. Target initial score: ≥ 7/10 (achievable with Tier 1 + Tier 2 together; Tier 1 alone scores around 5).
- `docs_page/security-guide.md` has a new section "Supply-Chain Attestation (Tier 2)" with verification commands. `docs_page/roadmap.md` adds `SEC-12` completed entry. `docs/compare/00-feature-matrix.md` extends the Tier 1 supply-chain subsection with attestation rows. `README.md` adds the Scorecard badge. `CLAUDE.md` Key Files table lists the new workflow steps.

### Key Files

| File | Role |
|------|------|
| `.github/workflows/release.yml` | Add SBOM generation + Cosign signing + image attestation steps |
| `.github/workflows/scorecard.yml` | NEW — OpenSSF Scorecard analysis |
| `docs_page/security-guide.md` | New "Supply-Chain Attestation" section |
| `docs_page/roadmap.md` | New `SEC-12` completed entry |
| `docs/compare/00-feature-matrix.md` | New attestation rows in §4.1 |
| `README.md` | Add OpenSSF Scorecard badge |
| `CLAUDE.md` | Add new workflow steps to Key Files table |

### Design Principles

1. **Verification = single command.** Operators must be able to verify provenance, SBOM, and signature with three commands they can pipe into their build system. If verification needs a 50-line script, no one runs it.
2. **Image-attached attestations.** SBOM and provenance live alongside the image in OCI registry, not just on GitHub Releases. Air-gapped customers mirror once.
3. **Reuse existing OIDC plumbing.** The release workflow already has `id-token: write` for npm provenance. Cosign keyless and SBOM attestations consume the same OIDC token. No new secrets.
4. **Public Scorecard.** Score is a trust signal; hiding it defeats the purpose. If the score drops, fix the controls, don't suppress the badge.
5. **Failures gate, but don't break debugging.** Sigstore/Rekor occasional outages happen. The release job tolerates a Sigstore *availability* failure (graceful degradation: ship the image without signature, alert the maintainer) but never tolerates a *verification* failure (signing succeeded but verification fails — bug, hard fail).

## Development Approach

This plan only touches release-time workflows; no source code changes. Per-task validation: push the branch, manually trigger `release.yml` via `workflow_dispatch` (which has to be added if not present, but only as a debug aid — remove before merge if not needed). Test signature verification end-to-end against the published `:latest` from the test trigger. The OpenSSF Scorecard workflow runs on a schedule and on push to `main`; verify by triggering manually.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `cosign version` (must be available locally for verification testing)
- `syft version` (must be available locally for SBOM verification testing)

### Task 1: Add CycloneDX SBOM Generation to Release

**Files:**
- Modify: `.github/workflows/release.yml`

Generate two SBOMs per release: one for the npm tarball (built from `package-lock.json` via `npm sbom`) and one for the image (built from the layered filesystem via `anchore/syft-action`). Attach the npm SBOM to the GitHub Release as an asset. Attach the image SBOM as an OCI attestation in Task 3 (after Cosign is configured).

- [ ] In `.github/workflows/release.yml`, locate the `publish-npm` job (line 23-66). After the `Build` step (line 62-63) and before `Publish to npm` (line 65-66), add a step `Generate npm package SBOM (CycloneDX)`:
  - Run: `npm sbom --sbom-format=cyclonedx --sbom-set-version=$(jq -r .version package.json) > arc-1-${{ needs.release-please.outputs.tag_name }}-sbom.cdx.json` (the `$(jq …)` substitution captures the version that release-please bumped). On older npm: `npm sbom --sbom-format=cyclonedx > sbom.json` then rename — npm 11+ (already required for trusted publishing per `release.yml:40-44`) supports `--sbom-set-version`.
  - Verify it's valid JSON: `jq -e . arc-1-*-sbom.cdx.json > /dev/null`.
  - Capture the file path as a step output so the next step can attach it to the release.
- [ ] After `Publish to npm`, add a step `Attach SBOM to GitHub Release`:
  - Use `softprops/action-gh-release@<commit-SHA>` (third-party — pin to SHA per Tier 1 design principle 3).
  - Inputs: `tag_name: ${{ needs.release-please.outputs.tag_name }}`, `files: arc-1-*-sbom.cdx.json`, `fail_on_unmatched_files: true`.
  - The `release-please` action created the release earlier in the workflow; this step adds an asset to the existing release rather than creating a new one.
- [ ] In the `publish-docker-merge` job (line 168-205), after the `Create manifest list and push` step (line 199-205), add a step `Generate image SBOM (CycloneDX)` using `anchore/sbom-action@<commit-SHA>`:
  - Inputs: `image: ghcr.io/arc-mcp/arc-1:${{ needs.release-please.outputs.tag_name }}`, `format: cyclonedx-json`, `output-file: arc-1-${{ needs.release-please.outputs.tag_name }}-image-sbom.cdx.json`, `upload-artifact: false` (uploaded as a release asset in the next step).
- [ ] Add another step `Attach image SBOM to GitHub Release`:
  - `softprops/action-gh-release@<commit-SHA>` again, `files: arc-1-*-image-sbom.cdx.json`.
- [ ] Validate YAML.
- [ ] Push the branch. To exercise the release path before merge: temporarily add `workflow_dispatch:` to the workflow's `on:` triggers, manually run, and verify both SBOM files exist as release assets. Remove the `workflow_dispatch:` before merge unless retaining for debug (note in PR if retaining).
- [ ] Run `npm test` — all tests must pass.

### Task 2: Add Cosign Keyless Image Signing

**Files:**
- Modify: `.github/workflows/release.yml`

Sign the multi-arch manifest in the `publish-docker-merge` job using `cosign sign --yes` with keyless OIDC. The signer identity becomes `https://github.com/arc-mcp/arc-1/.github/workflows/release.yml@<ref>` issued by `https://token.actions.githubusercontent.com`. Verifiers (Kyverno, Gatekeeper, Connaisseur, manual `cosign verify`) check both the issuer URL and the workflow path — pinning verification to *this* repo's *this* workflow.

- [ ] In `.github/workflows/release.yml`, in the `publish-docker-merge` job, ensure `permissions:` includes `id-token: write` (already present? confirm — if not, add). Currently the job has `contents: read, packages: write`; add `id-token: write` if missing.
- [ ] After `Create manifest list and push` (line 199-205) and after the SBOM steps from Task 1, add a step `Install Cosign`:
  - Use `sigstore/cosign-installer@<commit-SHA>` with `cosign-release: 'v2.4.0'` (pin to a known version; bump via Dependabot's `github-actions` group).
- [ ] Add a step `Sign image with Cosign (keyless)`:
  - Run: `cosign sign --yes ghcr.io/arc-mcp/arc-1@${digest}` for each tag — but the cleanest approach is signing by digest (immutable). Get the merged manifest digest from the `imagetools create` output: capture stdout into `MANIFEST_DIGEST`, then `cosign sign --yes ghcr.io/arc-mcp/arc-1@${MANIFEST_DIGEST}`.
  - Alternative (simpler, sufficient): sign by tag — `for tag in latest ${VERSION} ${MAJOR_MINOR}; do cosign sign --yes ghcr.io/arc-mcp/arc-1:$tag; done`. Tag-based signing works because Cosign records the digest at sign-time; verifiers resolve `:tag` to digest before checking the signature. Use this approach unless there's a specific reason for digest-only.
  - Environment: `COSIGN_EXPERIMENTAL: '1'` is no longer needed for v2+; omit it.
- [ ] Add a step `Verify Cosign signature (sanity check)`:
  - `cosign verify ghcr.io/arc-mcp/arc-1:${{ needs.release-please.outputs.tag_name }} --certificate-identity-regexp "https://github.com/arc-mcp/arc-1/.github/workflows/release.yml" --certificate-oidc-issuer "https://token.actions.githubusercontent.com"`.
  - This step **must** succeed; if it fails, the release fails. Do NOT use `continue-on-error: true` here — a verification failure means signing didn't actually work.
- [ ] Validate YAML.
- [ ] Test end-to-end on a feature branch via a `workflow_dispatch` trigger (or wait for the next release-please PR to fire it naturally). After a successful signed release, run from a workstation: `cosign verify ghcr.io/arc-mcp/arc-1:<test-tag> --certificate-identity-regexp "https://github.com/arc-mcp/arc-1/.github/workflows/release.yml" --certificate-oidc-issuer "https://token.actions.githubusercontent.com"` — must print the certificate details and exit 0.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Attach Image SBOM as Cosign Attestation

**Files:**
- Modify: `.github/workflows/release.yml`

The image SBOM generated in Task 1 currently lives only on the GitHub Release. Attach it to the image as an OCI attestation so customers pulling from `ghcr.io` can fetch the SBOM with `cosign download attestation` without GitHub access. Use `cosign attest` with `--predicate <sbom-file>` and `--type cyclonedx`.

- [ ] In `release.yml` `publish-docker-merge` job, after the Cosign signature step (Task 2) and after the image SBOM generation step (Task 1), add a step `Attach SBOM as Cosign attestation`:
  - Run: `cosign attest --yes --type cyclonedx --predicate arc-1-${{ needs.release-please.outputs.tag_name }}-image-sbom.cdx.json ghcr.io/arc-mcp/arc-1:${{ needs.release-please.outputs.tag_name }}`.
  - Optionally repeat for `:latest` and `:major.minor` tags so all three resolve to a tagged-but-attested image.
- [ ] Add a step `Verify SBOM attestation (sanity check)`:
  - `cosign verify-attestation --type cyclonedx ghcr.io/arc-mcp/arc-1:${{ needs.release-please.outputs.tag_name }} --certificate-identity-regexp "https://github.com/arc-mcp/arc-1/.github/workflows/release.yml" --certificate-oidc-issuer "https://token.actions.githubusercontent.com"`.
  - Must succeed — same fail-loud rule as Task 2.
- [ ] Document the verification flow in this task's notes (carries forward to docs in Task 5):
  - `cosign download attestation ghcr.io/arc-mcp/arc-1:<version> | jq '.payload | @base64d | fromjson | .predicate' > sbom.json` extracts the SBOM into a usable file.
- [ ] Validate YAML.
- [ ] Test end-to-end via the same `workflow_dispatch` path used in Task 2.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Add OpenSSF Scorecard Workflow

**Files:**
- Create: `.github/workflows/scorecard.yml`

OpenSSF Scorecard is an automated security health check (18 checks: branch protection, signed releases, dep review, code review, fuzzing, etc.) that runs against any public GitHub repo. Tier 1 + Tier 2 together should produce a score ≥ 7/10. The badge in README.md becomes a public trust signal. The workflow uploads SARIF to the Security tab so individual check failures become actionable issues.

- [ ] Create `.github/workflows/scorecard.yml` with `name: OpenSSF Scorecard`, triggers `on: branch_protection_rule:`, `schedule: - cron: '17 4 * * 1'` (Mondays 04:17 UTC — different minute from CodeQL to spread load), `push: branches: [main]`, `workflow_dispatch:`.
- [ ] Job `analysis` on `ubuntu-latest`, `permissions: security-events: write, id-token: write, contents: read, actions: read`.
- [ ] Steps:
  - `actions/checkout@v6` with `persist-credentials: false` (Scorecard convention — prevents the default `GITHUB_TOKEN` from leaking into checks).
  - `ossf/scorecard-action@<commit-SHA>` (third-party — pin to SHA). Inputs: `results_file: results.sarif`, `results_format: sarif`, `publish_results: true` (publishes to the OpenSSF Scorecard public dashboard so the badge resolves).
  - `actions/upload-artifact@v7` with `name: SARIF file`, `path: results.sarif`, `retention-days: 5`.
  - `github/codeql-action/upload-sarif@v4` with `sarif_file: results.sarif`.
- [ ] Note: `publish_results: true` requires the `id-token: write` permission and submits results to `https://api.securityscorecards.dev/`. Once published, the badge URL `https://api.securityscorecards.dev/projects/github.com/arc-mcp/arc-1/badge` resolves to the score.
- [ ] Validate YAML.
- [ ] Push the branch. Trigger the workflow via `workflow_dispatch` and verify:
  - It runs successfully.
  - The Security tab shows Scorecard findings (each check that failed becomes a finding).
  - After ~5 minutes, the badge URL above resolves to a JSON badge response (it takes a few minutes for the OpenSSF dashboard to ingest).
- [ ] Run `npm test` — all tests must pass.

### Task 5: Update Documentation

**Files:**
- Modify: `docs_page/security-guide.md`
- Modify: `README.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Operators need a single page that shows verification commands for npm provenance, image signature, image SBOM, and the Scorecard score. Without docs, the controls exist but no one knows how to use them.

- [ ] In `docs_page/security-guide.md`, add a new section **`## 14. Supply-Chain Attestation`** (after the §13 "Dependency & Supply-Chain Security" added in Tier 1). Subsections:
  - `### 14.1 npm package provenance` — explain npm provenance; verification command: `npm audit signatures arc-1` (after `npm install arc-1`). Reference the Sigstore docs.
  - `### 14.2 Container image signature` — verification command:
    ```bash
    cosign verify ghcr.io/arc-mcp/arc-1:<version> \
      --certificate-identity-regexp "https://github.com/arc-mcp/arc-1/.github/workflows/release.yml" \
      --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
    ```
    Document Kyverno / Gatekeeper / Connaisseur policy snippets that pin to this identity for customers running admission-controlled clusters.
  - `### 14.3 Software Bill of Materials (SBOM)` — both SBOMs (npm and image), where to find them (GitHub Release assets + image attestation), and verification:
    ```bash
    # GitHub Release asset
    gh release download v<version> --pattern '*-sbom.cdx.json'

    # Image attestation
    cosign download attestation ghcr.io/arc-mcp/arc-1:<version> \
      | jq '.payload | @base64d | fromjson | .predicate'
    ```
  - `### 14.4 OpenSSF Scorecard` — what the score measures, where the dashboard is (`https://scorecard.dev/viewer/?uri=github.com/arc-mcp/arc-1`), and how to interpret a low score.
- [ ] In `README.md`:
  - Add the Scorecard badge in the badges block:
    ```
    [![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/arc-mcp/arc-1/badge)](https://scorecard.dev/viewer/?uri=github.com/arc-mcp/arc-1)
    ```
  - Update the existing "Supply-chain security" bullet (added in Tier 1) to read: "Dependabot, npm audit, Dependency Review, CodeQL, Trivy, **Cosign keyless image signing, CycloneDX SBOM, npm provenance, OpenSSF Scorecard**. See [security guide §13–14](docs_page/security-guide.md#13-dependency--supply-chain-security)."
- [ ] In `docs_page/roadmap.md`:
  - In the "Overview: Completed" table, add a new row: `| [SEC-12](#sec-12) | Supply-Chain Attestation (CycloneDX SBOM, Cosign keyless image signing, image SBOM attestation, OpenSSF Scorecard, npm provenance documented) | <today's YYYY-MM-DD> | Security |`.
  - In the "Details: Completed" section, add a new `<a id="sec-12"></a>` block: status, summary, the four sub-deliverables (SBOM, signing, Scorecard, provenance docs), and verification commands.
  - Update "Last Updated" at the top.
- [ ] In `docs/compare/00-feature-matrix.md`:
  - Extend §4.1 "Supply-Chain Security" (added in Tier 1) with new rows: npm provenance, CycloneDX SBOM, Cosign image signing, OpenSSF Scorecard. Score ARC-1 ✅; competitors based on their actual `release.yml` (most score ❌).
  - Update "_Last updated:_".
- [ ] In `CLAUDE.md`, in the "Key Files for Common Tasks" table, add:
  - `| Add/modify image signing or SBOM attestation | \`.github/workflows/release.yml\` (Cosign + sbom-action steps) |`
  - `| Add/modify OpenSSF Scorecard checks | \`.github/workflows/scorecard.yml\` |`
- [ ] Run `npm run lint` and `npm test` to confirm doc changes don't break anything.

### Task 6: Final Verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Confirm the next release (or the `workflow_dispatch` test trigger) produces:
  - A GitHub Release with both `arc-1-<version>-sbom.cdx.json` and `arc-1-<version>-image-sbom.cdx.json` as assets.
  - A signed image at `ghcr.io/arc-mcp/arc-1:<version>` — verify locally:
    ```
    cosign verify ghcr.io/arc-mcp/arc-1:<version> \
      --certificate-identity-regexp "https://github.com/arc-mcp/arc-1/.github/workflows/release.yml" \
      --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
    ```
  - An SBOM attestation on the same image — verify locally:
    ```
    cosign verify-attestation --type cyclonedx ghcr.io/arc-mcp/arc-1:<version> \
      --certificate-identity-regexp "https://github.com/arc-mcp/arc-1/.github/workflows/release.yml" \
      --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
    ```
  - npm provenance verifies via `npm install arc-1@<version> && npm audit signatures arc-1`.
- [ ] Confirm the OpenSSF Scorecard badge in README.md resolves to a score image (not a "not found" placeholder).
- [ ] Confirm the Scorecard public dashboard shows the project: `https://scorecard.dev/viewer/?uri=github.com/arc-mcp/arc-1`.
- [ ] Confirm `docs_page/security-guide.md` §14 renders correctly via `mkdocs build`.
- [ ] Move this plan to `docs/plans/completed/dependency-security-tier2-attestation.md`.
