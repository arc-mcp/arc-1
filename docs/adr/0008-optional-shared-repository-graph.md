# ADR-0008: Optional, explicitly shared repository metadata

2026-09-06. Status: proposed with the experimental adapter; review before production enablement.

## Context

ARC's live SAP context/cache paths enforce per-user authorization. A separately refreshed
repository graph can answer metadata relationships without repeated SAP calls, but its
collector's visibility cannot be assumed to equal every caller's visibility. The old shared
reverse-dependency cache was removed; this must not recreate that path implicitly.

## Decision

Default off. Accept one administrator-selected graph origin, system key and audience with
`sharing=shared-repository-metadata`. This explicitly authorizes the chosen dataset to every
ARC reader of this single-system instance. The declaration is a configuration trust decision,
not inferred from SAP roles or authenticated login. The API independently restricts its key to
the same system/audience. Fail closed on unsupported protocol or mismatching response identity.

2026-09-07 refinement: connection configuration enables internal/CLI diagnostics only.
MCP listing and invocation additionally require `ARC1_GRAPH_TOOLS=true`; by default a configured
backend adds no graph timers, probes or schema bytes to MCP. The independent backend remains
outside core. On SAP BTP use authenticated HTTPS, not unsupported container-to-container routes.

This narrow shared dataset is distinct from SAP-authorized per-user source/cache content.
It never substitutes for SAPRead/SAPContext and never stores source in ARC. Existing HTTP auth,
read scope, deny, rate limiting, strict-JWT prerequisite and audit apply. Audit labels graph
calls `identity=shared`; no SAP JWT, Destination credential or cookie reaches the service.
Only SAP-specific preflight and PP session creation are bypassed for this separate backend.

No multi-target routing, implicit audience discovery, per-user authorization inference,
fallback identity, database access, background collection or plugin-framework rewrite.
Normal caches and live where-used stay unchanged.

## Consequences and residual risk

An incorrect administrator declaration can disclose metadata to users who cannot read it
through SAP. Do not enable on restricted-user or unknown-visibility landscapes. Metadata and
descriptions are untrusted model context and can contain prompt injection; ARC's write safety
ceiling remains the backstop. A system key is a configured logical identity, not a live SAP
fingerprint. There is no full semantic/runtime completeness guarantee or per-edge freshness
proof. Coverage/truncation and potential-impact qualifications are required.

The backend remains independently deployed. Local PostgreSQL proof of concept validates the
contract; HANA, audience partitions, durable collector scheduling and a CF installer remain
separate release gates. No additional paid provisioning is authorized by enabling the adapter.

## Verification

The [experimental specification](../../docs_page/repository-graph-specification.md) defines the
current implementation boundary and open gates. It does not promote this ADR to a production
security sign-off or add restricted-audience support.

Default tool snapshots; independent runtimes; real SDK standard/hyperfocused/HTTP exchanges;
denied-scope/action/rate and strict-JWT paths; redirect/size/deadline/cancellation/key-rotation
tests; malformed/cross-system response rejection; read-only local live-index smoke. See
[validation](../research/repository-graph-validation.md).
