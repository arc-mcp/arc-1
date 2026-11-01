# SAP API Policy — issue #124 evaluation and current correction

> **Original source:** oisee/vibing-steampunk issue #124, recorded 2026-04-24 as open.
> **Review update:** 2026-10-21; the upstream issue state was not rechecked.
> **Scope:** ARC-1 policy documentation; no runtime change or conclusion about other projects' agreements.

## Historical concern

The April evaluation raised the question of third-party clients using ADT HTTP endpoints under
API Policy v.4.2026. It proposed developer-tool framing and BTP-only positioning as possible
mitigations. Those arguments do not establish permission and are superseded by the current sources.
The restriction must not be framed as applying only in production, and Published APIs are not
limited to Business Accelerator Hub entries: product-specific documentation also counts.

## Current evidence

- [API Policy v.4.2026a](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf)
  requires verification of API status, documented purpose and the applicable agentic access path.
- [SAP API Policy FAQ v1.3, June 2026](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html)
  Q56 permits custom MCP under conditions; Q32 says Integration Suite is not required. Q33
  classifies ADT APIs as internal and describes endorsed development channels. ARC-1's direct
  TypeScript ADT client is not specifically identified as one. Q37 gives no BTP-hosting exemption.
- [Reference architecture 137800](https://architecture.learning.sap.com/docs/ref-arch/137800)
  is the primary design/control baseline we recommend for custom MCP, including ARC-1. Meeting
  architecture controls does not itself resolve API-specific permission.

## Current disposition

Use the [canonical policy guidance](../../../../docs_page/sap-api-policy-and-architecture.md) and
[dated evidence/gap assessment](../../../research/2026-10-21-sap-api-policy-custom-mcp.md).
Obtain SAP clarification for ARC-1's specific ADT channel and intended AI-assisted development use,
including dev/test. Do not infer endorsement from endpoint reachability, the customer-developed ABAP
example, another tool's endorsement, or the hosting platform. The technical follow-up research is
bounded in the roadmap; an API authorization is external evidence, not a code feature.
