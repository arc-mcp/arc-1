# Dependency & Release Security

ARC-1's dependency evidence covers both direct and transitive packages, but the inventory and
checks differ between npm, Docker, BTP builds, and MCP bundles. Use the evidence for the artifact
you actually deploy.

**Evidence reviewed: 7 September 2026.** Repository baseline:
[`38910bb`](https://github.com/arc-mcp/arc-1/tree/38910bbf0cea9027cbe6e69fc2749820cd9c2993).
Latest release observed during that review: [v1.2.0](https://github.com/arc-mcp/arc-1/releases/tag/v1.2.0).
This is a dated control inventory, not a current vulnerability clearance.

!!! tip "For enterprise deployment"

    For BTP deployments from a cloned repository, approve an exact source commit, retain the
    lockfiles, and record both build and staging evidence. Start with
    [BTP builds from source](#btp-builds-from-source) below. For Docker deployments, approve the
    image digest. A registry install of only `arc-1@1.2.0` is a separate case and does **not**
    pin the entire npm dependency graph.

## BTP builds from source

The [BTP deployment runbook](btp-cloud-foundry-deployment.md#4-create-the-landscape-extension)
already starts with a reviewed tag or commit and `npm ci`. A clone contains the repository's
lockfile, so the downstream npm-package limitation below does not apply to that build in the
same way.

There are two stages to assess. The repository's `mta.yaml` runs `npm ci` and `npm run build`
before packaging, but excludes `node_modules` from the server module archive. The deployed
module retains the package manifests/lockfile and selects `nodejs_buildpack`. Cloud Foundry
therefore needs to install the missing dependencies during staging. Its buildpack and selected
Node/npm versions are additional inputs; a successful local build is not an inventory of the
final running application. See the [MTA descriptor](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/mta.yaml)
and [Cloud Foundry Node.js buildpack documentation](https://docs.cloudfoundry.org/buildpacks/node/).

| Review point | Evidence to retain in the customer's build/deployment process |
|---|---|
| Approved source | Full commit SHA, release tag when applicable, and any customer patch/diff. Do not use an unrecorded moving `main` checkout. |
| Build dependencies | Root lockfile and optional AppRouter lockfile, dependency checks including build tools, Node/npm and MTA build-tool versions, and approved registry configuration. |
| Application inventory | Root production npm SBOM plus a separate AppRouter inventory when enabled. Keep build-only dependencies distinguishable from deployed ones. |
| Deployment archive | MTAR checksum, build result and source identity; retain the customer's separately reviewed deployment extension through its protected configuration process. |
| CF staging | Selected buildpack, stack, Node/npm versions, dependency-install result and staged application/deployment identity. Collect the actual installed inventory where the customer's platform permits; label lockfile-only evidence accordingly. |
| Ongoing maintenance | Reassess dependencies at the approved source revision as advisories change. Repeat relevant validation after source changes, dependency updates, or restaging with updated runtime/buildpack inputs. |

This is evidence guidance, not an additional deployment procedure. Follow the canonical runbook
for commands and topology. No automatic BTP evidence exporter or cryptographic attestation is
claimed here. Keep bindings, credentials, tokens and unredacted staging logs out of public evidence.

## Artifact coverage

| Artifact | Available evidence | Scope and limitation |
|---|---|---|
| npm package | npm provenance; `arc-1-<version>-sbom.cdx.json` on GitHub Releases, best-effort | SBOM comes from the release tag's root production lockfile. It is a reference inventory; a fresh npm install can resolve a different dependency tree. |
| Docker image | BuildKit provenance metadata; Trivy release scan per `linux/amd64` and `linux/arm64` | Release scanning is advisory. A dedicated image SBOM and Cosign signing step are not implemented in the reviewed workflow. Build metadata alone is not a verified publisher signature. |
| BTP Cloud Foundry deployment | Source manifests/lockfiles and customer build/deployment records | Inventory the built application, selected buildpack/runtime, and optional `btp/approuter` independently. The root npm SBOM excludes the AppRouter's separate tree. |
| MCPB bundle | Versioned `.mcpb` release asset; assembled-bundle startup check | Assembly removes native `better-sqlite3`. The root npm SBOM therefore does not describe the bundle exactly; no bundle-specific SBOM is published by the reviewed workflow. |
| Custom extensions | Customer-controlled local code and dependencies | Loaded into the server process and outside the core release inventory. Review and inventory each extension separately; see [Extensions](extensions.md). |

The [v1.2.0 release](https://github.com/arc-mcp/arc-1/releases/tag/v1.2.0) contains both the npm
CycloneDX SBOM and MCPB asset. Their presence was checked through GitHub's release API.
The npm registry advertises provenance for `arc-1@1.2.0`; its tarball contains neither
`package-lock.json` nor `npm-shrinkwrap.json`. This review checked metadata and archive contents,
not an end-to-end cryptographic verification of all published artifacts.

### Why an exact npm version is not enough

The published package declares dependency ranges. npm does not publish `package-lock.json`, so
downstream installations resolve those ranges using their own dependency state. The producer's
SBOM can consequently differ from a later `npm install arc-1@1.2.0` or `npx arc-1@1.2.0` tree.
See npm's [lockfile behavior](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).

For a reproducible deployment, retain a reviewed application lockfile and use `npm ci`, or use
the exact approved image digest. Keep the runtime version, platform, build inputs and installation
policy with the evidence. A publishable shrinkwrap is a possible future packaging change, not a
current ARC-1 guarantee. Reproducibility still requires an update process when dependencies need fixes.

## Controls and evidence

Links below point to the reviewed source revision so the claims remain inspectable.

| Control | Observed behavior | Evidence |
|---|---|---|
| Dependency updates | Weekly version-update configuration for root npm, AppRouter npm, GitHub Actions, and Docker. Security updates are enabled separately. No same-day remediation guarantee. | [Dependabot configuration](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/.github/dependabot.yml) |
| Known npm vulnerabilities | Root and AppRouter `npm audit --audit-level=high --omit=optional` checks fail on high/critical findings. Includes development dependencies; optional dependencies are omitted. | [Test workflow](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/.github/workflows/test.yml) |
| Dependency changes and licenses | Dependency Review fails its check on high/critical advisories and configured license denials. A version-specific `node-forge` license exception is documented. | [Dependency Review workflow](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/.github/workflows/dependency-review.yml) |
| Static analysis | GitHub CodeQL default setup configured; weekly schedule reported by the API | [Code scanning](https://github.com/arc-mcp/arc-1/security/code-scanning) |
| Container vulnerabilities | Trivy scans release images by digest/platform and reports findings without blocking publication | [Release workflow](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/.github/workflows/release.yml) |
| Scheduled container maintenance | Mon/Wed/Fri job builds fresh images for both architectures and fails on high/critical findings | [Scheduled workflow](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/.github/workflows/security-scan.yml). This checks a new build, not an already-deployed release digest. |
| Build dependencies | Docker/release-please/Trivy actions use full commit SHAs; several GitHub-owned actions still use version tags. Jobs declare publishing permissions where needed. | [Release workflow](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/.github/workflows/release.yml) |
| npm publishing | OIDC trusted publishing and `npm publish --provenance`; production SBOM generated separately from the release tag | [Release workflow](https://github.com/arc-mcp/arc-1/blob/38910bbf0cea9027cbe6e69fc2749820cd9c2993/.github/workflows/release.yml) |
| Secrets and vulnerability reports | Dependabot alerts/security updates, secret scanning, push protection, and private vulnerability reporting were confirmed enabled on the review date | [Repository security](https://github.com/arc-mcp/arc-1/security), [reporting policy](https://github.com/arc-mcp/arc-1/blob/main/SECURITY.md) |

!!! warning "A failing check and an enforced merge gate are different"

    On 7 September 2026, GitHub's effective rules API for `main` reported pull-request,
    deletion, and non-fast-forward rules, but no required-status-check or code-scanning rule.
    Treat the checks above as detection controls until required-check enforcement is verified.
    CodeQL being enabled does not by itself mean a high finding blocks a merge.

The snapshot can be rechecked by an authorized repository administrator:

```bash
gh api repos/arc-mcp/arc-1/rules/branches/main \
  --jq '.[] | {type, parameters}'
gh api repos/arc-mcp/arc-1/code-scanning/default-setup
gh api repos/arc-mcp/arc-1 --jq '.security_and_analysis'
gh api repos/arc-mcp/arc-1/private-vulnerability-reporting
```

Settings and check results change independently of these docs. A successful scan means the
configured scanner completed within its coverage at that time; it does not establish absence of
unknown vulnerabilities or malicious dependencies. License denials are an automated review
filter, not a complete license-compliance opinion.

### Container maintenance and release completeness

CI sets `pull: true` and bypasses the Dockerfile's `runtime` stage cache so `apk upgrade` can
pick up current Alpine fixes. A refreshed build does not repair an existing image digest:
operators need a new approved artifact and a deployment update.

The npm SBOM job is deliberately non-gating. A missing asset does not mean npm publication
failed; inspect `publish-npm-sbom` and the actual release assets. If your approval requires an
SBOM, treat it as missing evidence until provided. Release scans and SARIF uploads are also
non-gating, so publication alone is not a security approval signal.

## Verify before deployment

Use an isolated review environment without SAP credentials. The examples require installed
`npm`, `gh`, `jq`, and/or `trivy`; replace the version or digest with the artifact under review.

### npm installation and its actual dependency tree

```bash
# In a new, empty review directory; 1.2.0 is an example reviewed release.
npm init -y
VERSION=1.2.0
npm install --ignore-scripts --save-exact "arc-1@${VERSION}"
npm audit signatures
npm audit --audit-level=high
npm sbom --omit=dev --sbom-format=cyclonedx > installed-sbom.cdx.json
```

`--ignore-scripts` avoids lifecycle-script execution during this inventory step. It does not
produce a fully operational installation: native `better-sqlite3` needs an approved build step.
Retain and review the resulting lockfile before building/running with the customer's installation
policy. `npm audit` sends dependency metadata to the configured registry; use an approved
registry or scanning process where that matters.

`npm audit signatures` verifies available registry signatures and provenance attestations for
the installed tree. Inspect its output, including coverage and failures, and check the expected
repository/workflow for the ARC-1 provenance. It does not promise provenance for every dependency
or prove the code is benign. See [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/)
and [provenance limitations](https://docs.npmjs.com/generating-provenance-statements/).

### Download the producer's reference SBOM

```bash
VERSION=1.2.0
gh release download "v${VERSION}" --repo arc-mcp/arc-1 \
  --pattern "arc-1-${VERSION}-sbom.cdx.json"
jq -e --arg version "$VERSION" '
  .bomFormat == "CycloneDX" and
  .metadata.component.name == "arc-1" and
  .metadata.component.version == $version and
  .metadata.component.type == "application"
' "arc-1-${VERSION}-sbom.cdx.json"
```

This checks the document's identity fields, not its authenticity or completeness. Compare
against the installed inventory and keep the release asset digest from GitHub with your review.
Checksums alone are not publisher authentication.

### Scan the approved Docker digest

Resolve the release tag in your approved registry, record its digest and target architecture,
and use that immutable reference for scanning and deployment:

```bash
IMAGE='ghcr.io/arc-mcp/arc-1@sha256:REPLACE_WITH_APPROVED_DIGEST'
TRIVY_PLATFORM=linux/amd64 trivy image \
  --severity HIGH,CRITICAL --exit-code 1 "$IMAGE"
```

Use `linux/arm64` when that is the deployment platform; evaluate both if approving the
multi-platform image. Record the scanner version, database timestamp, image digest/platform,
findings, and any approved exceptions. Rescan retained digests as advisories change.
BuildKit's [default provenance behavior](https://docs.docker.com/build/ci/github-actions/attestations/)
must not be confused with an implemented Cosign signature-verification policy.

## Next improvements under evaluation

Enforcing security checks on pull requests, improving evidence for BTP builds from source,
and adding malicious-package review are the current priorities. Scanning retained Docker
release digests and providing image/MCPB-specific inventories are secondary improvements for
those distribution paths. These are proposals, not completed controls. The maintainer's
[enterprise acceptance research](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-09-07-enterprise-security-acceptance.md)
records costs, tradeoffs, and implementation order.

For deployment controls, continue with [Security & Trust](security.md) and the
[Hardening Guide](security-guide.md). Report vulnerabilities through
[SECURITY.md](https://github.com/arc-mcp/arc-1/blob/main/SECURITY.md).
