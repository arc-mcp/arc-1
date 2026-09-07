# Security operations for the ARC-1 maintainer

This is the maintainer runbook for the [implementation plan](plans/2026-09-07-enterprise-security-implementation.md).
Customers should start with the [Security Assessment](../docs_page/security-assessment.md).

## 1. Merge the repository changes before activating requirements

The PR supplies a `Dependency security` check, separate license reporting, optional release-App
wiring, a dependency evidence command/workflow, and Socket configuration. The ruleset file is
**disabled**. Committing these files does not activate GitHub rules or install an App.

On the PR, verify Dependency security, Dependency licenses, CodeQL and the normal repository
checks. The selected new merge requirements are **Dependency security** and **CodeQL security
results at high or higher**. Do not add the Test jobs, license job, evidence workflow, docs,
coverage, build or SAP integration checks to this security ruleset.

## 2. Configure the Release Please App

The default GitHub Actions token does not trigger ordinary workflows when it creates or updates
a PR. The optional App token fixes that event path. Do this before enforcing required checks.

1. In the GitHub organization's Developer settings, create a private GitHub App for release
   automation. Use the repository URL as its homepage. It does not need a webhook or user
   authorization callback for installation-token use.
2. Grant repository **Contents: read and write** and **Pull requests: read and write**.
   Metadata read is implicit. Do not grant organization-wide administration or secrets access.
3. Install it for **only `arc-mcp/arc-1`**. Generate its private key and store it securely.
4. In repository Settings → Secrets and variables → Actions, add the private key as
   `RELEASE_APP_PRIVATE_KEY`. Then set the variable `RELEASE_APP_CLIENT_ID` to the App's Client ID.
5. On the next ordinary `main` push, inspect the Release workflow's token and Release Please
   steps. The action limits the installation token to this repository and the two permissions,
   and revokes it at job completion. A configured App failure stops the job; it is not ignored.
6. Verify an App-generated release PR update triggers Dependency security and CodeQL for the
   current PR revision. Also check a normal PR, a dependency PR and a fork PR when available.

Do **not** manually dispatch `Release` as a test: its existing `workflow_dispatch` path publishes
npm. Use an ordinary push and the resulting release PR. Preserve the existing npm release-time
test job and OIDC publication even after PR checks become effective.

If the App is not configured, the workflow retains the old token path so releases keep working.
That path is not ready for mandatory PR checks. Store recovery access separately and review old
tokens/private keys after migration; never paste them into an issue or the evidence report.

