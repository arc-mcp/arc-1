export function formatSummary(evidence) {
  const result = !evidence.complete
    ? 'INCOMPLETE — do not treat unavailable scans as clean.'
    : evidence.highOrCritical > 0
      ? 'REVIEW REQUIRED — high/critical vulnerabilities were reported.'
      : 'All requested scans completed; no high/critical vulnerabilities were reported.';
  const rows = evidence.checks
    .map((check) => {
      const detail =
        check.status !== 'complete'
          ? 'Unavailable'
          : check.kind === 'audit'
            ? `${check.vulnerabilities.high} high / ${check.vulnerabilities.critical} critical / ${check.vulnerabilities.moderate} moderate`
            : `${check.components} components`;
      return `| ${check.scope} | ${check.kind} | ${detail} | ${check.file ? `[JSON](${check.file})` : 'No valid output'} |`;
    })
    .join('\n');
  return `# ARC-1 dependency evidence

**${result}**

- Source commit: \`${evidence.source.commit}\`
- Working tree: **${evidence.source.dirty ? 'modified — this is not evidence of the committed source alone' : 'clean'}**
- Started: ${evidence.startedAt}; finished: ${evidence.finishedAt}
- Node: ${evidence.tools.node}; npm: ${evidence.tools.npm}
- Recorded input files unchanged during collection: ${evidence.inputsUnchanged ? 'yes' : '**NO**'}

| Dependency graph | Scope | Result | Evidence |
|---|---|---|---|
${rows}

Full inventories and audits include development/build, runtime, optional and peer dependencies.
Production inventories omit development dependencies. AppRouter is reported separately, even
if it will not be deployed. Counts from the two graphs can overlap; they are not unique CVE counts.
Input and output SHA-256 hashes are in evidence.json. The npm registry does not expose an
advisory database version through this command; the collection time is recorded instead.

## What this evidence covers

This is a lockfile inventory and registry vulnerability check. No dependencies were installed
and no package lifecycle scripts were run by the evidence collector. Registry scans send
dependency information to the configured registry. Reviewed exceptions and applicability
decisions must be retained separately; the collector does not suppress findings.

It does not inventory the final Cloud Foundry droplet, buildpack, operating system or actual
runtime. It also does not detect all malicious packages or prove that a build is safe.

## BTP build and staging record — complete with your platform owner

${evidence.mtar ? `MTAR checksum: \`${evidence.mtar.sha256}\` (${evidence.mtar.size} bytes). Its relationship to this source has not been verified.` : 'MTAR: not provided. Supply --mtar FILE to record its checksum.'}

Copy these fields into the customer build/deployment ticket:

- Build job or retained local build log:
- Source commit and approved dependency evidence:
- MBT version and build profile/extension used (keep credentials private):
- MTAR checksum and confirmation it came from this build:
- CF build/staging job or droplet identifier:
- Selected stack, buildpack version, Node and npm versions:
- Installed runtime dependency/OS inventory and scan, if available:
- AppRouter deployed: yes / no; separate staging evidence if yes:
- Applicable findings, mitigation/accepted exceptions, owner and review date:
- Deployment approval and next update/review date:

Do not paste cf env output, service keys or credentials into this record. Keep it with the
customer's build evidence and complete the Security Assessment before approval.
`;
}
