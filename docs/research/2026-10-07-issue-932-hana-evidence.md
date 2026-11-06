# NHI discovery is not evidence of a HANA database

Issue [#932](https://github.com/arc-mcp/arc-1/issues/932) reports the false positive
on two Oracle-backed ECC systems with SAP_BASIS 750 SP23, through BTP principal
propagation. Its root cause is the final fallback in `probeFeatures`: an NHI
collection promotes an unsuccessful HANA check to `available: true`. The original
[#195](https://github.com/arc-mcp/arc-1/pull/195) established NHI presence on a HANA
system, which does not establish exclusivity to HANA.

## Independent reproduction and result

Research date: 2026-10-07. The installed MCP server reported NHI-only HANA
availability on NPL 750 SP02. Its local setup dossier records the database as ASE;
plain SAP_BASIS/SAP_BW components do not establish HANA. The source at main
`907b02c05c9a912ceb126ca712fff510d7c91a3b` contains the same fallback.

The corrected working tree based on that revision was built with Node 24.11.1.
Both final checks invoked the built CLI's `SAPManage(action="probe")` against
verified HTTPS with direct Basic authentication and client 001. Writes, SQL and
data preview were disabled. No SAP objects were changed.

| Target | Final automatic HANA result |
| --- | --- |
| NPL, SAP_BASIS 750 SP02 | `available: false`; "HANA database is not confirmed"; retains the hanainfo 404 and explains that NHI does not identify the database |
| A4H, SAP_BASIS 758 SP02 / S4FND 108 | `available: true`; inferred from installed components when hanainfo is absent |

A4H used `https://a4h.marianzeis.de` through port 443, without a SAP port suffix.
Fresh component/lint probes confirmed both release levels. No credentials or
user-specific responses are needed to reproduce the unit tests.

## Regression and review evidence

Four new expectations failed against unchanged runtime code: NHI with empty
components, NHI with plain 750 components, and NHI after hanainfo 401/403. They
pass after the fix. Explicit on/off overrides and discovery MIME data remain
covered, alongside existing positive endpoint/component cases.

- 128 focused feature/discovery tests passed.
- Complete unit suite: 258 files, 7,843 tests passed.
- Typecheck, lint, policy validation, size/schema budgets, build and diff checks passed.
- Independent plan and implementation review found no remaining actionable issues.

The fix retains the existing boolean model. An unconfirmed result does not assert
that HANA is absent; an operator with independent evidence can set
`SAP_FEATURE_HANA=on`. No new discovery requests, release heuristics, SQL access,
or authorization changes are introduced.

## Coverage limits and roadmap

Oracle SP23 and BTP principal propagation remain reporter evidence, not fresh
maintainer tests. SAP_BASIS 816 was unavailable because its SAP license check
refused logon. Generic feature-probe treatment of HTTP 400/500 is unchanged and
outside this demonstrated NHI defect.

Roadmap checked before and after: no roadmap impact.
