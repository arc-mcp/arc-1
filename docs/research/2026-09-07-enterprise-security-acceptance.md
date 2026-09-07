# Making ARC-1 easier to approve in enterprise security reviews

**Decision report · 7 September 2026 · Audience: ARC-1's solo maintainer**

Scope: public OSS ARC-1, SAP/BTP enterprise customers, dependency and release security,
procurement evidence, and feasible investments. Budget assumption: **€300–500 once**;
recurring subscriptions are evaluated separately. Effort figures are planning estimates,
not quotes. Prices retain their published currency; no assumed dollar/euro conversion.

## Recommendation

Make the existing controls easy to verify, close the merge/build evidence gaps, and add one
malicious-package detection service through its free OSS program. Prioritize customers who
clone the repository and deploy to BTP. Keep security on the existing documentation site.
External reviews, pentests and certification projects are outside the maintainer's chosen plan;
use the available budget only for tools or account protection with demonstrable value.

For ARC-1, the immediate acceptance problem is partly presentation and partly missing evidence
about the artifact a customer actually runs. The repository already has useful defenses; a
long checklist buried under “Reference” does not show a reviewer which controls are enforced,
which release was checked, where SAP information goes, or who handles maintenance.

This prioritization is an inference from the repository and procurement guidance. No research
here establishes a measurable adoption uplift from a badge, scanner, or audit. Two or three
real customer assessments should determine which next investment removes an actual blocker.
The [CISA/FBI Secure by Demand guide, 6 August 2024](https://www.ic3.gov/CSA/2024/240806.pdf)
supports asking for vulnerability handling, dependency transparency, authentication, logging,
and evidence of secure development.

## Implementation follow-through

The selected work is implemented in the accompanying [implementation plan](../plans/2026-09-07-enterprise-security-implementation.md) and [security operations runbook](../security-operations.md): separate dependency security/license jobs, release-App support, a disabled security ruleset, source dependency evidence, and Socket configuration. Account activation remains post-merge. The research observations below retain their original date and scope.

## Current decisions after maintainer feedback

- **Documentation:** one prominent Security & Trust entry on the existing site, with an overview,
  dependency/BTP build evidence, hardening guidance, and reusable assessment answers. No separate
  hosted trust-center product.
- **Required checks:** security checks only. The maintainer declined new mandatory test,
  type-check, lint, build, MTA-validation and documentation gates. Recommend dependency
  vulnerability review and CodeQL security findings as the initial required checks, then a
  narrowly configured Socket malware check after calibration. Existing workflows and release
  controls remain in place; no repository rules have been changed.
- **Release automation:** use a narrowly scoped GitHub App installation token for Release Please
  so its PR events can trigger the required workflows. This entails an App setup and private-key
  secret; do not enable required checks before normal and release PR behavior has been tested.
  A personal access token is an alternative with more personal-account lifecycle coupling.
  [Release Please's token guidance](https://github.com/googleapis/release-please-action).
- **BTP source builds:** root lockfiles are available and `mta.yaml` uses `npm ci` before the
  TypeScript build. The archive excludes `node_modules`, so staging remains a separate dependency
  installation boundary. Record source/lockfile hashes, build tools, MTAR checksum, selected
  buildpack/stack/Node/npm, and installed dependency inventory where supported. The optional
  AppRouter has its own graph. Do not claim the upstream npm SBOM inventories the final BTP runtime.
- **Socket:** selected. Implementation later observed the existing Socket App reporting on PR #765.
  Its project report passed and PR alert analysis skipped because no dependencies changed. Reuse
  that installation; verify OSS entitlement, graph coverage and the dashboard policy before requiring it.
- **Attestations:** new signing/attestation work declined. Retain existing npm provenance and
  current release controls. BTP evidence should still identify the source, dependencies, build
  and staging inputs, but adding a cryptographic signing system is outside this plan.
- **Assessment page:** accepted, with a human-friendly format: plain questions, short answers,
  one customer decision per topic, and links to details. A small checklist and copyable decision
  record replace a large control matrix. Distinguish available features from verified customer
  configuration. Prepared locally as `docs_page/security-assessment.md`.
- **Independent assurance:** declined by the maintainer. Historical cost comparisons below remain
  research context and are not proposed actions or budget allocations.

## Recommended security checks

The goal is to block specific security problems while keeping routine quality checks outside
the new merge rules. Start with the first two checks below; preserve secret push protection;
introduce Socket blocking after observing its results. This is a proposal, not an enabled policy.

| Control | What it checks | Recommended handling |
|---|---|---|
| Dependency Review | Added or updated direct/transitive dependencies in the PR, including the root and AppRouter lockfiles | Require a successful check; block newly introduced known high/critical vulnerabilities. Include build dependencies because they execute in the build environment. |
| CodeQL | Supported code patterns that can indicate vulnerabilities, such as injection and unsafe path handling | Require CodeQL results; set **Security alerts: High or higher** and ordinary **Alerts: None**. Report lower-severity findings for triage. This avoids making general code-quality findings a merge condition. |
| Secret push protection | Supported credential/token patterns in a push | Already enabled; retain it. A detected supported secret is blocked at push time, rather than through a new test job. It does not detect every custom credential. |
| Socket | Malicious packages and suspicious dependency behavior | After calibration, require its check with malware findings set to **Block**. Set behavioral signals such as install scripts, network access and obfuscation to **Warn** for human review initially. Legitimate packages can exhibit these behaviors. |

GitHub's [Dependency Review documentation](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
describes its comparison of changed dependencies and configurable severity threshold. The existing
ARC-1 workflow also checks licenses: separate that result from the required security check so
the new rule does not implicitly introduce mandatory license-policy enforcement. This proposal
does not remove or approve exceptions to the existing license policy.

GitHub exposes separate general-alert and security-alert thresholds in its
[code-scanning merge protection](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection).
CodeQL cannot establish that every custom SAP authorization rule is correct. Security scanners
provide evidence within their coverage; enabling them does not establish complete product security.

Socket's [policies](https://docs.socket.dev/docs/policies) distinguish Block, Warn and Monitor.
Start with its malware-focused Essential baseline and explicit warning rules for the desired
behavior signals; review repository overrides and resolved alerts before making the check
required. Do not assume that installing the GitHub App automatically selects this policy.
The App's PR check also does not stop an independent customer build from installing a package;
customers retain control of their own build pipeline.

**Existing dependency findings:** keep whole-tree audits and advisory monitoring for vulnerabilities
disclosed after a dependency was merged. Give applicable findings an owner and remediation or
mitigation decision under the security policy. They should appear in dated release/build evidence.
Do not make the entire existing `Test` job required merely because it contains `npm audit`:
that would also enforce the test and quality checks the maintainer declined. The separate scheduled
security evidence workflow reports whole-tree results without blocking unrelated PRs automatically.
Retain current workflows until any such extraction is implemented and verified.

**Enforcement:** a required scanner must report for normal and Release Please PRs; missing or
failed analysis is not a clean result. Verify behavior using harmless fixtures or policy checks,
without installing real malware. Document narrowly scoped exceptions with a reason, owner and
review date. Keep the existing non-gating release SBOM/container-scan contract.

## What is already present, and what needs correction

Inspected source baseline: [`38910bbf`](https://github.com/arc-mcp/arc-1/tree/38910bbf0cea9027cbe6e69fc2749820cd9c2993).
Published release examined: [v1.2.0](https://github.com/arc-mcp/arc-1/releases/tag/v1.2.0),
published 3 September 2026, source commit `f492794ddcd82bfbb4a726091e01d57567380d5a`.
Live GitHub/npm metadata was read on 7 September. Settings are independent of the source revision.

| Area | Evidence observed | Implication for enterprise approval |
|---|---|---|
| Dependency coverage | Root lockfile has 365 package entries excluding the root, 187 not marked `dev`; `package.json` has 20 direct production dependencies. Separate AppRouter lockfile. | Counts are lockfile entries, not unique packages or the installed graph. Include transitive, optional, build, AppRouter, native and OS components in scope. |
| Updates | Dependabot covers root/AppRouter npm, Actions and Docker; alerts and security updates confirmed enabled | Good existing baseline; an enabled updater is not a patch-response guarantee. |
| Dependency checks | Root/AppRouter npm audit fails on high/critical and omits optional dependencies. Dependency Review checks changes and selected license denials. | Document the exact scope. CI audit runs after `npm ci`, so it cannot prevent a malicious lifecycle script from executing during installation. |
| CodeQL | Default setup configured, weekly schedule | SAST is present; the earlier page's claim that high findings necessarily block PRs was not supported by effective rules. |
| Merge enforcement | `GET /repos/arc-mcp/arc-1/rules/branches/main` returned PR/deletion/non-fast-forward rules, no `required_status_checks` or `code_scanning` rule; required human approvals were zero | Highest-priority governance gap. A failing workflow is not currently demonstrated to be an enforced merge gate. A solo maintainer can require checks without inventing a second reviewer. |
| Secret protection | Secret scanning, push protection and private vulnerability reporting confirmed enabled | Retain the date and recheck periodically. Grouped-security-update/malware-specific toggles were not independently reverified. |
| npm provenance | Registry advertises provenance for 1.2.0; registry `gitHead` matches the release commit | Evidence is present, but this research did not cryptographically verify the complete chain. |
| npm SBOM | `arc-1-1.2.0-sbom.cdx.json` exists, 130,544 bytes; release API digest `sha256:69db074bf947c79fe570858558d19fd3a2f93c2e4eb38c0faf39f4cd27a2147c` | Best-effort production lockfile inventory, with important distribution limits below. It is not a full SBOM for every artifact. |
| Container scanning | Release images scanned by digest/platform, non-gating; scheduled job rebuilds current source for amd64/arm64 and fails on high/critical | A clean rebuilt image does not show that the already-published or customer-deployed digest is clean. |
| Container runtime | Non-root user, multi-stage build, production dependency pruning, npm CLI removed, runtime Alpine packages refreshed | Useful minimization; record actual image/buildpack/Node versions in release evidence. |
| Action integrity | Docker, Trivy and release-please actions SHA-pinned; several GitHub-owned actions remain tag-pinned | Extend immutable references to all actions and review downloaded build tools. “All workflows have a top-level read-only token” was too broad. |
| Assurance | Public threat model and June/July remediation record, explicitly maintainer-led and AI-assisted | Valuable engineering evidence; no independent audit or certification was established by this review. |

Local sources: [release workflow](../../.github/workflows/release.yml),
[test workflow](../../.github/workflows/test.yml),
[Dependency Review](../../.github/workflows/dependency-review.yml),
[scheduled scan](../../.github/workflows/security-scan.yml),
[Dockerfile](../../Dockerfile), [package manifest](../../package.json),
[security model](../security-model.md), [review record](../security-review-2026-06.md).
The latest observed [scheduled run](https://github.com/arc-mcp/arc-1/actions/runs/33867086907)
was successful on 4 September; that is a historical run result, not a current artifact clearance.

### The npm reproducibility gap deserves special prominence

The actual 1.2.0 npm tarball contains neither `package-lock.json` nor `npm-shrinkwrap.json`.
The published manifest uses dependency ranges. An exact top-level version therefore does not
guarantee that a customer's fresh installation matches the release SBOM or CI-tested tree.
This follows npm's documented [lockfile behavior](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).

| Distribution choice | Benefit | Work and tradeoff |
|---|---|---|
| Docker image pinned by digest | Immediate stable artifact identity, including its OS/native contents | Secondary distribution path for this audience; publish architecture-specific inventories and rescan retained digests. Customers must approve updates. |
| Customer-controlled source/BTP build with lockfiles | Fits enterprise build pipelines, approved registries and BTP deployment | Preferred path for the stated customer audience. Retain source commit, Node/npm/buildpack versions, lockfiles, MTAR identity and build/staging evidence. |
| Publish `npm-shrinkwrap.json` | Locks downstream npm resolution for a CLI/daemon | Evaluate in a separate packaging change; npm supports this use case. Test clean installs, platforms, native modules, overrides and downstream library consumption. Maintainer must ship dependency patches promptly. |
| Bundle more JavaScript dependencies | Reduces resolution variance and runtime dependency surface | Higher engineering effort; native SQLite, licenses and scanner visibility need care. Not the first quick win. |

See [npm shrinkwrap documentation](https://docs.npmjs.com/cli/v11/configuring-npm/npm-shrinkwrap-json/).
ARC-1 also exposes library entry points, so shrinkwrap needs compatibility testing rather than an
unreviewed file rename. For MCPB, generate inventory **after** removing `better-sqlite3`. For BTP,
include the optional AppRouter separately. Include `@arc-mcp/xsuaa-auth` in dependency review and
security assessment: extracted authentication logic remains part of the product boundary.

## Implementation order for one developer

The following are proposed engineering tasks, except the documentation changes identified as
completed below. Estimates include focused verification but not unpredictable remediation.

| Priority | Concrete task and acceptance evidence | Initial effort | Recurring burden / cash |
|---|---|---|---|
| P0 | Enforce the proposed dependency and CodeQL security checks on `main`; export rules and demonstrate a harmless security-check failure blocks a PR. Audit bypasses. | 1–2 days including release-PR behavior | Review on workflow changes; €0 additional license for this public repository |
| P0 | Publish the security overview, dependency page, ownership/data flow, evidence dates and honest gaps | Completed locally in this change | Refresh per release and material control change |
| P1 | Add BTP-oriented release evidence: version, source commit, lockfile/SBOM hashes, build-tool versions, scan time/DB version, exceptions and completeness; define customer MTAR/staging evidence | 1–2 days | Automated generation; short release review |
| P2 | For Docker consumers, scan retained supported release digests in addition to fresh builds; report per architecture | 0.5–1 day | Automated; triage findings, do not silently replace an approved tag |
| P1 | Produce source-build root and optional AppRouter inventories with explicit build/runtime scope; document staging evidence. Image/MCPB-specific inventories follow for those consumers | 1–2 days | Automated; schema/scope validation and occasional tool maintenance |
| P1 | Apply for Socket OSS and calibrate dependency behavior checks; cover ARC-1 and the auth package where eligible | 0.5–1 day plus observation | Target 30–60 minutes/week for routine triage; incidents can take much longer; €0 if accepted |
| P1 | Verify phishing-resistant maintainer authentication, recovery and OIDC-only release access; inventory old tokens | 0.5 day | Recovery exercise; €69.02 example for two basic security keys if needed |
| P2 | Pin remaining action references, verify downloaded build-tool checksums, explicitly document routine dependency cooldown and emergency exception | 0.5–1 day | Dependabot/review upkeep |
| P2 | Add a dependency triage/exception record and trial OpenSSF assessment | 1–2 days | Short weekly triage; quarterly evidence review |
| Later | npm shrinkwrap for registry consumers and customer-driven LTS/support | Separate scoped projects | Driven by actual procurement blockers; external assurance is outside the chosen plan |

**Required-check gotcha:** the release workflow documents that Release Please PRs created with
`GITHUB_TOKEN` do not trigger the ordinary PR test workflow. Turning on required checks without
fixing that lifecycle can strand release PRs. First demonstrate that every required check runs
on normal and release PRs, using a supported triggering/authentication approach with minimal
permissions. Avoid a permanent blanket bypass. Require only the selected security checks;
preserve the separate existing release-time test gate.

**Release evidence gotcha:** repository instructions deliberately require the npm SBOM job and
release container scan to stay non-gating. Preserve that contract. Add a separate evidence
completeness/approval result so consumers can require a complete evidence set before promotion.
A missing SBOM should say “missing,” and scanner failure should say “scan unavailable,” never
“clean.” A future release-promotion redesign should be explicit and tested across all artifacts.

**Signing research, outside the selected plan:** npm provenance already exists. BuildKit
provenance metadata is not the same as an independently verified publisher signature, and
adding a signature does not establish a particular SLSA level. Existing provenance should be
described accurately; new signing work is not scheduled.
[Docker attestations](https://docs.docker.com/build/ci/github-actions/attestations/),
[GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

## Tool choices and verified costs

Prices and program terms were checked on 7 September 2026. Vendor eligibility is not acceptance.
No applications, messages, installations, purchases or account-setting changes were made.

| Option | Current price / access | Recommendation for ARC-1 |
|---|---|---|
| GitHub Dependabot, Dependency Review, CodeQL, secret protection | Public-repository features already available/observed | Keep as the baseline; make required checks effective. [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review) |
| Socket OSS Business program | Free for public OSS under a valid OSI license; sign up and request upgrade with GitHub organization | Best first additional service: dependency behavior/reachability and Actions scanning complement CVE checks. [Program announcement, 7 August 2026](https://www.socket.dev/blog/free-business-plan-upgrades-for-open-source) |
| Socket paid | Monthly Team $25/developer, **minimum 5**: $125/month, $1,500/year at monthly billing. Business $50/developer, minimum 20. Products/annual billing affect price. | Do not mistake $25 for a solo subscription. Prefer OSS eligibility. [Pricing](https://socket.dev/pricing) |
| Snyk OSS | Free full entitlements for qualifying OSS, but projects must have no corporate backing, provide backlinks and grant specified logo/content use | Conditional alternative where it reduces triage. Confirm commercial/company eligibility. [Program terms](https://snyk.io/open-source/) |
| Snyk paid | Team starts at $25/month per contributing developer; not a confirmed all-in solo quote | Trial free/OSS first; pay only for demonstrable incremental coverage or time saved. [Plans](https://snyk.io/plans/) |
| Trivy | Apache-2.0 open source; no scanner license fee | Already used; extend actual artifact coverage before adding another scanner. [Official project](https://github.com/aquasecurity/trivy) |
| OSV-Scanner | Apache-2.0 open source; no scanner license fee | Portable second opinion/offline option; avoid duplicating every scheduled scan without a reason. [Official project](https://github.com/google/osv-scanner) |
| OpenSSF Scorecard and Best Practices/Baseline | Free automated checks and voluntary self-assessment | Add evidence, then a badge that accurately states its assessment type. [Scorecard](https://securityscorecards.dev/), [badge program](https://openssf.org/projects/best-practices-badge/) |
| CSA STAR | Basic self-assessment complimentary; optional AI validation $595 | Relevant mainly to a hosted service. Skip paid AI validation now; it is not an independent audit. [CSA program](https://cloudsecurityalliance.org/star/) |
| SIG questionnaire subscription | $7,000/year corporate license shown | Skip purchasing. Answer customer-provided questionnaires under their terms using your reusable evidence. [Shared Assessments](https://sharedassessments.org/sig/) |

Socket's signals include install scripts, network access, obfuscation and suspicious ownership
changes; legitimate packages may trigger them. Start with advisory visibility, measure false
positives, and promote confirmed-malware/high-confidence categories after validation. Do not
test the integration by installing real malicious packages. [Socket FAQ](https://docs.socket.dev/docs/faq).

GitHub introduced a default **three-day cooldown for routine version updates** on 14 July 2026;
security updates still open immediately. ARC-1 has no explicit override in the reviewed config.
An explicit 3–7-day routine policy can make the decision reviewable; it is not an entirely new
protection. It also does not constrain arbitrary manual `npm install` or `npx` resolutions.
[GitHub announcement](https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown/).

Retain Dependabot unless a concrete Renovate-only workflow becomes necessary. Defer commercial
SBOM hosting, an additional SAST dashboard, managed bug-bounty platforms, and enterprise SCA
suites until a buyer or measured triage cost requires them. A plain versioned evidence page and
release assets can serve the initial trust-center purpose without another subscription.

Socket Firewall Free is a separate decision from the GitHub application: its documented limits
include no private-registry support, non-disableable telemetry, cached-package bypass of network
interception, confirmed-malware blocking and warning-only AI detections. It is not a blanket
recommendation for customer environments. [Official documentation](https://docs.socket.dev/docs/socket-firewall-free).

## Budget after maintainer feedback

Use free public-repository controls and the Socket OSS program first. No external review, pentest
or certification spend is planned. Buy account-protection hardware only if needed; the observed
German Yubico price was €34.51 including VAT for Security Key C NFC, or €69.02 for two before
shipping. [Yubico store](https://www.yubico.com/de/store/).

Keep the remainder unallocated until a paid tool demonstrates useful additional findings or
reduces recurring work. Do not buy overlapping scanners or a trust-center subscription solely
for a badge. If considering a subscription, compare minimum seats, billing period, tax, FX,
privacy/access requirements and triage time.

Historical research only: a full manual ARC-1 pentest at €300–500 was not verified. One vendor
advertises testing from €849/tester-day and describes typical engagements of 4–12 days; this is
not a vendor endorsement or a market-wide minimum. External review is excluded from the current
plan at the maintainer's request.
[Budget Security pricing, updated June 2026](https://www.budgetsecurity.com/pentest-pricing/).

## Enterprise evidence beyond dependency scanning

Use a short evidence matrix inspired by
[MVSP](https://mvsp.dev/mvsp.en/) and
[NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final): implemented, partial,
customer-owned, or not applicable with a reason. Include a source link, date and owner per row.
This is a mapping, not certification. Full MVSP conformity includes annual comprehensive external
penetration testing; do not claim it merely because a checklist was filled out.

The reusable customer pack should contain:

- Deployment/data flow: SAP → ARC-1 → MCP client → model provider, with logs/cache, identity
  services, network endpoints, data classifications and retention responsibilities.
- Authorization evidence: negative tests for write/data/SQL gates, package restrictions, and
  two-user isolation. For strict PP, show SAP sees the correct user. AI review counts are not an
  independent human review control.
- Release evidence: exact artifact identity, relevant SBOM, dated scan result, known exceptions,
  provenance/signature verification instructions and upgrade/rollback procedure.
- Vulnerability operations: private reporting, supported line, advisory/affected/fixed versions,
  triage owner, response targets, mitigation and customer rollout ownership.
- Maintainer continuity: realistic availability, release-account recovery, reproducible handover,
  and an emergency contact/backup reviewer if one is actually arranged. Open-source availability
  does not itself supply a staffed support service.

Self-hosting is valuable because the customer controls infrastructure and SAP connectivity, but
does not prevent results becoming model input. Review the client's provider terms, retention,
training policy, data region and other tools. Model approvals complement server enforcement;
they do not replace it. [MCP security principles](https://modelcontextprotocol.io/specification/2025-11-25#security-and-trust-safety).

For dependency exceptions, keep affected artifact digest/version, advisory, component, exposure
analysis, mitigation, owner, review date and expiration. Publish an evidence-backed VEX statement
when useful; distinguish “not affected” from “not yet investigated.” Do not automatically turn a
reachability tool's result into a permanent suppression, especially for dynamic JavaScript or auth
dependencies. [OpenVEX specification](https://github.com/openvex/spec).

Be candid about support: the current policy supports only the latest published 1.x minor line
and gives best-effort response targets. Some enterprises will need overlapping support or
contractual incident coverage. Offer an LTS line or support contract only after pricing the
backport/testing workload and arranging realistic coverage. A customer-funded pilot or SAP
service partner is more feasible than promising 24/7 support as one developer.

### Certifications, assurance levels and regulation

| Option | What it can establish | Decision |
|---|---|---|
| OpenSSF Baseline 1/2/3 or passing/silver/gold | Voluntary self-asserted project practices, supported by evidence | Do the assessment; publish only earned/accurate results. No invented target score. |
| Independent scoped review | An external review of named code/controls at a named revision | Not selected by the maintainer; do not advertise independent assurance. |
| ISO/IEC 27001 | An organizational information-security management system | Pursue when a qualified opportunity requires it and funds maintenance/audit costs. [ISO](https://www.iso.org/standard/27001) |
| SOC 2 | CPA assurance reporting on scoped organizational/service controls | More relevant if ARC-1 becomes a hosted service/provider. A tool subscription does not buy the report. [AICPA](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services) |
| SAP certification or partner assessment | Program-specific SAP assurance | No relevant program scope, eligibility or price verified here. Do not claim SAP certification; ask a buyer for the exact required program before spending. |

**EU CRA timing is relevant now.** The European Commission states that Article 14 reporting
obligations apply from **11 September 2026**, and general application begins **11 December 2027**.
Free distribution alone does not establish exemption: commercial activity and the actual role
matter, with distinct provisions for open-source stewards. Prepare a factual note on who develops,
markets, distributes and supports ARC-1 and whether paid activity is involved. If applicability
is unclear, record it as an unresolved question rather than claim compliance.
This research does not determine ARC-1's classification or certify compliance.
[European Commission CRA summary, updated 3 December 2025](https://digital-strategy.ec.europa.eu/en/policies/cra-summary).

## A feasible first month and how to judge success

Treat this as roughly **6–10 focused engineering days** spread across a month, starting with the
highest-value items; slower packaging changes for other distribution paths can follow. Estimates in the
task table overlap and should not be interpreted as a commitment to complete every item in that month.

| Period | Focus | Completion evidence |
|---|---|---|
| Week 1 | Publish corrected docs, establish actual buyer requirements, enforce selected security checks without breaking release PRs | Security entry visible from home/README; recorded rules; harmless security-check failure prevents merging |
| Week 2 | BTP source/build identity, root/AppRouter SBOM scope, staging-evidence guidance | A customer can tie its approved commit to its MTAR and record the separate CF runtime inputs |
| Week 3 | Socket OSS evaluation, maintainer credential/recovery check, remaining action pins | Real dependency PR receives the intended analysis; no account/app control claimed until verified |
| Week 4 | Try the plain-language assessment with a customer, refine the triage/exception process and optionally assess OpenSSF gaps | A human can complete an approval record using linked evidence; remaining questions have owners |

Track median days from questionnaire receipt to security approval, number of unanswered controls,
releases with complete artifact evidence, age of applicable high/critical findings, and weekly
triage time. Record independent-review requirements separately from nice-to-have badges. Compare
the first three pilots before purchasing recurring tooling. This makes acceptance improvement
observable without inventing an adoption percentage.

## Changes prepared in this branch

- New [Security & Trust](../../docs_page/security.md) overview linking the assessment,
  data flow, ownership and assurance boundaries.
- New [Security Assessment](../../docs_page/security-assessment.md) with plain questions and
  answers, customer decisions, a checklist, and a copyable approval record for BTP deployments.
- New [Dependency & Release Security](../../docs_page/dependency-security.md) page with dated
  evidence, artifact differences, enforcement limitations and corrected verification commands.
- Prominent security navigation, homepage/README links and machine-readable documentation links.
- Existing hardening page and section 13 URL retained; dependency content points to its new home.
- Existing supported-version policy clarified so the table no longer suggests all 1.x minors
  receive fixes, and response targets are consistently described as best-effort.

The branch now also contains the workflow/tooling changes described in the implementation plan.
It does not activate repository rules, install Socket, add signing, change existing release gates,
purchase services, establish independent assurance, or publish the site before merge.

## Evidence method and limitations

Discovery covered repository docs, manifests, workflows, packaging, GitHub settings/rules and
release APIs; official procurement/standards material; vendor pricing and OSS-program terms.
Follow-up resolved the high-impact gaps: merge enforcement, actual npm tarball contents,
released SBOM presence, free-program restrictions, minimum seats, current cooldown behavior,
certification scope and CRA dates. Source links appear next to the claims. Undated product/docs
pages are living sources accessed on 7 September 2026; dated sources are identified in the text.

The legacy branch-protection endpoint returned 404, so the effective rules endpoint was checked
instead; that 404 is not evidence that rulesets are absent. CISA-hosted pages returned 403 for some
requests; the Secure by Demand guidance was available from co-publisher FBI. The original research did not perform a full dependency
vulnerability audit; implementation subsequently exercised root/AppRouter lockfile audits. No artifact
signature verification, production penetration test, private account
installation audit, or customer questionnaire review was performed. No exact certification quote
or suitable full pentest at the proposed budget was verified.

Research stopped after these consequential questions had primary evidence or a stated limitation.
More broad scanner comparisons are unlikely to change the immediate order. The next material
inputs are actual customer approval conditions, Socket/Snyk eligibility, and validation of the customer BTP build/staging process.
