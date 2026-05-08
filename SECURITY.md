# Security Policy

ARC-1 is an enterprise MCP server for SAP ABAP systems, distributed as an [npm package](https://www.npmjs.com/package/arc-1) and a [Docker image](https://github.com/marianfoo/arc-1/pkgs/container/arc-1) and deployed on SAP BTP Cloud Foundry, Docker hosts, and on-premise servers. Security reports are taken seriously — please follow this policy when reporting.

## Supported Versions

Pre-1.0 (current state): only the latest published minor line receives security fixes.

| Version | Supported              |
| ------- | ---------------------- |
| 0.8.x   | :white_check_mark:     |
| < 0.8   | :x: — please upgrade   |

After 1.0, this table will reflect the documented support window for each major.

## Reporting a Vulnerability

**Preferred — GitHub Private Vulnerability Reporting:**
[Open a private advisory](https://github.com/marianfoo/arc-1/security/advisories/new). This routes the report directly to the maintainers, keeps it confidential, and gives us a private workspace to coordinate the fix.

**Fallback — email:**
`marianbsp@gmail.com`. Please include "ARC-1 security" in the subject line. If you need to send encrypted email, request a public key in the first message.

**Please do _not_** open a public GitHub issue, post on the SAP Community, or share details on social media until a fix is published. Coordinated disclosure protects users running affected versions.

## Response Times (best-effort, non-contractual)

| Stage                                  | Target                  |
| -------------------------------------- | ----------------------- |
| Acknowledgement of report              | within 3 business days  |
| Initial triage and severity assessment | within 7 business days  |
| Critical fix or mitigation             | within 14 days          |
| High fix or mitigation                 | within 30 days          |
| Moderate fix or mitigation             | within 60 days          |
| Low fix or mitigation                  | best-effort             |

Severity follows [CVSS v3.1](https://www.first.org/cvss/v3-1/specification-document) where applicable.

## CVE Handling

Confirmed vulnerabilities receive a [GitHub Security Advisory (GHSA)](https://github.com/marianfoo/arc-1/security/advisories) and, where applicable, a CVE assigned via GitHub's CNA. Patches publish through the normal release flow ([release-please](https://github.com/googleapis/release-please) → npm + ghcr.io); the advisory marks affected versions and the fixed version. Where the patch warrants user action (e.g., config change), the advisory and the release notes call it out explicitly.

## Out of Scope

- **SAP system vulnerabilities.** ARC-1 is a client of SAP ADT APIs. Vulnerabilities in the SAP system itself (NetWeaver, S/4HANA, BTP ABAP Environment, Cloud Connector) belong to SAP — please report via [SAP's responsible-disclosure channel](https://www.sap.com/about/trust-center/security/incident-management.html).
- **Upstream dependency vulnerabilities** with no ARC-1-specific exposure (i.e. the upstream advisory does not impact how ARC-1 uses the dependency). Please report upstream to the affected project. ARC-1 tracks affected upstream advisories via Dependabot.
- **Theoretical vulnerabilities** without a concrete exploitation path against ARC-1's documented usage. We're happy to discuss design hardening, but those discussions belong in [GitHub Discussions](https://github.com/marianfoo/arc-1/discussions) or a regular issue, not the private advisory channel.
- **Issues in unsupported versions** (see Supported Versions above).

## Safe Harbor

ARC-1 supports good-faith security research. Researchers acting in good faith and following this policy will not face legal action.

We commit to:
- Responding within the timelines above.
- Working with you to reproduce and understand the issue.
- Crediting you in the resulting GHSA / CVE if you wish (or honoring an anonymous-disclosure request).
- Not pursuing legal action against research conducted in accordance with this policy.

## Hardening Recommendations for Operators

This policy covers vulnerability *reporting*. For runtime hardening recommendations (auth modes, safety flags, audit logging, network policy, secrets management, incident-response playbooks), see the [Security Best Practices Guide](https://marianfoo.github.io/arc-1/security-guide/).
