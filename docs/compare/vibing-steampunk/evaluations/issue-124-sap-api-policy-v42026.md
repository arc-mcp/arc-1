# SAP API Policy v.4.2026 — strategic implications for ADT-based MCP

> **Priority**: High (strategic, not code)
> **Source**: oisee/vibing-steampunk issue #124 (2026-04-24, open)
> **ARC-1 component**: project narrative; not a code change

## What the issue says

A community user flagged that SAP's API Policy v.4.2026 (effective 2026) tightens what counts as a "Published API":

> Every endpoint a customer or partner uses in productive use must be a Published API — listed on the SAP Business Accelerator Hub or identified in official product documentation. Interfaces that are internal, private, or undocumented "may change or be removed without notice" and are off-limits for productive use.

The connection to ADT-based tooling:

- SAP documents ABAP Development Tools as the **Eclipse Java SDK**, not as an HTTP contract.
- The `/sap/bc/adt/*` REST surface is **reachable** but has never been classified as a published external API.
- SAP community guidance has been consistent for years that ADT REST is undocumented for external consumption.
- Putting the policy and the docs together: third-party tools that call `/sap/bc/adt/*` from outside an Eclipse plugin are now harder to defend as productive-use compliant.

## Affects every ADT-based MCP

This is not a vsp-specific concern. It hits **every** project on our tracker that calls ADT over HTTP from a non-Eclipse client:

- ARC-1 (this project)
- fr0ster/mcp-abap-adt
- oisee/vibing-steampunk
- mario-andreschak/mcp-abap-abap-adt-api
- aws-abap-accelerator
- abap-adt-api (the underlying npm library)

## ARC-1 positioning options

These are mitigation directions, not commitments — worth surfacing for the project's productive-use story:

1. **"Developer-tool integration" framing.** Eclipse ADT is a documented developer tool that uses these REST endpoints internally. ARC-1 plays the same role for AI assistants — a developer-tool client that happens to be language-model-driven. The contract is the same; the client is a different shell. This argument depends on SAP accepting "developer tools" as a category that includes language-model clients.
2. **Wait for SAP clarification on ADT.** The policy is generic. SAP may publish targeted guidance that explicitly carves out ADT for non-productive (developer) use — that's the most likely path to a clean answer.
3. **Partner / co-innovation channel.** If SAP introduces a sanctioned LLM-side ADT contract (e.g. via Joule extensions or BTP AI tooling), align with it.
4. **BTP-only positioning.** On BTP ABAP Environment specifically, ADT is the only customer development surface — there is no SAPGUI, no transactions. SAP cannot deprecate ADT-over-HTTP on BTP without leaving customers without a development tool. Productive-use-via-BTP-ADT has a stronger story than productive-use-via-on-prem-ADT.

## Decision

**no-action (code) / track strategically**:

- File this under project narrative — every demo / pitch / customer conversation should now include a productive-use statement.
- ARC-1's documented position: developer-productivity tool, not a runtime integration. Aligned with how Eclipse ADT itself sits in SAP's policy stack.
- Watch SAP's BTP / Joule announcements — if a sanctioned ADT external contract emerges, ARC-1 should be among the first to adopt it.
- Cross-reference: this is the same risk that affects fr0ster, vsp, mario-andreschak, and abap-adt-api itself. None has a clean answer yet; the community signal is "wait for SAP to clarify."

**Not a code change**. Filed for awareness so it shows up in the tracker rather than getting lost.
