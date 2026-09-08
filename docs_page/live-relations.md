# Live relations (experimental)

Ask SAP for a small, current repository relationship network without collecting source code
or operating a graph database. This optional ARC-1 core feature adds
`SAPNavigate(action="relations")`; it adds no top-level tool and is invisible by default.

Use it to find objects using a class/interface, explore its dependencies, or follow several
native relationship steps before deciding what code to inspect. For exact source locations use
`SAPNavigate(action="references")`; for a CDS/RAP impact assessment use `SAPContext(action="impact")`.

## Before enabling

- An already working **single-target** ARC-1 deployment with `ARC1_TOOL_MODE=standard`.
- SAP must advertise `/sap/bc/adt/objectrelations/network` with
  `application/vnd.sap.adt.objectrelations.request.v1+xml` in ADT discovery.
- The caller needs ARC-1 `read` scope and SAP authorization for object metadata and Relation
  Explorer. The lookup is a read-only POST: the relevant SAP ADT resource authorization may need
  `ACTVT=01` and `02`. No new ARC-1 role, SQL permission, or write permission is required.
- Cloud Connector must permit the existing discovery, OO metadata and objectrelations paths.
  Use the normal least-privilege resource allowlist; do not expose all SAP paths just for this feature.

Single-target principal propagation keeps using the caller's selected SAP identity. Shared Basic
authentication keeps its existing shared identity. Neither mode falls back to the other on failure.
Multi-target and hyperfocused modes reject this opt-in in v1.

## Enable locally or with Docker

Keep your working SAP connection and authentication configuration. Add:

```dotenv
ARC1_LIVE_RELATIONS=true
```

For local/stdio use the existing `.env` or process environment. For Docker, add the variable to
the existing service environment and recreate that service using your normal deployment workflow.
Do not publish another port or deploy another container/database. Normal `ARC1_CACHE` settings
remain independent. See [Deployment](deployment.md) if ARC-1 is not installed yet.

Restart ARC-1, then refresh the MCP client's tools. The action appears only after the ordinary
background discovery confirms support; tools/list itself never waits on SAP. If discovery is
still unknown, a deliberate `relations` call performs its own bounded discovery check.
Successful fallback discovery is parsed once and retained in the existing in-memory,
destination-scoped capability cache. Later calls reuse these hints, but still read root metadata
and relationships live as the caller. Failed or unsupported fallback discovery is not retained.
This cache is independent of `ARC1_CACHE`; it stores neither object results nor authorization grants.

## Enable on SAP BTP Cloud Foundry

Start with your working single-target deployment from the
[BTP task map](btp-overview.md). This feature needs **no additional BTP service, HANA/PostgreSQL
instance, service key, AI Core subscription, or separate route**.

1. Use an ARC-1 artifact containing this feature. Add the property below to the **existing ARC-1
   module's** `properties:` in your `.mtaext`; preserve its SAP destination/auth and all other settings.
2. Deploy using the normal [BTP administration workflow](btp-administration.md). This is an
   application-property change, not a service-provisioning procedure. If using direct `cf push`
   instead, set the same app environment variable and restart that app.
3. Reconnect the client and run a depth-1 lookup on a known class. If hidden/unsupported, inspect
   ADT discovery, Cloud Connector resources and the user's SAP authorization before changing roles.

```yaml
properties:
  ARC1_LIVE_RELATIONS: "true"
```

Local `.env` files are not deployed by MTA. To disable, set the property explicitly to `"false"`
and redeploy/restart; deleting a line from an extension does not remove an inherited property.
Do not change your existing XSUAA/PP/shared-identity topology for this feature.

No extra BTP service charge is introduced by the feature itself. It still consumes the existing
app's memory/CPU and SAP requests; it does not guarantee that a particular deployment is free.
Stay within your current trial quota and do not provision storage for it.

## Calls and prompts

Replace the example object with an existing object on your SAP system:

```json
{"action":"relations","type":"CLAS","name":"ZCL_ORDER","direction":"incoming","depth":1,"maxResults":50}
```

```json
{"action":"relations","type":"INTF","name":"ZIF_ORDER","direction":"outgoing","depth":3,"maxResults":50,"expandPackages":["ZORDER"]}
```

Useful prompts:

- “Find the objects using ZCL_ORDER. Separate observed relationships from unknown coverage.”
- “Explore ZIF_ORDER's dependency network, expanding only package ZORDER. Which objects should I inspect next?”
- “Follow up to three native relationship steps from this class. Report any truncation, then verify the important links with source or where-used.”

