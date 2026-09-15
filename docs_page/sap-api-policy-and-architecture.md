# SAP API policy and ARC-1

Before deploying ARC-1, confirm that your intended use of SAP's endpoints is permitted for your
system and contract. ARC-1's access controls do not establish that permission.

This page summarizes technical considerations; SAP and your organization's contract owners must
resolve the policy questions. Sources checked **2026-09-15**.

## What to confirm

Send your SAP contact the intended system, endpoints, use case, identity flow, and deployment design.
Ask for confirmation of:

1. Whether the specific ADT endpoints and any additional services are permitted for that use.
2. Whether agent-driven tool calls fit an endorsed pathway under your applicable policy.
3. Any limits on data preview, SQL, call volume, or extraction.

Record the answer with the deployment documentation.

## Relevant policy sections

The linked PDF currently identifies itself as **SAP API Policy v.4.2026a**.

| Section | Requirement to check |
| --- | --- |
| §1.1–1.2 | Verify each endpoint's published/documented status and permitted purpose. Exceptions require supporting documentation or SAP authorization. |
| §2.2.2 | Agentic and generative-AI API use, and systematic extraction, are restricted to SAP-endorsed pathways and their limits. |
| §2.1–2.2.1 | Respect API-specific limits and protect system performance, stability, and security. |
| §3 | Do not bypass API controls through proxies, custom code, or other intermediaries. |

Read the [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf)
for the applicable wording. ARC-1 mainly uses `/sap/bc/adt/*`; the existence of an ADT SDK or another
ADT client does not by itself establish permission for your agent-driven use.

## Architecture and operator responsibilities

SAP's [third-party MCP guidance](https://architecture.learning.sap.com/docs/ref-arch/137800)
covers both externally hosted servers and custom servers on BTP. Both remain the operator's
responsibility, including authentication, credential lifecycle, limits, availability, and compliance.
Hosting ARC-1 on BTP does not automatically satisfy those requirements.

For ARC-1, review these controls against your intended design:

| Concern | ARC-1 documentation |
| --- | --- |
| Caller authentication and SAP user identity | [Authentication](enterprise-auth.md), [Principal propagation](principal-propagation-setup.md) |
| Allowed operations and packages | [Authorization](authorization.md) |
| Data access and SQL | [Capability requirements](authorization.md#capability-requirements) |
| Request volume and SAP capacity | [Rate limiting](rate-limiting.md) |
| Audit, deployment, and operation | [Log analysis](log-analysis.md), [BTP setup](btp-overview.md), [Security](security-guide.md) |

The project's [July 2026 architecture assessment](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-07-30-sap-architecture-center-mcp-alignment.md)
records the findings and gaps from that review. It is not a certification or SAP endorsement.

## Managed SAP alternatives

SAP's architecture guidance also describes MCP Gateway in Integration Suite and MCP servers generated
by Joule Studio. Evaluate those paths with your SAP team when selecting an integration architecture.
ARC-1 is an independently operated development-tool server.

For IDE-based ABAP development, see the [comparison with SAP's ADT MCP server](arc-1-vs-sap-abap-mcp-server.md).
