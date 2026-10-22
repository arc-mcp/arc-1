# SAP's custom-MCP architecture: policy evidence and ARC-1 gaps

**Reviewed:** 2026-10-21. **Repository baseline:** `1ff575d912642f3ce697044426c368ef83764676`.
**Scope:** repository-wide policy statements, relevant implementation paths and current SAP primary
sources. Documentation changes only; no live gateway/IAS deployment, API authorization from SAP,
penetration test or compliance certification was obtained.

## Conclusion

Use [reference architecture 137800](https://architecture.learning.sap.com/docs/ref-arch/137800) as
the main design and control baseline when choosing a custom MCP server such as ARC-1. SAP explicitly
describes custom BTP and external MCP patterns. FAQ Q56 confirms their conditional use, and Q32
says Integration Suite is not compulsory. This is stronger support for the custom-MCP route than
our previous documentation conveyed.

It does not establish full adherence for ARC-1. The newly consulted FAQ Q33 explicitly classifies
ADT APIs as internal and describes endorsed development channels. ARC-1's standalone TypeScript
HTTP client is not specifically identified among them. The required clarification is about that
channel and intended use, not whether custom MCP is categorically acceptable. Ref. 137800 does not
waive this API-specific condition. The current public guidance is
[API Policy & Architecture Alignment](../../docs_page/sap-api-policy-and-architecture.md).

## Primary sources and provenance

| Source | Evidence checked | Relevance |
|---|---|---|
| [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) | v.4.2026a, retrieved 2026-10-21 | §§1.1–1.2: published interfaces/documented allowances; §§2.1–2.2: quotas, purposes, agentic access; §3: no circumvention. |
| [Official API Policy FAQ landing page](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html) | Download is **v1.3, June 2026**, 21 PDF pages; retrieved 2026-10-21 | Q32/Q33 on PDF p.11; Q56 starts p.20 and continues p.21. The FAQ is explanatory/nonbinding and does not amend agreements. |
| [Ref. 137800 source snapshot](https://github.com/SAP/architecture-center/blob/e436315cb48a1cc02de5a2be302c99ca2d78ecc6/docs/ref-arch/RA0029/10-third-party-mcp-access/readme.md) | Last file commit `e436315cb48a1cc02de5a2be302c99ca2d78ecc6`, 2026-10-08 | Both custom-MCP patterns, operator responsibility, identity/scopes, secret storage, quotas, circuit breakers and monitoring. The displayed June update date is not a complete source revision history. |
| [Agent Identity, ref. 140bdb](https://architecture.learning.sap.com/docs/ref-arch/140bdb) | Current SAP architecture page | Registered agent identity and retained user context; architectural guidance is not proof of tenant-specific availability. |
| [Remote MCP as an Integration Suite source](https://help.sap.com/docs/SAP_INTEGRATION_SUITE/9519789d5664487f8b9cd89eba514477/742216d01dfd4c58ab22090068216638.html) | SAP Help, Integration Suite Cloud, retrieved 2026-10-21 | Explicit MCP-to-MCP proxy option, superseding our July inventory. |
| [OAuth User Token Exchange](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/e3c333f9de6245fca326993f2397c13a.html), [OAuth Token Exchange](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/f4d28ea5a6ce441fb3dacce0a55d7a35.html) | SAP BTP Connectivity documentation | Distinct `OAuth2UserTokenExchange` and `OAuth2TokenExchange` types. The latter requires subject-token headers. Do not label all existing destination flows RFC 8693. |
| [SAP Note 3690029](https://me.sap.com/notes/3690029) | Current note text retrieved | Clean-core and API-policy assessments are separate. |

The FAQ was discovered through the official
[SAP Help API Policy page](https://help.sap.com/docs/SAP_API_BUSINESS_HUB/e56a6c50d31541ea826021dc8e721a53/78d1b4a903e8438691dbe9b1c5bd5052.html).
Its [canonical download](https://www.sap.com/docs/download/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.pdf)
and [version-named SAP copy](https://d.dam.sap.com/x/UL9AiqH/SAP_API_Policy_FAQ_v1.3_June.pdf)
returned identical bytes: SHA-256 `080ec09161bdbf832404b174e661c787e8cca247338604ee5a058ad83e2d9f34`.
No source PDFs are vendored into this repository.

## What the FAQ changes

- **Q32:** the API surface and usage determine compliance; Integration Suite is not mandatory.
  This supports presenting ref. 137800 as the primary custom-MCP path without requiring a gateway.
- **Q33:** endorsed ADT channels include SAP Eclipse ADT, abapGit, SAP developer tools, CI/CD using
  SAP tooling and utilities using the documented Eclipse Java SDK. A direct TypeScript HTTP client
  is not established as an endorsed channel by this list. Development purpose alone is insufficient.
- **Q33 data boundary:** application-table/business-data reads, backend SQL, runtime integration
  and agentic business-data workflows are outside ADT's intended development-tooling scope. Our
  former `.env.example` wording confused this with being outside the policy itself. Internal
  approvals and opt-in flags cannot supply the missing SAP allowance.
- **Q34–37:** agentic access has endorsed architectural paths, and BTP hosting is not an exemption.
  SAP's own developer MCP products do not confer endorsement on third-party clients by analogy.
- **Q56:** custom/third-party MCP is expressly possible under the agreements, Documentation and
  API Policy, with authentication/authorization on every connection and quota compliance. The
  operator owns maintenance and implementation risk. Its risk language is not a blanket override
  of Policy §1.2 or the specific ADT guidance in Q33.

## Gap assessment and next evidence

| Area | Repository evidence | Assessment and next evidence |
|---|---|---|
| API access and intended use | [ADT facade](../../src/adt/client.ts), [transport](../../src/adt/http.ts), [UI5](../../src/adt/ui5-repository.ts), [gCTS](../../src/adt/gcts.ts) | **Permission unresolved for the direct ADT channel.** Ask SAP specifically about ARC-1's client and agentic development operations under Q33. Inventory separately documented APIs individually. Do not infer a decision for every third-party ADT project. |
| User identity and downstream credentials | `createPerUserClient` / `applyPerUserAuthTokens` in [server.ts](../../src/server/server.ts), [multi-target destination runtime](../../src/server/multi-target-destination-runtime.ts) | **Supported, configuration-dependent.** Strict PP fails without usable user credentials; Basic modes share an identity. Validate destination-specific exchange, audience and actual SAP user mapping. The connectivity proxy is a credential-exchange intermediary, not the downstream SAP application API. |
| Agent identity and per-tool scope | [HTTP audit context](../../src/server/http.ts), [audit fields](../../src/server/audit.ts), [tool policy](../../src/authz/policy.ts) | **Partial.** MCP tool authorization is not per-tool narrowing of the downstream SAP credential. `clientAgent` is caller-controlled and not propagated as a registered CIS agent identity. Research tenant-supported identity/delegation contracts, preserving user context and fail-closed behavior: [SEC-19](../../docs_page/roadmap.md#sec-19). Do not claim ABAP universally has no agent-identity mechanism. |
| Quotas and fan-out | [defaults](../../src/server/types.ts), [HTTP/IP limits](../../src/server/auth-rate-limit.ts), [user limits](../../src/server/mcp-rate-limit.ts), [rate-limit guide](../../docs_page/rate-limiting.md) | **Operator evidence required.** Default user quota is off, tool counts differ from SAP HTTP calls, and replicas multiply process-local limits. Require a target/API workload budget and measured behavior at the intended concurrency. |
| Outage protection | [HTTP transport](../../src/adt/http.ts), [rate-limit guide](../../docs_page/rate-limiting.md) | **Gap.** Timeouts/retries/semaphores exist; no circuit breaker. A single backend can still receive repeated failing requests. Ordinary queue waits are not universally bounded. Investigate target-specific breaker and queue behavior: [OPS-08](../../docs_page/roadmap.md#ops-08). |
| Secrets, TLS, CIS trust | [BTP runbook](../../docs_page/btp-cloud-foundry-deployment.md), [security model](../security-model.md), destination runtime above | **Deployment-dependent.** PP avoids stored end-user passwords but application/service-binding secrets remain. Require verified secret storage, rotation, TLS and trust configuration. Do not count env vars as a dedicated secrets store. No new IAS setup prerequisite is invented by this documentation change. |
| Observability and scaling | [trace context](../../src/server/trace-context.ts), [audit](../../src/server/audit.ts), [BTP audit sink](../../src/server/sinks/btp-auditlog.ts), [operations guide](../../docs_page/deployment-best-practices.md) | **Partial/operational.** Log fields and trace forwarding exist; working alerts/collectors/retention require configuration. Rate limits and caches are process-local; shared-Basic multi-target requires one instance. Existing OTel work stays in [OPS-05](../../docs_page/roadmap.md#ops-05). |
| Gateway compatibility | [HTTP transport](../../src/server/http.ts), current SAP remote-MCP documentation above | **Now documented by SAP, not tested with ARC-1 here.** Validate actual gateway/ARC-1 interoperability: [COMPAT-22](../../docs_page/roadmap.md#compat-22). No deployment promise yet. |

### Remote MCP Gateway validation boundary

SAP currently documents Streamable HTTP remote servers via Internet destinations, API Management,
Integration Cell and a suitable plan. Discovery and runtime can use different destinations; supported
authentication mechanisms include OAuth2JWTBearer as well as shared-credential mechanisms. The
presence of an auth type in that list does not prove the original MCP user's identity will arrive at
ARC-1 or be usable for its PP flow.

A useful spike needs two users with distinct SAP permissions. Check discovery, tool calls,
user/agent attribution, token audience/scopes, role and deny-action enforcement, trace context,
errors, rate limits and client reconnect/transport behavior. Keep shared and delegated identities
explicit. A passing transport test does not resolve the ADT permission question.

## Repository reconciliation

The public policy page now leads with the custom-MCP architecture path and uses the FAQ's specific
ADT guidance. README, landing/BTP overview pages, security/authorization/configuration guidance and CLI
policy text use the same distinction. Earlier comparison research is labeled or corrected where
it inferred permission from BTP, developer-tool framing or the customer-developed ABAP example.
The July architecture dossier is retained as historical evidence with explicit corrections.

Roadmap impact: **SEC-19**, **COMPAT-22** and **OPS-08** retain bounded research gaps with evidence
and resume conditions; **OPS-05** remains the existing observability idea. These are ideas, not
commitments to make every deployment compliant. API authorization and operator acceptance are
external evidence, not features that can be completed by changing ARC-1 code.
