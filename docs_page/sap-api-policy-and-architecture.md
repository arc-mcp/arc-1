# SAP API Policy & Architecture Alignment

**If you choose a custom MCP server such as ARC-1, use SAP's
[Third-Party MCP Access to SAP Solutions](https://architecture.learning.sap.com/docs/ref-arch/137800)
as the primary architecture and control baseline.** It describes the path SAP publishes for
customer-operated MCP access, including custom servers on SAP BTP and external platforms.

!!! tip "The recommended path for ARC-1"
    Start with SAP's Pattern 2: ARC-1 on **BTP Cloud Foundry with XSUAA, strict principal
    propagation, Destination Service, Cloud Connector where needed, and BTP Audit Log**.
    Apply the architecture's governance requirements and verify the permitted SAP APIs and usage.
    Start the technical setup at [BTP: Start Here](btp-overview.md).

    SAP's **API Policy FAQ Q56 expressly allows custom and third-party MCP servers under conditions**;
    Q32 confirms that Integration Suite is not mandatory. Following the reference architecture is
    a practical route toward API-policy compliance, provided the underlying API access, intended
    use, operating controls and applicable agreements also satisfy SAP's requirements.

    ARC-1 already provides many of these controls. Full adherence is not established: its direct
    ADT access needs specific clarification under FAQ Q33, and some architecture requirements
    remain partial or deployment-dependent. See the assessment below.

**Sources checked 2026-10-21:** API Policy **v.4.2026a**, SAP API Policy FAQ **v1.3, June 2026**,
reference architecture 137800, and current Integration Suite documentation. The FAQ is explanatory
and does not amend agreements; SAP says the applicable agreements and product Documentation
prevail in a conflict. This page is a technical assessment, not SAP certification or legal advice.
Source provenance and code evidence are in the
[current research dossier](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-21-sap-api-policy-custom-mcp.md).

## 1. Two questions, often conflated

| Question | Evidence needed | ARC-1's position |
|---|---|---|
| Does the deployment follow SAP's custom-MCP architecture? | Implemented controls and deployment verification against ref. 137800 | Many controls exist; identity, scopes, resilience and operational conditions need the qualification below. |
| Is this API access and intended use permitted? | Applicable agreements, API Policy, product Documentation and any necessary SAP authorization | Custom MCP is a recognized option. ARC-1's direct ADT client is not specifically identified as an endorsed development channel in FAQ Q33. |

These requirements work together. Neither a BTP deployment nor passing security checks authorizes
an otherwise restricted endpoint or use. Equally, custom MCP is not inherently disallowed.
SAP Note [3690029](https://me.sap.com/notes/3690029) also distinguishes clean-core quality and
upgrade stability from API-policy permission; one assessment does not establish the other.

## 2. SAP's recommended architecture, and ARC-1's place in it

The reference architecture describes **Pattern 1: external MCP server** and **Pattern 2: custom
MCP server on SAP BTP**. Its decision guide explicitly points teams needing custom code control
on BTP to Pattern 2 with all governance controls applied. Both patterns carry the same
cross-cutting obligations and leave operation, maintenance and security with the deployer.

For a shared ARC-1 service we recommend Pattern 2 because ARC-1 integrates with the relevant BTP
services. BTP hosting reduces infrastructure work; it does not automatically satisfy the architecture.
Pattern 1 is also a documented option, with the operator supplying and verifying the necessary
identity, secrets, TLS, monitoring and traffic controls.

| Deployment | Fit and boundary |
|---|---|
| BTP CF with strict principal propagation | Recommended ARC-1 baseline. MCP authentication and per-user SAP credentials support identity separation; verify the additional agent-identity and scope requirements below. |
| External Docker/npm HTTP service | Maps to Pattern 1. Apply the full governance requirements to the chosen platform. |
| Shared SAP Basic identity | Supported configuration, with narrower attribution than PP. MCP users may be authenticated individually while SAP sees the shared account. It does not provide per-user SAP propagation. |
| Local stdio | A local developer setup using OS/process access and SAP authentication, without an MCP HTTP authentication boundary. It is not a shared service, and local/dev/test use does not create an API-policy exemption. |

### Current control assessment

This is a capability assessment of the repository, not evidence that a particular deployment has
enabled or tested every control.

| SAP architecture concern | What ARC-1 provides | What still needs attention |
|---|---|---|
| Meaningful tools and input validation | Intent-based ABAP tools, schemas, context compression and guarded mutations | These address development tasks; they do not establish API permission or business-process suitability. |
| Authentication and user context | HTTP XSUAA/OIDC/API-key authentication; strict PP can preserve the SAP user | Verify identity-provider trust and SAP mapping. XSUAA alone does not demonstrate the complete Cloud Identity Services flow SAP describes. |
| New downstream credentials | Destination-dependent user-context exchange; on-premise PP through Cloud Connector | Do not equate every exchange with RFC 8693. Verify audience, user context and permissions for the chosen destination. |
| Registered agent identity and minimum scope per tool | ARC-1 scopes restrict tools; audit includes `clientId` and `clientAgent` | Caller-supplied `clientAgent` is an audit label. The supported PP flow does not establish a registered Cloud Identity Services agent identity or a separately narrowed SAP credential for each tool. |
| TLS and secrets | Certificate verification defaults on; destination/service-binding integration | Verify TLS 1.2+ on deployed connections, dedicated secret storage and rotation. Env vars and service bindings alone do not prove this; PP still needs application credentials. |
| API quotas and consumer limits | HTTP/IP limits, optional per-user tool limits, and a shared SAP-request concurrency cap | `ARC1_RATE_LIMIT=0` disables the per-user limit by default. One tool can issue many SAP requests; size against downstream quotas and all replicas. |
| Timeouts and circuit breakers | SAP HTTP timeouts and bounded retry paths | No built-in circuit breaker. A semaphore does not stop repeated traffic to an unavailable backend. Ordinary semaphore waits also lack a queue deadline. |
| Scaling | Stateless MCP HTTP transport | Caches, limiters and some coordination are process-local. Shared-Basic multi-target mode requires one instance. |
| Audit, tracing and alerts | Redacted audit events; forwarding of valid inbound W3C trace context | Configure retention, access and working alerts. Trace forwarding does not create a collector or generate missing traces. An OWASP mapping is not certification. |
| Lifecycle | Versioned releases and schema regression checks | Operators need dependency updates, client compatibility checks and review when SAP guidance or MCP changes. |

See [Deployment best practices](deployment-best-practices.md), [Rate limiting](rate-limiting.md),
[Security guide](security-guide.md), and the
[research dossier](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-21-sap-api-policy-custom-mcp.md)
for implementation evidence and follow-up research.

## 3. What the API Policy actually says

Read the [API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf)
together with the [official FAQ](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html).
The points below paraphrase the relevant provisions; they do not replace them.

### 3.1 Published vs. non-published APIs (§1.1, §1.2)

Published APIs include those identified in SAP Business Accelerator Hub **or product-specific
documentation**, for their documented purposes. Absence from the Hub alone is not decisive.
Other interfaces require a documented allowance or SAP authorization; customers and partners must
verify the endpoints they use. The customer-developed ABAP example does not turn SAP-provided ADT
endpoints into customer-owned interfaces.

**FAQ Q33 provides specific ADT guidance.** It classifies ADT APIs as internal and limits development
use to endorsed channels. Its examples include SAP's Eclipse ADT, abapGit, SAP-provided developer
tools, CI/CD using SAP-published tooling, and internal developer utilities built on the documented
Eclipse Java SDK.

ARC-1 is a separate TypeScript client calling ADT HTTP endpoints. The FAQ does not specifically
identify that access path as endorsed. SAP tooling using the same endpoints, ADT discovery,
development-only positioning, or BTP hosting does not establish authorization for ARC-1. Obtain SAP
clarification for this specific channel and intended agentic development use before adoption,
including dev/test. Assess separately documented non-ADT APIs separately.

### 3.2 Agentic and generative AI access (§2.2.2)

Section 2.2.2 restricts agent-driven API sequences and systematic large-scale extraction outside
documented, endorsed pathways. **FAQ Q32 and Q56 confirm a conditional path for custom tooling and
custom MCP servers**; ref. 137800 supplies the architecture to follow. This supports custom MCP
as a design choice while leaving endpoint and intended-use conditions in place. FAQ Q37 also makes
clear that BTP hosting is not an exemption.

**Business-data access needs particular care.** FAQ Q33 excludes application-table reads, business
data export, backend SQL, runtime business integration and agentic business-data workflows from
ADT's intended development-tooling scope. Keep `SAP_ALLOW_DATA_PREVIEW` and `SAP_ALLOW_FREE_SQL`
off unless the specific use has a documented allowance or SAP authorization under the applicable
agreements. Internal approval, technical authorization or an ARC-1 opt-in flag is not that allowance.
For business-data integration, choose Published business APIs documented for that purpose.
See the technical gates in [Authorization](authorization.md#sap-api-policy-data-preview-and-free-sql-are-gated-for-a-reason).

### 3.3 No circumvention of API controls (§3)

An MCP wrapper, gateway, alternate route or protocol must not evade SAP's API controls or agreement
restrictions. ARC-1's safety ceiling, package gates and audit support governance but do not change
what SAP permits. Extensions need the same endpoint and use review. Network workarounds also need
review against the actual control they affect; technical compatibility is not permission to bypass it.

### 3.4 Rate limits and system health (§2.1, §2.2.1)

Respect API quotas, documented purposes and system security/stability constraints. Configure
per-consumer limits, budget downstream request fan-out and size concurrency with the SAP operator.
Include workload-producing reads such as ATC and ABAP Unit. A read-only setting, row limit or
tool-call limit alone cannot demonstrate that every downstream API quota is respected.

## 4. The MCP Gateway question

**Integration Suite is an option, not a prerequisite for every compliant custom MCP deployment**
(FAQ Q32). SAP recommends its managed MCP infrastructure for governed tool access. Its current
documentation also describes
[using a remote MCP server as the source](https://help.sap.com/docs/SAP_INTEGRATION_SUITE/9519789d5664487f8b9cd89eba514477/742216d01dfd4c58ab22090068216638.html):
Integration Suite can proxy an existing MCP server and apply security and traffic policies.
Our earlier July assessment that only API-to-MCP wrapping was documented is superseded.

The documented remote-server path requires Streamable HTTP, an Internet destination, Integration
Cell and a suitable service plan. ARC-1 provides Streamable HTTP, making this a relevant integration
to evaluate. **ARC-1 interoperability through this gateway has not been verified here.** Validate
discovery and runtime authentication separately, user and agent identity, scopes, tool visibility,
trace/audit attribution, quotas, errors and transport behavior before recommending a configuration.
A shared service credential must not silently replace a per-user SAP identity. Adding a gateway
also does not resolve FAQ Q33's ADT-channel question.

## 5. What we recommend

1. **Use ref. 137800 as the main design baseline for custom MCP.** Prefer Pattern 2 for a shared
   ARC-1 deployment; Pattern 1 remains valid when its controls are supplied and verified.
2. **Resolve API permission alongside implementation.** Inventory actual endpoints and intended
   operations. For ARC-1, ask SAP whether this direct ADT HTTP client is an authorized channel for
   the proposed AI-assisted development workflows under FAQ Q33, and under what conditions.
   Keep SAP's answer with the deployment record.
3. **Start with strict PP and conservative tool exposure.** Verify each user's SAP identity and
   authorizations; limit writes, data preview, SQL and extensions to the explicitly permitted scope.
   Read-only defaults reduce exposure without establishing permission.
4. **Close the deployment's control gaps.** Verify Cloud Identity Services integration, downstream
   credential identity/scopes, secrets, TLS, API-specific quotas, outage handling and working alerts.
   Record unresolved requirements rather than marking them met from available code alone.
5. **Evaluate managed governance where useful.** Remote MCP proxying through Integration Suite is
   now documented. Validate the ARC-1 flow before adopting it; direct Pattern 2 does not require it.
6. **Recheck when the deployment or guidance changes.** Preserve source versions, applicable
   agreements, tested configuration and remaining gaps. Operator responsibility applies to both patterns.

## References

- [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) — v.4.2026a checked 2026-10-21.
- [SAP API Policy FAQ](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html) — v1.3, June 2026; especially Q32–37 and Q56.
- [Third-Party MCP Access to SAP Solutions](https://architecture.learning.sap.com/docs/ref-arch/137800) — primary custom-MCP architecture and control baseline.
- [Agent Identity](https://architecture.learning.sap.com/docs/ref-arch/140bdb) — registered agents and retained user context; verify tenant availability.
- [Remote MCP server as an Integration Suite source](https://help.sap.com/docs/SAP_INTEGRATION_SUITE/9519789d5664487f8b9cd89eba514477/742216d01dfd4c58ab22090068216638.html) — current managed-proxy option.
- [OAuth User Token Exchange](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/e3c333f9de6245fca326993f2397c13a.html) and [OAuth Token Exchange](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/f4d28ea5a6ce441fb3dacce0a55d7a35.html) — distinct destination authentication types.
- [SAP Note 3690029](https://me.sap.com/notes/3690029) — clean-core integration and API-policy distinctions.
- [Current ARC-1 research and gap assessment](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-21-sap-api-policy-custom-mcp.md) — evidence, corrections and follow-up scope.
