# Dependency Security — Tier 1: Foundation

## Overview

This plan establishes the baseline supply-chain security controls for ARC-1, an MCP server distributed as both an npm package (`arc-1`) and a Docker image (`ghcr.io/marianfoo/arc-1`) and deployed by enterprises onto BTP Cloud Foundry and on-premise servers. ARC-1 currently has **no Dependabot, no automated dependency updates, no `npm audit` gate in CI, no Software-Composition-Analysis (SCA), no CodeQL/SAST, and no container scanning**, while `npm audit` reports **9 open vulnerabilities (2 high, 7 moderate)** across `path-to-regexp`, `axios` (transitive), `@hono/node-server` (transitive), `hono`, `ip-address`, `express-rate-limit`, and `postcss`. Customers running ARC-1 on regulated landscapes (finance, government, defense) will run their own image scanners (Aqua, Prisma Cloud, Microsoft Defender) against `ghcr.io/marianfoo/arc-1` and reject vulnerable images.

The plan adds five GitHub-native, free-for-public-repo controls — Dependabot (npm + GitHub Actions + Docker), `npm audit` PR gate, GitHub Dependency Review Action, CodeQL SAST, and Trivy container scanning — clears the existing vulnerabilities, hardens third-party action references against supply-chain compromise (tj-actions/changed-files class attacks), and publishes a `SECURITY.md` policy. The result: every PR is checked for new vulnerable deps, vulnerable code patterns, and image CVEs *before* merge, and Dependabot opens grouped weekly PRs for routine updates plus same-day PRs for security advisories.

Design decisions:
- **GitHub-native first.** Dependabot, CodeQL, Dependency Review, secret scanning are free and already integrated into the PR experience. Skip commercial scanners (Snyk) at this tier — not enough marginal value for the cost.
- **Audit threshold = `high`.** `moderate` is too noisy for transitive dev dependencies. High/critical block; moderate/low surface as warnings.
- **Container scan severity = HIGH/CRITICAL.** OS-level CVEs in Node base images are common and often unfixable until the base image rebuilds; gating on MEDIUM would block every release.
- **Pin only third-party actions to commit SHA.** GitHub-owned `actions/*` are pulled from a trusted publisher and Dependabot bumps tags safely. Third-party (`googleapis/release-please-action`, `docker/*`, `aquasecurity/trivy-action`) are pinned to SHA — mitigates the tj-actions/changed-files-class compromise.
- **No dev-dependency exclusion.** Audit production *and* dev deps. Dev-dep CVEs (e.g., a compromised test runner) can poison the build.

## Context

### Current State

- `.github/workflows/` contains four workflows: `test.yml`, `release.yml`, `docker.yml`, `pages.yml`. None invoke `npm audit`, dependency review, or container scanning.
- `.github/` has **no `dependabot.yml`** — dependency updates are entirely manual.
- Repository root has **no `SECURITY.md`** — vulnerability reporters have no defined private channel.
- `gh api repos/marianfoo/arc-1/vulnerability-alerts` returns 404 — Dependabot vulnerability alerts are **disabled** at the repo level.
- All workflow `uses:` references are tag-pinned (`@v6`, `@v4`, `@v7`); no SHAs.
- `npm audit` (run 2026-05-08): **9 vulnerabilities (2 high, 7 moderate)**:
  - `path-to-regexp` 8.0.0–8.3.0 (HIGH, ReDoS) — fix available
  - `axios` <1.15.2 (HIGH+, prototype pollution, SSRF, CRLF) — fix available
  - `@hono/node-server` <1.19.13 (MODERATE, path traversal) — fix available
  - `hono` (MODERATE, JSX HTML injection) — fix available
  - `ip-address` <=10.1.0 (MODERATE, XSS) — fix available
  - `express-rate-limit` 8.0.1–8.5.0 (MODERATE, transitive) — fix available
  - `postcss` <8.5.10 (MODERATE, XSS) — fix available
  - All resolvable via `npm audit fix`.