Sources: [Release Please tokens](https://github.com/googleapis/release-please-action#other-actions-on-release-please-prs),
[installation token action](https://github.com/actions/create-github-app-token).

## 3. Import, verify and enable the security ruleset

1. Open repository Settings → Rules → Rulesets. Import
   [`.github/security-ruleset.json`](../.github/security-ruleset.json). It targets the default branch
   and starts **Disabled**. If the named ruleset already exists, update it rather than creating
   a duplicate. Preserve the separate existing PR/deletion/non-fast-forward rules.
2. Verify the required check is **Dependency security**, supplied by **GitHub Actions**.
   The template pins GitHub Actions integration ID `15368`, observed in this repository.
   Recheck that provider when using this template on a different GitHub host.
3. Verify the CodeQL security threshold is **High or higher**, and ordinary **Alerts** is **None**.
   CodeQL results must be available for the PR and target revision. Default setup is already
   configured for this repository; do not add a duplicate advanced-setup workflow.
4. Inspect completed normal and release PR checks from step 2. Keep enforcement disabled if a
   check is missing, waiting forever, or failing because of setup. A missing scan is not a pass.
5. Enable the ruleset. It requires an up-to-date branch for the selected status check and has
   no bypass actors. Verify the effective rules and the PR merge panel; do not merge a failing
   probe. Record evidence of a harmless check failure being refused before calling it enforced.

Read-only verification from a repository clone:

```bash
gh api repos/arc-mcp/arc-1/rules/branches/main
gh pr checks PR_NUMBER --repo arc-mcp/arc-1
gh api repos/arc-mcp/arc-1/commits/PR_HEAD_SHA/check-runs \
  --jq '.check_runs[] | {name, conclusion, source: .app.slug, app_id: .app.id}'
```

Replace the uppercase placeholders with the PR being checked. Retain dated output privately
with the rollout record. For a controlled failure demonstration, use a temporary test repository
or a harmless policy fixture; never install real malware, expose credentials or publish a
vulnerable artifact. Do not treat a YAML test alone as proof of server-side enforcement.

**Rollback:** disable only `ARC-1 security checks` if a configuration failure blocks all work;
record the incident and re-enable after verification. Keep existing protections and secret push
protection. If reverting to the default release token, disable these new requirements first
until release PR events are working again. Prefer fixing the missing check to a permanent bypass.

See [GitHub's code-scanning rules](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection).

## 4. Verify Socket access and calibrate its policy

On 7 September 2026, [PR #765](https://github.com/arc-mcp/arc-1/pull/765) received a successful
Socket Project Report from App `socket-security` (ID `156372`). Its Pull Request Alerts check
reported success with **no net dependency changes**, so alert analysis was skipped. This verifies
that the integration responds; it does not verify a malware block, AppRouter coverage or plan entitlement.

1. Check the existing organization's entitlement. If the OSS upgrade is still needed, follow
   the [Socket OSS program application](https://www.socket.dev/blog/free-business-plan-upgrades-for-open-source).
   Approval is a vendor decision; no paid plan or minimum-seat subscription is needed to prepare
   this integration. This task has not verified entitlement or submitted an application.
2. Reuse the existing Socket GitHub App installation for ARC-1. Include the separate auth package repository where
   eligible and authorized; it is still part of the product's dependency boundary.
3. Confirm Socket sees both root and `btp/approuter` manifests/lockfiles. `socket.yml` keeps all
   PRs eligible and adds no manifest exclusions. It does not install the App or set its policy.
4. In the dashboard choose the **Essential** baseline, which blocks malware. Add warning rules
   for the behavioral signals you want reviewed, including install scripts, network access and
   obfuscation. Check the exact alert types available in the account. These signals can be valid
   behavior; do not block every install script or assume the default Balanced policy matches this plan.
5. Inspect repository overrides and resolved alerts: they can override dashboard policy. Review
   actual dependency PRs for a week or several updates. Record false positives and the reasons
   for any narrowly scoped resolution.
6. Once calibrated, recheck the observed `Socket Security: Pull Request Alerts` name and App identity. Add that check to
   the security ruleset with the correct provider. Verify it reports on normal, dependency and
   release PRs before requiring it. Do not invent a check name from this guide.

Socket's PR integration analyzes dependencies; it does not enforce what a customer's independent
BTP build installs. Customers retain their own build controls. Details:
[Socket policies](https://docs.socket.dev/docs/policies), [repository configuration](https://docs.socket.dev/docs/socket-yml).

## 5. Generate and retain dependency evidence

From a reviewed source checkout with Node and npm available:

```bash
npm run security:evidence
```

Open the printed `summary.md` path. It contains the results, JSON links and a human staging
worksheet. The output directory is new for each run, under gitignored `reports/security/`.
This command requires no `npm ci`, SAP credentials or running BTP application. npm audits send
dependency information to the configured registry; private registries must support the audit API.

For a clean source checkout and an already-built archive, after following the canonical
[BTP build runbook](../docs_page/btp-cloud-foundry-deployment.md):

```bash
npm run security:evidence -- --require-clean --mtar mta_archives/arc1-mcp_1.2.0.mtar
```

Use the actual MTAR filename/version. `--out NEW_DIRECTORY` selects a different output location;
an existing directory is refused. `--fail-on-high` returns exit 1 for high/critical findings.
Exit 2 means unavailable, invalid or inconsistent evidence. Without that option, completed
collection returns 0 even with findings: **read the summary before approving a deployment**.

The separate **Dependency evidence** workflow runs Monday/Wednesday/Friday and on manual
dispatch, pins npm 11.11.1, and retains artifacts for 30 days. Its red result is a maintenance
signal, not a required PR check. Download evidence before artifact retention expires if needed
for an assessment. Run it again for the customer's exact approved commit; scheduled `main`
evidence does not automatically cover an older release or a modified clone.

Generated component inventories and raw audit reports can contain package names and registry
URLs. Review customer-generated evidence before sharing externally. The collector does not
collect environment variables, service keys, CF logs or staging credentials. Complete the
staging worksheet with the platform owner; a checksum alone does not establish the MTAR's source.

## 6. Weekly triage and exceptions

Review Dependabot, CodeQL, Socket (once installed) and the scheduled evidence/container results.
Prioritize applicable high/critical findings and new malicious-package alerts. Do not wait for
a release if customers need a mitigation or advisory. Use the response targets in
[SECURITY.md](../SECURITY.md); no new contractual response SLA is introduced here.

Copy this into a private issue or customer maintenance record as appropriate:

```text
Finding/advisory and affected package/version:
Affects: build / ARC-1 runtime / AppRouter / other
Affected source/release/deployment:
Applicability evidence:
Decision: update / mitigate / accept temporarily / not affected
Fix or mitigation and validation:
Owner:
Review/expiry date:
Related customer notification or advisory:
Evidence links:
```

An exception should identify an exact finding/version and a review date. Keep raw scan results;
do not silently suppress them or claim a scanner failure is a clean result. Reassess on package,
deployment or advisory changes. Keep customer-specific details out of public PRs.
