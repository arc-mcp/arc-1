# Enterprise security implementation plan

Date: 7 September 2026. Owner: ARC-1 maintainer.
Decision basis: [research and agreed scope](../research/2026-09-07-enterprise-security-acceptance.md).

## Outcome and scope

Help a customer approve a source build deployed on its own BTP by providing clear security
answers, dependency evidence, and enforceable security checks. Implement through a pull request;
activate account-level controls only after their prerequisites are verified on the merged code.

The selected merge requirements are dependency security and CodeQL high/critical security
findings. Tests, lint, type checking, builds, documentation and license checks are not new merge
requirements. Existing tests and release gates remain. New signing, attestations, external
audits, pentests and certifications are outside scope. Docker/MCPB improvements remain secondary.

## Delivery sequence

### 1. Make the documentation usable for a customer

- [x] Add prominent Security & Trust navigation and links from the homepage and README.
- [x] Separate the overview, dependency evidence, hardening instructions and assessment page.
- [x] Explain the complete client/model/SAP data path and customer responsibilities.
- [x] Provide plain questions, short answers and a copyable approval record.
- [x] Preserve existing hardening links and distinguish dated observations from guarantees.
- [ ] Update dependency documentation to describe the implementation in this PR and pending
      account activation, without presenting the latter as enabled.

Acceptance: strict MkDocs build; internal links and retained anchors resolve; browser review
of the overview, dependency page and copyable assessment template.

### 2. Separate dependency security from license policy

- [ ] Use the verified Dependency Review v5.0.0 commit rather than the unresolved `v5` tag.
- [ ] Create a stable `Dependency security` job that checks runtime, development and unknown
      scopes; fails for introduced high/critical vulnerabilities; does not check licenses.
- [ ] Keep existing license policy in a separate job, excluded from required status checks.
- [ ] Keep PR analysis read-only, without package installation, lifecycle execution, secrets,
      PR-comment write permissions or path/title filters.
- [ ] Record the root and optional AppRouter graphs as in-scope.

Acceptance: workflow validation and contract tests; GitHub runs the named check on this PR.
Current full-tree npm audits and release SBOM/container behavior remain unchanged.

### 3. Prepare reliable enforcement and release PR events

- [ ] Add optional Release Please GitHub App token wiring, restricted to this repository and
      contents/pull-request writes. Keep the current token path until the App is configured.
- [ ] Fail visibly when an App is selected but its key is unavailable; never silently fall
      back after App token creation fails. Keep npm publication on existing OIDC credentials.
- [ ] Add an importable, initially disabled security ruleset: required `Dependency security`
      from GitHub Actions; CodeQL `high_or_higher` security threshold and ordinary alerts `none`.
- [ ] Document installation, normal/release PR verification, activation and rollback.

Acceptance before activation: successful checks on normal and App-generated release PRs;
CodeQL results for the intended revisions; no missing mandatory checks; no blanket bypass.
The PR cannot activate a workflow that is not on `main`, create an App private key, or prove
release-PR triggering without that App installation. These are explicit post-merge steps.

### 4. Generate BTP source dependency evidence

- [ ] Add `npm run security:evidence` without adding a runtime dependency.
- [ ] Record source commit, dirty state, Node/npm versions, timestamps and input hashes.
- [ ] Generate root and AppRouter CycloneDX inventories with separate full and production
      scopes, using lockfiles without installing packages or running lifecycle scripts.
- [ ] Audit both full lockfile graphs, including optional/build dependencies; distinguish
      findings from unavailable/invalid scans. Save a readable summary and machine-readable data.
- [ ] Optionally hash a customer-supplied MTAR; explain that its relationship to the source
      and its actual staging inputs still require the customer's build record.
- [ ] Reject reused output directories and incomplete or changed input evidence; keep generated
      output gitignored. Do not collect CF environment, service keys or unfiltered command logs.
- [ ] Add a separate scheduled/manual workflow with dated downloadable evidence. It is not
      a required PR check and does not change release publication gates.
- [ ] Link the command from dependency documentation; leave deployment commands in the canonical
      BTP runbook. Add a short staging worksheet for the human operator.

Acceptance: real lockfile generation on this checkout; tests for vulnerable, clean, missing,
malformed, mismatched and changed-input cases; no lifecycle execution; hashes validate and
missing evidence is never labelled clean. No claim to inventory the final CF droplet or OS.

### 5. Prepare Socket and routine maintenance

- [ ] Add minimal Socket configuration with all PRs eligible and no manifest exclusions.
- [ ] Document OSS application and installation for ARC-1 and the auth repository where eligible.
- [ ] Specify malware blocking and initial warnings for behavioral signals; inspect dashboard
      defaults, repository overrides and existing resolutions before enforcing.
- [ ] Provide a short vulnerability/exception record: finding, affected versions, applicability,
      decision, owner, mitigation and review date. Do not create automatic blanket exceptions.

Acceptance after installation: root and AppRouter visible in the App, intended results on a
real dependency PR, exact check name and App identity recorded, policy calibrated. Socket is
not a required check until then. Application approval and installation remain account actions;
no paid subscription is needed for this implementation and no application email is sent by it.

### 6. Review, test and publish the PR

- [ ] Commit the initial plan/documentation, integrate current `main`, then implement.
- [ ] Run focused evidence/workflow/BTP documentation tests, type checking, formatting and
      strict documentation build. Run relevant existing release and container contract tests.
- [ ] Exercise the actual evidence command, inspect generated scope/hash/status data.
- [ ] Push the branch and create one new PR with purpose, validation and activation boundaries.
- [ ] Review every changed file against this plan, including workflow trust/permission boundaries.
- [ ] Inspect GitHub checks and reviewer feedback; reproduce actionable failures and fix them.
- [ ] Push corrections as new commits and update the PR description to reflect the final result.

## After merge: maintainer checklist

1. Install/configure the Release Please App and wait for a release PR update that triggers the
   normal dependency and CodeQL analyses. Do not dispatch `Release` to test this: its manual
   trigger publishes npm. Use the next ordinary `main` push.
2. Follow the security operations runbook to import the disabled ruleset, verify the observed
   check names and results, then enable it. Export and date the effective rules afterwards.
3. Apply for Socket OSS, install it for selected repositories and calibrate the policy. Add
   its observed check to the ruleset only after verification.
4. Run the evidence command for an approved clean source revision; retain the output with the
   MTAR/build record and complete the customer staging worksheet.
5. Try the assessment with one enterprise customer. Record unanswered questions and actual
   approval blockers; use those to prioritize further spending.

The detailed account steps and rollback procedure will live in `docs/security-operations.md`.
Allow roughly 2–4 focused days for this first implementation and review, plus customer/vendor
waiting time. These are planning estimates, not a commitment or a measured adoption uplift.