- The npm package already publishes with **provenance** (`release.yml:66` — `npm publish --provenance --access public`). Tier 2 covers SBOM and Cosign signing; Tier 1 leaves provenance as-is.
- `docs_page/security-guide.md` covers runtime auth, safety flags, audit logging, and helmet/CORS — no section on dependency hygiene or supply-chain.
- `docs_page/docker.md:494` mentions Dependabot in passing as a reader recommendation — no actual config.
- The roadmap (`docs_page/roadmap.md`) tracks security work as `SEC-XX`. Last assigned: `SEC-10` (HTTP Security Headers + CORS).
- The feature matrix (`compare/00-feature-matrix.md`) §4 "Safety & Security" compares runtime guardrails across competitors — no rows yet for supply-chain security.

### Target State

- `.github/dependabot.yml` opens grouped PRs for npm (weekly + daily security), `github-actions` (weekly), and `docker` (weekly).
- Repo-level Dependabot vulnerability alerts are **enabled** in repository security settings.
- `.github/workflows/test.yml` runs `npm audit --audit-level=high` on every push and PR; vulnerabilities at `high`/`critical` fail the job.
- `.github/workflows/dependency-review.yml` blocks PRs that introduce new vulnerable dependencies or incompatible licenses.
- `.github/workflows/codeql.yml` runs CodeQL JavaScript/TypeScript analysis on every push/PR plus a weekly cron.
- `.github/workflows/docker.yml` and `.github/workflows/release.yml` invoke Trivy on the built image; HIGH/CRITICAL CVEs fail the job and the SARIF report uploads to the GitHub Security tab.
- All third-party action `uses:` references in every workflow file are pinned to a 40-character commit SHA with a `# vX.Y.Z` trailing comment for human readability. Dependabot auto-bumps SHAs.
- `SECURITY.md` exists at repo root with a private vulnerability reporting address, supported-version policy, and response-time SLA.
- `npm audit` reports **0 vulnerabilities** at high/critical after `npm audit fix`.
- `docs_page/security-guide.md` has a new section "Dependency & Supply-Chain Security (Tier 1)" describing what runs in CI and how operators verify the chain. `README.md` carries badges for CodeQL and the test workflow security gate. `compare/00-feature-matrix.md` gains a new "Supply-Chain Security" subsection. `docs_page/roadmap.md` gets a `SEC-11` completed entry. `CLAUDE.md` "Key Files for Common Tasks" lists the new workflow files.

### Key Files

| File | Role |
|------|------|
| `.github/dependabot.yml` | NEW — Dependabot config for npm, github-actions, docker |
| `.github/workflows/test.yml` | Add `npm audit --audit-level=high` step to existing `test` job |
| `.github/workflows/dependency-review.yml` | NEW — Dependency Review Action on PRs |
| `.github/workflows/codeql.yml` | NEW — CodeQL JavaScript/TypeScript analysis |
| `.github/workflows/docker.yml` | Add Trivy scanning step after image build |
| `.github/workflows/release.yml` | Add Trivy scanning step after image build (release path) |
| `.github/workflows/pages.yml` | Pin third-party actions to SHA |
| `SECURITY.md` | NEW — vulnerability reporting policy |
| `package.json` | No code changes; `npm audit fix` updates `package-lock.json` |
| `package-lock.json` | Updated by `npm audit fix` |
| `docs_page/security-guide.md` | New "Dependency & Supply-Chain Security" section |
| `docs_page/roadmap.md` | New `SEC-11` completed entry |
| `compare/00-feature-matrix.md` | New "Supply-Chain Security" rows in §4 |
| `README.md` | Add CodeQL + Test workflow badges |
| `CLAUDE.md` | Add new files to Key Files table |

### Design Principles

1. **GitHub-native first, commercial second.** Every Tier 1 control is free and zero-vendor-lockin. Pure-OSS coverage matters because enterprise procurement teams audit the supply chain itself.
2. **Block on `high`, surface on `moderate`.** Threshold tuning matters — gating on every advisory creates alert fatigue and PRs get force-merged. `high` strikes the right balance.
3. **Pin third-party actions to SHA, trust GitHub-official.** The 2024 `tj-actions/changed-files` compromise is the canonical example: a tag was force-pushed to a malicious commit. SHA pinning prevents this. GitHub-owned `actions/*` use signed releases — tag-pinning is acceptable for them.
4. **Audit dev deps too.** A compromised dev dependency (a test runner, a linter) can inject code into the published artifact. The gate covers everything in `node_modules`.
5. **Container scan failures gate releases, not dev builds.** `docker.yml` (dev push to `main`) records findings but does not gate; `release.yml` (release publish) gates HIGH/CRITICAL. Customers pulling `:latest` see the scanner output via SARIF; customers pulling `:vX.Y.Z` get a CVE-clean image.
6. **Doc parity matters.** Every control in CI must be visible to operators reading `docs_page/security-guide.md` so they can certify the chain to their security team.