Input requires `type=CLAS|INTF` and `name`; `uri`, `source`, inactive versions and arbitrary endpoint
paths are not accepted. `direction` defaults to `outgoing`; `incoming` finds users of the root.
`expandPackages` accepts up to eight exact package names, no wildcards. It limits expansion beyond
the root, **not visibility or authorization**: neighboring packages still appear as boundary nodes.

## Interpret the result honestly

Edges point **consumer → dependency** in both directions. Nodes are identified by URI, so a CDS
definition and a behavior definition with the same name stay distinct. Only class/interface nodes
are expanded; other object types may be returned as boundary evidence.
Traversal is breadth-first, prioritizing neighbors in the root's package at each expansion,
then sorting by URI. This makes small-budget results useful and repeatable, not complete.

- `coverage="unknown"` is always present: native Relation Explorer is not a complete call graph.
- `scopeBoundaries` explains nodes not expanded due to requested depth, type, package or disappearance.
- `truncated`/`truncationReasons` reports resource limits; `pending` lists retained unexpanded work.
  Dropped nodes/edges cannot be enumerated after a size cap, so this is not a resumable cursor.
- `observedAt` is the analysis start time, not a transactionally consistent SAP snapshot.
- `metrics` reports SAP HTTP attempts, successful decoded metadata bytes and elapsed analysis time.
- The root is independently validated against live metadata. Other nodes are observed native
  references, not independently verified existence/authorization assertions.

Empty results do **not** mean unused, safe to delete, runtime-unreachable, or impact-free. Native
edges are generic “uses” evidence, not proven method calls, interface implementation edges, or
direct source-call hops. Some source constructs are absent from SAP's native network. There is
no hidden where-used, SQL, source-parser or alternate-identity fallback.

## Fixed resource limits

| Control | Limit |
|---|---|
| Depth | Default 1, maximum 3 native expansion steps |
| Nodes (`maxResults`) | Default 50, maximum 100, including root |
| Edges / expansions | 100 edges / 8 native expansions |
| SAP HTTP attempts | 12, including discovery/root metadata, CSRF and retries |
| Analysis deadline | 15 seconds including analysis admission and SAP HTTP queue/body/retry time |
| Successful metadata bodies | 1 MiB cumulative decoded bytes; error bodies individually capped |
| Concurrent analyses | 2 per ARC-1 process; normal global SAP concurrency limit also applies |
| Final serialized result | 512 KiB defense-in-depth cap |

These are overlapping ceilings, not promised completion counts. With no discovery/session state,
discovery GET + root metadata GET + CSRF HEAD + eight native POSTs uses 11 attempts; a CSRF GET
fallback uses the twelfth. Retries or large responses can stop the analysis earlier. Reusing ordinary
discovery/session state saves setup requests, never authorization checks or relationship results.

`metrics.successfulMetadataBytes` includes any discovery and root metadata read inside this analysis,
plus successful native response bodies. Failed response bodies have a separate per-response 1 MiB
cap and still consume HTTP attempts/time; the metric is **not** a cumulative cap on all network traffic.

CSRF control bodies are discarded after headers rather than buffered. These are not included in
the successful-metadata byte metric. The deadline starts after normal dispatch/identity preparation;
ordinary startup feature probes and Destination Service identity resolution are separate existing
work. Bounds are deliberately not configurable in v1. They bound retained data/work, not exact RSS
or total wire bytes. Compressed responses through Connectivity must honor `Accept-Encoding: identity`.
The strict parser accepts the ordinary XML declaration, but rejects comments, CDATA, custom
processing instructions and DTD/entities. Unexpected protocol variants fail with an error.

Authorization and malformed protocol responses are errors, including after earlier successful
expansions. A session/CSRF retry counts as recovered only after a complete, valid native expansion;
successful control headers alone (or a denied request retried as 404) cannot clear that failure.
Resource exhaustion after valid results may return explicitly partial evidence. Narrow
the requested root/depth/package scope; do not keep retrying the identical broad request.

## Validation status

Experimental: the protocol was observed on SAP_BASIS 758 (S/4HANA 2023 trial). SAP documents the
[Relation Explorer user feature](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer),
not a stable public REST contract. Supported families evolve across releases. Exact discovery is
a prerequisite, not a compatibility or authorization guarantee. Direct SAP trial smoke and local
Connectivity-protocol tests do not establish live BTP PP or cross-release compatibility.
