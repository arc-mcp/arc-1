# Security Assessment

Use this page when deciding whether your team can use ARC-1. It is written for security
reviewers, SAP owners, and BTP administrators. Start with the questions below, then record
your decision at the end. The examples assume you build from the repository and deploy
in your own SAP BTP environment.

!!! note "Review your deployment"

    A feature being available does not mean it is configured in your environment. Record
    the source commit you approve and use the documentation from that revision. The live
    documentation site follows `main` and may describe unreleased changes.

## Questions and answers

### Where does ARC-1 run?

In this deployment, ARC-1 runs in your organization's BTP environment. Your team controls
the deployment, network access, credentials, and updates. The ARC-1 maintainer supplies
the software and documentation.

**Your decision:** identify the BTP owner and the SAP system this deployment can access.
See [BTP deployment options](btp-overview.md).

### Can SAP information leave our environment?

Yes. ARC-1 returns requested SAP information to the connected MCP client. That client
can send it to its AI model provider. Depending on the permitted tools, this can include
source code, metadata, error details, and business data. Hosting ARC-1 on your own BTP
does not by itself keep that information within your organization.

**Your decision:** approve the client and model provider, the information users may access,
and the provider's retention and data-use terms. See the
[data flow and responsibilities](security.md#where-data-goes-and-who-controls-it).

### Whose SAP permissions apply?

With Principal Propagation, each user accesses SAP under their own SAP identity. Signing
in to ARC-1 alone does not establish that mapping. A shared technical SAP account means
users share that account's SAP permissions.

**Your decision:** use Principal Propagation for individual SAP identities and verify the
mapping with users who have different permissions. Follow the
[Principal Propagation setup](principal-propagation-setup.md).

### Can the AI change SAP or read business data?

Writes, table preview, free SQL, transport changes, and Git changes require explicit
configuration. Server restrictions limit what a client can request; SAP authorization
still applies. Package allowlists restrict writes, not all reads. Read-only access can
still reveal source and metadata and create workload in SAP.

**Your decision:** start in a development system with these capabilities disabled. Enable
only the actions needed for the approved use case. See
[authorization and roles](authorization.md) and the [Hardening Guide](security-guide.md).

### How are third-party dependencies checked?

The project uses dependency update automation, vulnerability checks, and CodeQL code
analysis. The [dependency security page](dependency-security.md#controls-and-evidence)
records what is checked and which checks are enforced. A successful scan is evidence
about its scope and date, not a guarantee that no vulnerabilities exist.

For BTP builds, approve an exact source commit and keep the dependency lockfiles. Keep
the build record and MTAR checksum, and record the runtime selected during Cloud Foundry
staging. The optional AppRouter has separate dependencies. A software bill of materials
(SBOM) is a component list that your security tools can scan. The published npm SBOM
does not inventory your complete BTP deployment.

**Your decision:** have the build/BTP owner retain the
[source, build, and staging evidence](dependency-security.md#btp-builds-from-source)
and assess applicable findings before deploying.

### What is logged or stored?

ARC-1 supports audit events and configurable log destinations, including BTP Audit Log.
Redaction reduces sensitive log content, but logs still contain operational information.
An explicitly selected SQLite cache stores source bodies in cleartext.

**Your decision:** choose log access and retention, verify user attribution, and approve
the cache setting. See [audit logging](security-guide.md#9-audit-logging) and
[cache security](caching.md#security).

### Who handles vulnerabilities and updates?

The maintainer accepts private vulnerability reports and publishes security advisories
and fixes under the [security policy](https://github.com/arc-mcp/arc-1/blob/main/SECURITY.md).
Its response targets are best-effort. Your organization decides when to update its own
deployment and who responds to incidents there.

**Your decision:** name an update owner and incident contact. Agree how your team monitors
[advisories](https://github.com/arc-mcp/arc-1/security/advisories) and performs
[updates and rollback](btp-administration.md).

### What assurance can we show our security team?

The project publishes its source, security documentation, threat model, and an engineering
review record. The review is maintainer-led and AI-assisted. These materials do not
establish an independent audit, ISO 27001 certification, a SOC 2 report, or SAP certification.

**Your decision:** check these boundaries against your organization's approval requirements.
The [security overview](security.md#security-posture-at-a-glance) links to the evidence.

## Record your decision

Use the copy button on this template, paste it into your own ticket or document, and fill
in the answers. Mark unanswered items as open. Mark a checklist item `[x]` only after
reviewing your deployment.

```text
ARC-1 security review

Review date and reviewer:
Approved ARC-1 version and source commit:
BTP environment and SAP system/client:
Approved MCP client and model provider:
Deployment/update owner:
Incident contact:

[ ] Client/model provider and permitted information approved
[ ] SAP identity and permissions verified
[ ] Allowed operations and disabled capabilities recorded
[ ] Source, dependencies, build and staging evidence reviewed
[ ] Log access, retention and cache settings agreed
[ ] Updates, advisory monitoring and incident response assigned

Decision: approved / approved with conditions / open
Conditions or unanswered questions:
Next review date:
```

This record supports your organization's approval process. Revisit it when the deployment,
permissions, client/model provider, or software version changes.