## Development Approach

This plan is mostly YAML and Markdown; no TypeScript code is written. Test/lint/typecheck commands still run after every task because `package-lock.json` updates from `npm audit fix` could cause regressions. Workflow files are validated by pushing the feature branch and confirming the workflow runs successfully — there is no unit-test harness for GitHub Actions YAML. Order tasks so that the audit-fix lands first (clears the slate), then add gates (so future PRs can't regress), then add Dependabot (which will start opening PRs as soon as it merges), then container scanning, then the SHA pinning bulk edit, then docs.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm audit --audit-level=high`

### Task 1: Clear Existing npm audit Vulnerabilities

**Files:**
- Modify: `package-lock.json` (auto-generated by `npm audit fix`)
- Modify: `biome.json` (`$schema` URL bumped to match new Biome version)

**✅ Completed out-of-band in [arc-1#227](https://github.com/marianfoo/arc-1/pull/227).** The PR resolved all 9 advisories (2 HIGH, 7 MODERATE) via `npm audit fix` and additionally ran `npm update` to bring 13 in-range packages to latest. `npm audit --audit-level=high` now exits 0; full unit suite (2,519 tests) passes. TypeScript 5.8 → 6.0 and `@types/node` 22 → 25 are deferred as separate manifest-changing PRs. Ralphex should skip this task — proceed to Task 2.

- [x] Run `npm audit` and capture the full report. Expect 9 vulnerabilities (2 high, 7 moderate) at minimum. Note: the count may have grown since 2026-05-08 — the actual fix list comes from the live audit.
- [x] Run `npm audit fix` (without `--force`). This updates `package-lock.json` only — it does not bump declared `dependencies` or `devDependencies` in `package.json`.
- [x] If `npm audit fix` cannot resolve a vulnerability without a major version bump, do NOT use `--force`. Document the unfixable advisory in a `## Known Vulnerabilities (deferred)` section in this PR's description and continue. The CI gate (Task 3) supports an allowlist for these. (No deferrals required — all 9 fixable.)
- [x] Run `npm test` — all tests must pass. Lockfile-only changes can still trigger transitive behavior changes; this catches them.
- [x] Run `npm run typecheck` — no errors.
- [x] Run `npm run lint` — no errors.
- [x] Run `npm audit --audit-level=high` — must exit 0 (no high/critical vulnerabilities remain). If it doesn't exit 0, stop and report; the rest of the plan depends on a clean baseline.
- [x] Verify `package-lock.json` diff is sane: only resolved-version bumps in `node_modules` entries, no `package.json` source changes.

### Task 2: Add Dependabot Configuration

**Files:**
- Create: `.github/dependabot.yml`

Dependabot opens automatic PRs for outdated and vulnerable dependencies. Without it, the only signal of an upstream advisory is the GitHub security tab — easy to miss. Configure three ecosystems (npm, github-actions, docker) with weekly updates plus daily security advisories. Group dev dependencies and `@types/*` to reduce PR noise; isolate production deps and the SAP-related SDK packages so they get individual review.

- [ ] Create `.github/dependabot.yml` with `version: 2` and three `updates:` entries:
  - **npm**: `directory: "/"`, `schedule.interval: "weekly"` (Mondays), `schedule.timezone: "Europe/Berlin"` (project author timezone), `open-pull-requests-limit: 10`, `versioning-strategy: "increase"`. Define groups:
    - `dev-dependencies` — `dependency-type: "development"`, `update-types: ["minor", "patch"]`
    - `types` — `patterns: ["@types/*"]`
    - `sap-sdk` — `patterns: ["@sap/*", "@sap-cloud-sdk/*"]`
    - `mcp-sdk` — `patterns: ["@modelcontextprotocol/*"]`
    - `linting` — `patterns: ["@biomejs/*", "biome"]`
  - **github-actions**: `directory: "/"`, `schedule.interval: "weekly"`, `open-pull-requests-limit: 5`, group all action updates under `actions` (use `patterns: ["*"]`).
  - **docker**: `directory: "/"`, `schedule.interval: "weekly"`, `open-pull-requests-limit: 3`. Tracks the `node:22-alpine` base image declared in `Dockerfile`.
- [ ] Each update entry uses `commit-message.prefix: "chore(deps)"` for npm/actions/docker (matches release-please's `chore:` ignore list — Dependabot PRs do not trigger releases).
- [ ] Each update entry uses `labels: ["dependencies"]`.
- [ ] Add a `reviewers: ["marianfoo"]` entry per update group so PRs auto-request review.
- [ ] Validate YAML by running `python3 -c 'import yaml,sys; yaml.safe_load(open(".github/dependabot.yml"))'` — must exit 0.
- [ ] In repository security settings (`https://github.com/marianfoo/arc-1/settings/security_analysis`), enable: "Dependabot alerts", "Dependabot security updates", "Dependabot version updates" (the last is what reads this file). Document this manual step in the PR description so reviewers know to enable it post-merge.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Add npm audit Gate to Test Workflow

**Files:**
- Modify: `.github/workflows/test.yml`

Add an `npm audit --audit-level=high` step to the existing `test` job (currently runs on Node 22 + 24 matrix at `.github/workflows/test.yml:32-89`). Failing the build on `high`/`critical` advisories prevents PRs from introducing known vulnerable transitive deps. Place the step *after* `npm ci` and *before* `npm run lint` so dependency installation is validated, but the audit fails fast before slower steps run.

- [ ] In `.github/workflows/test.yml`, locate the `test` job (the matrix job that runs Lint + Type check + Tests on Node 22 and 24). Insert a new step named `Security audit (npm audit)` immediately after the `Install dependencies` step (currently at line 47-48).
- [ ] The step runs `npm audit --audit-level=high --omit=optional`. Do NOT add `--omit=dev` — dev dependencies must be audited too.
- [ ] Add a fallback for known-unfixable advisories: if Task 1 left any `## Known Vulnerabilities (deferred)` items, document the audit IDs (e.g., `GHSA-xxxx-xxxx-xxxx`) in a comment in the workflow file. Use `continue-on-error: true` only as a last resort and only after explicit operator sign-off — the default is fail-on-high.
- [ ] Run the step locally first: `npm audit --audit-level=high` exits 0 (assuming Task 1 cleared everything).
- [ ] Validate YAML: `python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/test.yml"))'`.
- [ ] Push the branch and verify the `Test` workflow runs the new step on the PR. Confirm: green when audit is clean, red when a known vulnerable dep is artificially introduced (test by `npm install --save axios@1.0.0` in a throwaway commit, confirm CI fails, then revert).
- [ ] Run `npm test` — all tests must pass.

### Task 4: Add Dependency Review Workflow

**Files:**
- Create: `.github/workflows/dependency-review.yml`

The GitHub Dependency Review Action runs on PRs and fails when a PR adds a dependency with a known vulnerability or an incompatible license. This is the *PR-time* check that complements Dependabot's *post-fact* fixes — vulns get caught before merge, not after. It also enforces a license allowlist so a contributor cannot pull in a GPL-3.0 dependency that contaminates the MIT-licensed npm package.

- [ ] Create `.github/workflows/dependency-review.yml` with `name: Dependency Review`, `on: pull_request: branches: [main]`.
- [ ] Single job `dependency-review` on `ubuntu-latest`, `permissions: contents: read, pull-requests: write` (the latter so the action can comment on the PR with findings).
- [ ] Steps:
  - `actions/checkout@v6` (GitHub-official, tag pin acceptable per design principle 3).
  - `actions/dependency-review-action@v4` (official GitHub action — tag pin acceptable). Inputs:
    - `fail-on-severity: high`
    - `comment-summary-in-pr: on-failure`
    - `allow-licenses: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, Unlicense, 0BSD, MPL-2.0, BlueOak-1.0.0, CC-BY-4.0` (covers all current production deps; `npm ls --all --json | jq '.dependencies | .. | .license? // empty' | sort -u` produced this list during research — re-run to confirm before merge).
    - `deny-licenses: GPL-2.0, GPL-3.0, AGPL-3.0, LGPL-2.1, LGPL-3.0` (copyleft licenses that contaminate MIT distribution).
- [ ] Validate YAML with `python3 -c 'import yaml,sys; yaml.safe_load(...)'`.
- [ ] Push the branch and verify the workflow appears on the PR's checks list.
- [ ] Run `npm test` — all tests must pass.

### Task 5: Add CodeQL Workflow

**Files:**
- Create: `.github/workflows/codeql.yml`

CodeQL is GitHub-native SAST for JavaScript/TypeScript. ARC-1 handles SAP credentials, JWT validation, SQL passthrough (`SAPQuery`), file paths (cookie files, BTP service keys), HTTP middleware, and OAuth flows — exactly the OWASP-class injection/path-traversal/SSRF surface that CodeQL covers. The default `security-extended` query suite catches weak crypto, prototype pollution, and prototype-poisoning chains that npm audit alone would miss.

- [ ] Create `.github/workflows/codeql.yml` with `name: CodeQL`, triggers `on: push: branches: [main]`, `pull_request: branches: [main]`, and `schedule: - cron: '23 4 * * 1'` (Mondays 04:23 UTC — staggered off-hour to avoid GitHub Actions queue contention).
- [ ] Job `analyze` on `ubuntu-latest`, `timeout-minutes: 30`, `permissions: actions: read, contents: read, security-events: write` (the last writes findings to the GitHub Security tab).
- [ ] `strategy.matrix.language: ['javascript-typescript']` (single entry — covers both .ts and .js files).
- [ ] Steps:
  - `actions/checkout@v6`
  - `github/codeql-action/init@v4` with `languages: ${{ matrix.language }}`, `queries: security-extended,security-and-quality`, `config-file: ./.github/codeql/codeql-config.yml` (created next).
  - `github/codeql-action/autobuild@v4` (TypeScript: runs `npm ci && npm run build`, which works because `package.json` already defines a `build` script).
  - `github/codeql-action/analyze@v4` with `category: "/language:${{ matrix.language }}"`.
- [ ] Create `.github/codeql/codeql-config.yml` with:
  - `name: "ARC-1 CodeQL config"`
  - `paths-ignore: ['tests/**', 'docs/**', 'docs_page/**', 'compare/**', 'scripts/**', 'site/**', 'dist/**', 'node_modules/**', 'tests/fixtures/**']` — exclude test/build/doc paths so findings come only from `src/`.
  - `paths: ['src/']` — explicit allowlist to make the intent unmistakable.
- [ ] Validate both YAML files.
- [ ] Push the branch. Confirm the workflow runs and uploads results to `https://github.com/marianfoo/arc-1/security/code-scanning`. First-run CodeQL surfaces a baseline of findings — these are not regressions; review them and triage in a follow-up PR or dismiss with documented rationale.
- [ ] Run `npm test` — all tests must pass.

### Task 6: Add Trivy Container Scanning

**Files:**
- Modify: `.github/workflows/docker.yml`
- Modify: `.github/workflows/release.yml`

Trivy scans the built Docker image for OS-level CVEs (Alpine packages) and JS-level CVEs (`node_modules`). Customers pulling `ghcr.io/marianfoo/arc-1` from regulated environments will run Aqua/Prisma/Defender against it; better to catch issues here than to ship them. Add Trivy as a non-gating step on `docker.yml` (dev push to `main` — surface findings only) and as a **gating** step on `release.yml` (release path — fail HIGH/CRITICAL) so dev iteration isn't blocked but releases are CVE-clean.

- [ ] In `.github/workflows/docker.yml`, after the `build` job's existing `Build and push by digest` step (currently line 47-55), add:
  - A step `Scan image with Trivy` using `aquasecurity/trivy-action@<SHA>` (third-party — pin to commit SHA per design principle 3; latest as of 2026-05-08 is around `0.24.x`, look up the current SHA at https://github.com/aquasecurity/trivy-action/releases). Inputs: `image-ref: ghcr.io/marianfoo/arc-1@${{ steps.build.outputs.digest }}`, `format: sarif`, `output: trivy-results.sarif`, `severity: HIGH,CRITICAL`, `exit-code: 0` (non-gating on dev).
  - A step `Upload Trivy SARIF` using `github/codeql-action/upload-sarif@v4` with `sarif_file: trivy-results.sarif` and `category: trivy-${{ matrix.platform }}`.
  - The job needs `permissions: security-events: write` added so the SARIF can post to the Security tab.
- [ ] In `.github/workflows/release.yml`, in the `publish-docker` job after `Build and push by digest` (currently line 144-151), add the same two Trivy steps but with `exit-code: 1` (gating — release fails on HIGH/CRITICAL). Add `permissions: security-events: write`.
- [ ] In `release.yml`, the `publish-docker-merge` job is the manifest-list step that runs after both arch builds — it does not need Trivy (the per-arch images already scanned). Leave it alone.
- [ ] Validate both YAML files.
- [ ] Push the branch. Confirm `Docker (dev)` workflow runs and the Trivy step uploads SARIF results to the Security tab. Confirm `Release` workflow does NOT trigger on a regular PR (it triggers on push to main only).
- [ ] To exercise the release path's gate behavior pre-merge, optionally create a draft PR that simulates the release path (or wait for the actual release after merge — the release-please PR creates this naturally).
- [ ] Run `npm test` — all tests must pass.

### Task 7: Pin Third-Party GitHub Actions to Commit SHA

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/docker.yml`
- Modify: `.github/workflows/pages.yml`
- Modify: `.github/workflows/dependency-review.yml` (created in Task 4 — pin if not GitHub-official)
- Modify: `.github/workflows/codeql.yml` (created in Task 5 — `github/codeql-action` is GitHub-official, tag pin OK)

The 2024 `tj-actions/changed-files` supply-chain compromise force-pushed a malicious commit to the `v45` tag, executing arbitrary code in every CI run that pinned to the tag. SHA pinning eliminates the attack vector — a SHA cannot be force-pushed without breaking the pin. Apply this to **third-party actions only**; GitHub-owned `actions/*` are pulled from a verified publisher and benefit from tag-based version channels that Dependabot tracks.

Third-party actions currently in use across all workflows:
- `googleapis/release-please-action@v4` (`release.yml:17`)
- `docker/setup-buildx-action@v4` (`release.yml:122`, `docker.yml:27`)
- `docker/login-action@v4` (`release.yml:126`, `release.yml:184`, `docker.yml:31`, `docker.yml:87`)
- `docker/metadata-action@v6` (`release.yml:134`, `release.yml:191`, `docker.yml:39`, `docker.yml:94`)
- `docker/build-push-action@v7` (`release.yml:144`, `docker.yml:48`)
- `aquasecurity/trivy-action@<vN>` (added in Task 6 — pin from the start)

GitHub-official (leave on tags):
- `actions/checkout@v6`
- `actions/setup-node@v6`
- `actions/setup-python@v6` (pages.yml)
- `actions/upload-artifact@v7` and `@v4`
- `actions/download-artifact@v5` and `@v4`
- `actions/upload-pages-artifact@v4` (pages.yml)
- `actions/deploy-pages@v5` (pages.yml)
- `actions/dependency-review-action@v4` (added in Task 4)
- `github/codeql-action/{init,autobuild,analyze,upload-sarif}@v4`

Procedure:
- [ ] For each third-party action, look up the commit SHA for the currently-pinned tag using `gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'`. Example: `gh api repos/googleapis/release-please-action/git/refs/tags/v4 --jq '.object.sha'`. Some tags are annotated and resolve to a tag object — chase via `gh api repos/<owner>/<repo>/git/tags/<sha-from-step-1> --jq '.object.sha'` (or use `gh api repos/<owner>/<repo>/commits/<tag> --jq '.sha'` which dereferences automatically).
- [ ] Replace every third-party `uses: <owner>/<action>@<tag>` with `uses: <owner>/<action>@<40-char-sha> # <tag>`. The trailing `# <tag>` comment lets a reader see what version the SHA points at; Dependabot updates both the SHA and the comment together.
- [ ] Confirm Dependabot's `github-actions` group from Task 2 will pick up the SHA-pinned references. Dependabot's behavior: on a SHA pin with a version comment, it auto-bumps both atomically — no extra config needed.
- [ ] Push the branch. Confirm all workflows still pass after the pin (SHA != tag is a valid pin; CI must run identically).
- [ ] Run `npm test` — all tests must pass.

### Task 8: Add SECURITY.md

**Files:**
- Create: `SECURITY.md`

A repository `SECURITY.md` is the conventional channel for private vulnerability disclosure. GitHub renders it on the repo's "Security" tab and the OpenSSF Scorecard (Tier 2) checks for it. Without it, security researchers either file a public issue (worst case — discloses a 0-day) or have no way to reach the maintainer. Include: supported versions, private reporting channel (GitHub Private Vulnerability Reporting + email fallback), response-time SLA, and CVE handling policy.

- [ ] Create `SECURITY.md` at repo root with these sections:
  - **Supported Versions**: Table of MAJOR.MINOR lines and their support status. Currently only `0.8.x` is supported (latest minor — pre-1.0 we only support the latest line). Older versions: "Please upgrade to receive security fixes."
  - **Reporting a Vulnerability**: Two channels:
    1. **Preferred**: GitHub Private Vulnerability Reporting at `https://github.com/marianfoo/arc-1/security/advisories/new`.
    2. **Fallback (email)**: `<email-address-of-maintainer>` — agree on the address with the project owner before merging this task; default to `marianbsp@gmail.com` if no other address is provided. PGP key (optional): link to a public key on `keys.openpgp.org`.
  - **Response Times** (best-effort, not contractual):
    - Acknowledgement of report: within **3 business days**.
    - Initial triage and severity assessment: within **7 business days**.
    - Fix or mitigation timeline: depends on severity (Critical: 14 days, High: 30 days, Moderate: 60 days, Low: best-effort).
  - **CVE Handling**: Confirmed vulnerabilities receive a GitHub Security Advisory (GHSA) and, where applicable, a CVE assigned via GitHub's CNA. Patches publish via the normal release flow (release-please → npm + ghcr.io); the advisory marks affected versions and the fixed version.
  - **Out of Scope**: Vulnerabilities in the SAP system itself (use SAP's responsible-disclosure channel — `https://www.sap.com/about/trust-center/security/incident-management.html`). Vulnerabilities in upstream dependencies that have no ARC-1-specific exposure (report upstream).
  - **Safe Harbor**: ARC-1 supports good-faith security research. Researchers acting in good faith and following this policy will not face legal action.
- [ ] Enable GitHub Private Vulnerability Reporting in repo settings (`https://github.com/marianfoo/arc-1/settings/security_analysis`) — this is the channel referenced above. Document the manual step in the PR description.
- [ ] Run `npm test` — all tests must pass.

### Task 9: Update Documentation

**Files:**
- Modify: `docs_page/security-guide.md`
- Modify: `README.md`
- Modify: `docs_page/roadmap.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Every Tier 1 control must be visible to operators: enterprise security teams reviewing ARC-1 for adoption need to see, on one page, what runs in CI and what guarantees the chain. Update five artifacts: the operator-facing security guide, the README badges (visible signal), the roadmap (planning artifact), the feature matrix (competitive comparison — supply chain is where ARC-1 leads), and `CLAUDE.md` (so future autonomous agents know about the new files).

- [ ] In `docs_page/security-guide.md`, add a new top-level section **`## 13. Dependency & Supply-Chain Security`** (after current §12 Incident Response). Subsections:
  - `### 13.1 What runs in CI` — table mapping control → workflow file → severity gate (Dependabot weekly + daily security; npm audit `--audit-level=high` in `test.yml`; Dependency Review Action in `dependency-review.yml`; CodeQL `security-extended,security-and-quality` in `codeql.yml`; Trivy HIGH/CRITICAL gating in `release.yml`, non-gating in `docker.yml`).
  - `### 13.2 Verifying the chain as an operator` — three commands: `npm audit --audit-level=high` against the published package; `trivy image ghcr.io/marianfoo/arc-1:<version>` against the image; viewing the GHSA advisories at `https://github.com/marianfoo/arc-1/security/advisories`.
  - `### 13.3 Reporting vulnerabilities` — point at `SECURITY.md`.
  - Note Tier 2 (SBOM, npm provenance, Cosign, Scorecard) and Tier 3 (Socket.dev, triage SLA) as upcoming work with link to their plans.
- [ ] In `README.md`, in the badge block near the top (currently has the npm/docker/license badges), add:
  - `[![CodeQL](https://github.com/marianfoo/arc-1/actions/workflows/codeql.yml/badge.svg)](https://github.com/marianfoo/arc-1/actions/workflows/codeql.yml)`
  - `[![Test](https://github.com/marianfoo/arc-1/actions/workflows/test.yml/badge.svg)](https://github.com/marianfoo/arc-1/actions/workflows/test.yml)` (already may exist — verify and dedupe).
- [ ] In the README "Security & Admin Controls" subsection, add a new bullet under the existing list: "**Supply-chain security** — Dependabot for npm/actions/Docker, `npm audit` PR gate, GitHub Dependency Review, CodeQL SAST, Trivy container scanning. See [security guide §13](docs_page/security-guide.md#13-dependency--supply-chain-security)."
- [ ] In `docs_page/roadmap.md`:
  - In the "Overview: Completed" table (around line 102+), add a new row: `| [SEC-11](#sec-11) | Dependency & Supply-Chain Security — Foundation (Dependabot, npm audit gate, Dependency Review, CodeQL, Trivy, SHA pinning, SECURITY.md) | <today's date YYYY-MM-DD> | Security |`. Insert in date order (newest first).
  - In the "Details: Completed" section (after `<a id="sec-10"></a>`), add a new `<a id="sec-11"></a>` block with: status (Complete, dated), summary, scope (this plan), and links to the workflow files.
  - Update the "Last Updated" date at the top of the file.
- [ ] In `compare/00-feature-matrix.md`:
  - In §4 "Safety & Security", add a new sub-table titled `### 4.1 Supply-Chain Security` (place it right after §4's main table) with rows: Dependabot, npm audit CI gate, GitHub Dependency Review, CodeQL SAST, Container scanning, SECURITY.md, Pinned third-party actions. Score ARC-1 ✅ for all; populate other competitors based on their public repos (this is fact-based — `gh api repos/<comp>/contents/.github/dependabot.yml` returns 200 or 404).
  - Update the "_Last updated:_" line at the top of the file.
- [ ] In `CLAUDE.md`, in the "Key Files for Common Tasks" table, add three rows:
  - `| Add/modify dependency security check | \`.github/dependabot.yml\`, \`.github/workflows/test.yml\` (npm audit step), \`.github/workflows/dependency-review.yml\` |`
  - `| Add/modify SAST analysis | \`.github/workflows/codeql.yml\`, \`.github/codeql/codeql-config.yml\` |`
  - `| Add/modify container scanning | \`.github/workflows/docker.yml\`, \`.github/workflows/release.yml\` (Trivy steps) |`
- [ ] Run `npm run lint` and `npm test` to confirm doc changes don't break anything (Markdown is not lint-checked, but Biome may flag JSON in code blocks; verify clean).

### Task 10: Final Verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm audit --audit-level=high` — exits 0 (no high/critical advisories).
- [ ] Confirm the PR's CI run shows the following workflows passing: `Test`, `Dependency Review`, `CodeQL`, `Docker (dev)` (with Trivy SARIF upload visible).
- [ ] Confirm the GitHub Security tab shows: CodeQL findings (baseline), Trivy findings (if any), no open Dependabot alerts at high/critical.
- [ ] Manually verify in repo settings that the following are enabled: Dependabot alerts, Dependabot security updates, Dependabot version updates, Private Vulnerability Reporting.
- [ ] Confirm `SECURITY.md` renders correctly on the repo's Security tab.
- [ ] Confirm `README.md` badges render (CodeQL + Test workflow status badges visible).
- [ ] Confirm `docs_page/security-guide.md` §13 renders correctly via `mkdocs build` (this is what `pages.yml` would publish).
- [ ] Confirm no third-party GitHub Action across all workflow files is tag-pinned: `grep -rE 'uses: (?!actions/|github/)' .github/workflows/ | grep -vE '@[a-f0-9]{40}'` should return nothing.
- [ ] Move this plan to `docs/plans/completed/dependency-security-tier1-foundation.md`.
