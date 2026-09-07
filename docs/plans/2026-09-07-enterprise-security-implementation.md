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
- [x] Update dependency documentation to describe the implementation in this PR and pending
      account activation, without presenting the latter as enabled.

Acceptance: strict MkDocs build; internal links and retained anchors resolve; browser review
of the overview, dependency page and copyable assessment template.

### 2. Separate dependency security from license policy

- [x] Use the verified Dependency Review v5.0.0 commit rather than the unresolved `v5` tag.
- [x] Create a stable `Dependency security` job that checks runtime, development and unknown
      scopes; fails for introduced high/critical vulnerabilities; does not check licenses.
- [x] Keep existing license policy in a separate job, excluded from required status checks.
- [x] Keep PR analysis read-only, without package installation, lifecycle execution, secrets,
      PR-comment write permissions or path/title filters.
- [x] Record the root and optional AppRouter graphs as in-scope.

Acceptance: workflow validation and contract tests; GitHub runs the named check on this PR.
Current full-tree npm audits and release SBOM/container behavior remain unchanged.

### 3. Prepare reliable enforcement and release PR events

- [x] Preserve Release Please's built-in `GITHUB_TOKEN` and existing publication behavior;
      no dedicated App, new token or additional secret. Keep npm publication on existing OIDC credentials.
- [x] Document GitHub's native maintainer approval for bot-created PR workflows and verify
      that the existing release PR shows the expected approval wait.
- [x] Add an importable, initially disabled security ruleset: required `Dependency security`
      from GitHub Actions; CodeQL `high_or_higher` security threshold and ordinary alerts `none`.
- [x] Document workflow approval, normal/release PR verification, activation and rollback.

Acceptance before activation: successful checks on normal and approved bot-created release PRs;
CodeQL results for the intended revisions; no missing mandatory checks; no blanket bypass.
The PR cannot prove execution after approval or activate the new workflow definition on release
PRs before it is on `main`. Approval and successful current-revision checks are post-merge verification.

### 4. Generate BTP source dependency evidence

- [x] Add `npm run security:evidence` without adding a runtime dependency.
- [x] Record source commit, dirty state, Node/npm versions, timestamps and input hashes.
- [x] Generate root and AppRouter CycloneDX inventories with separate full and production
      scopes, using lockfiles without installing packages or running lifecycle scripts.
- [x] Audit both full lockfile graphs, including optional/build dependencies; distinguish
      findings from unavailable/invalid scans. Save a readable summary and machine-readable data.
- [x] Optionally hash a customer-supplied MTAR; explain that its relationship to the source
      and its actual staging inputs still require the customer's build record.
- [x] Reject reused output directories and incomplete or changed input evidence; keep generated
      output gitignored. Do not collect CF environment, service keys or unfiltered command logs.
- [x] Add a separate scheduled/manual workflow with dated downloadable evidence. It is not
      a required PR check and does not change release publication gates.
- [x] Link the command from dependency documentation; leave deployment commands in the canonical
      BTP runbook. Add a short staging worksheet for the human operator.

Acceptance: real lockfile generation on this checkout; tests for vulnerable, clean, missing,
malformed, mismatched and changed-input cases; no lifecycle execution; hashes validate and
missing evidence is never labelled clean. No claim to inventory the final CF droplet or OS.

### 5. Prepare Socket and routine maintenance

- [x] Add minimal Socket configuration with all PRs eligible and no manifest exclusions.
- [x] Document OSS application and installation for ARC-1 and the auth repository where eligible.
- [x] Specify malware blocking and initial warnings for behavioral signals; inspect dashboard
      defaults, repository overrides and existing resolutions before enforcing.
- [x] Provide a short vulnerability/exception record: finding, affected versions, applicability,
      decision, owner, mitigation and review date. Do not create automatic blanket exceptions.

Acceptance after installation: root and AppRouter visible in the App, intended results on a
real dependency PR, exact check name and App identity recorded, policy calibrated. Socket reported successfully on PR #765; its PR alert analysis skipped because no dependencies changed.
Socket is not a required check until policy and blocking behavior are verified. Application approval and installation remain account actions;
no paid subscription is needed for this implementation and no application email is sent by it.

### 6. Review, test and publish the PR

- [x] Commit the initial plan/documentation, integrate current `main`, then implement.
- [x] Run focused evidence/workflow/BTP documentation tests, type checking, formatting and
      strict documentation build. Run relevant existing release and container contract tests.
- [x] Exercise the actual evidence command, inspect generated scope/hash/status data.
- [x] Push the branch and create one new PR with purpose, validation and activation boundaries.
- [x] Review every changed file against this plan, including workflow trust/permission boundaries.
- [x] Inspect GitHub checks and reviewer feedback; reproduce actionable failures and fix them.
- [x] Push corrections as new commits and update the PR description to reflect the final result.

## After merge: maintainer checklist

1. Keep the existing Release Please token. On its next release PR update, review the changes,
   select **Approve workflows to run** if prompted, and verify current dependency and CodeQL
   results. Do not dispatch `Release` to test this: its manual trigger publishes npm.
2. Follow the security operations runbook to import the disabled ruleset, verify the observed
   check names and results, then enable it. Export and date the effective rules afterwards.
3. Verify the existing Socket installation and OSS entitlement, then calibrate its policy. Add
   its observed check to the ruleset only after verification.
4. Run the evidence command for an approved clean source revision; retain the output with the
   MTAR/build record and complete the customer staging worksheet.
5. Try the assessment with one enterprise customer. Record unanswered questions and actual
   approval blockers; use those to prioritize further spending.

The detailed account steps and rollback procedure are in [security operations](../security-operations.md).
Allow roughly 2–4 focused days for this first implementation and review, plus customer/vendor
waiting time. These are planning estimates, not a commitment or a measured adoption uplift.

## Implementation validation record

- Initial evidence/workflow tests: 17 passed. Existing release, container, MTA and CI contracts: 31 passed.
- Type checking, actionlint for the three changed workflows, strict MkDocs build and diff whitespace checks passed.
- Actual root and AppRouter lockfile audits completed with zero reported vulnerabilities on 7 September 2026.
- npm SBOM display names can follow checkout directories; package URL/version validation handles this without rewriting the inventory.
- Final PR review, current-commit CI results and any subsequent corrections are recorded below when complete.
- Account activation and customer BTP staging remain the explicit post-merge steps above.

### Post-push review

- PR: https://github.com/arc-mcp/arc-1/pull/765.
- Full local suite on initial implementation: **5,789 tests across 196 files passed**.
- Clean-checkout evidence on npm **11.11.1** completed: four inventories and both audits; zero vulnerabilities reported by the registry on the collection date. An earlier collection overlapped a commit and correctly marked its input/source state inconsistent; rerunning on the stable commit passed.
- Socket App **156372** already delivers checks. The project report passed; PR alert analysis skipped because the PR has no net dependency changes. Policy, graph coverage and OSS entitlement remain unverified. The account runbook now reuses that installation.
- Review added direct CLI subprocess coverage for exit codes 0/1/2 and refusal to overwrite previous evidence, plus dependency-declaration drift coverage. It also improved safe preflight error messages for human operators.

- Post-review focused suite: **22 tests passed**, including four CLI subprocess scenarios. Type checking, lint and strict documentation build passed again.
- Initial PR commit `cd843284` passed GitHub Dependency security, Dependency licenses, CodeQL, documentation, MTA validation, and Node 22/24 jobs. Live SAP jobs skipped under the existing `chore:` policy; no SAP runtime behavior changed.
- Post-review corrections are a separate commit. The PR checks show the authoritative result for its latest head.
- The workflow summary now links directly to its downloadable evidence artifact; folder-relative JSON links remain in the downloaded report rather than pointing to missing files on the run page.
- Release automation follow-up: retained the built-in token and documented native bot-workflow approval. The parsed Release workflow exactly matches `origin/main`; only explanatory comments differ. All 26 focused workflow/release tests, type checking and the strict documentation build passed. Release PR #751 confirms the `action_required` wait; execution after approval and ruleset activation remain pending.
