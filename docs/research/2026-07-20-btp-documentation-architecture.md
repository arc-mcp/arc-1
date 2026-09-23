# BTP deployment documentation architecture

**Date:** 2026-07-20
**Scope:** ARC-1 deployment and administration on SAP BTP Cloud Foundry, including single-target and
experimental multi-target operation
**Decision:** adopt a task- and owner-based documentation structure, keep existing public URLs, and
make the MTA deployment the canonical BTP path

## Executive summary

ARC-1 has enough technical documentation, but a BTP administrator currently has to assemble one
deployment from several long, overlapping pages. The main problem is not missing detail. It is that
deployment, destination, XSUAA, Principal Propagation, MCP-client, and runtime-lifecycle procedures
are presented as peer guides without one clear sequence or owner handoff.

The selected structure is:

1. `docs_page/btp-cloud-foundry-deployment.md` is the canonical deployment runbook. It starts with a
   topology decision, remains read-only through initial acceptance, and links to the specialist
   procedures at the point where each administrator takes over.
2. `docs_page/btp-administration.md` owns common BTP operations: configuration ownership, changes,
   restarts, upgrades, scaling, secrets, roles, logging, rollback, and customer handover.
3. `docs_page/multi-target-setup.md` and `docs_page/multi-target-administration.md` remain the only two
   multi-target pages. They own only the setup and operational behavior unique to that mode.
4. Principal Propagation, XSUAA, and Destination pages remain specialist references. Only one page
   contains the Cloud Connector/SAP PP procedure.

This is a documentation-only architecture change. It does not change runtime behavior or the v1
security boundary.

## Evidence from the repository

Before this change, the six central BTP and multi-target guides contained more than 3,300 lines and
roughly 24,000 words. The overlap produced several concrete risks:

- `btp-destination-setup.md` contained an older PP procedure that exposed `/`, used a different
  certificate subject, and weakened backend trust, while `principal-propagation-setup.md` contained
  the newer live-tested, issuer-restricted procedure.
- `xsuaa-setup.md` correctly described stateless Dynamic Client Registration and later claimed that
  registrations were in memory and lost on restart.
- `updating.md` recommended rolling Cloud Foundry updates without excluding multi-target shared
  Basic, where two overlapping processes violate the process-local lockout design.
- The top-level BTP example enabled writes before proving the read-only path.
- Multi-target PP was described as depending on `SAP_PP_ENABLED` and `SAP_PP_STRICT`; discovered PP
  targets actually force strict PP independently. Those flags govern only an optional `/mcp`.
- Generic `/mcp` and OAuth-scope examples were easy to apply accidentally to `/multi/mcp` or a
  pinned route.

The implementation sources used to resolve the intended contract were:

- `mta.yaml` and `mta-overrides.mtaext.example` for deploy-time defaults and overlays;
- `src/server/config.ts` for startup invariants;
- `src/server/destination-discovery.ts` and `src/server/destination-registry.ts` for destination
  visibility and validation;
- `src/server/multi-target-runtime.ts` and `src/server/multi-target-server.ts` for target identity;
- `xs-security.json` and the XSUAA resource in `mta.yaml` for scopes, templates, and collections;
- ADR-0006 and ADR-0007 plus the destination-discovered v1 plan for security boundaries.

## Audience and owner model

The docs must not assume that one person has every BTP and SAP privilege. Each state-changing step
is assigned to a typical owner:

| Responsibility | Typical owner |
|---|---|
| Entitlements and subaccount isolation | BTP subaccount administrator |
| MTA deployment, routes, app environment, and service bindings | CF Space Developer |
| Destination creation and credentials | Destination Administrator |
| Role collections and user/group assignments | User and Role Administrator |
| Cloud Connector mappings, trust, and resources | Cloud Connector administrator |
| STRUST, CERTRULE, ICM/SICF, SU01, and SAP roles | SAP Basis/security |
| MCP connection and safe-read acceptance | ARC-1 service owner and representative user |

This matches SAP BTP's role-oriented administration model. It also makes responsibility for shared
Basic destination passwords explicit: a Destination Administrator is then a credential
administrator, while XSUAA still identifies the human caller to ARC-1.

## Configuration ownership

The public docs now use one ownership model consistently:

| Location | Owns | Does not own |
|---|---|---|
| `mta.yaml` | Versioned safe defaults, module/resource topology, bindings, role collections | Customer-specific target inventory or secrets |
| Customer `.mtaext` | Durable landscape route, instance count, feature ceilings, named single-target destinations | Destination credentials |
| Subaccount destination | Target URL/client, SAP identity mode, Cloud Connector routing, and target-local data/SQL narrowing | Global mutation ceiling or XSUAA grants |
| `cf set-env` | The stable DCR signing secret and controlled emergency overrides | Preferred durable non-secret landscape configuration |
| `VCAP_SERVICES` | Platform-generated service binding credentials | Human-edited configuration |
| Cloud Connector and SAP | Network exposure, certificate trust/mapping, and final SAP authorization | ARC-1 OAuth roles |

SAP defines MTA extension descriptors as deployment-specific overrides. Maps merge and later
extensions take precedence, while lists replace earlier values. The docs therefore tell admins to
keep a reviewed `.mtaext` as desired state and never edit generated `mtad.yaml`.

## Options evaluated

Scores use 1 (low) to 5 (very high). “Change” is documentation churn; “runtime impact” is code,
security, release, or operational behavior outside the docs.

| Option | Help | Change | Runtime impact | Decision |
|---|---:|---:|---:|---|
| Patch contradictions without restructuring | 3 | 2 | 1 | Necessary but insufficient |
| Add another multi-target overview | 2 | 2 | 1 | Reject; increases fragmentation |
| One very large BTP page | 4 initially | 5 | 1 | Reject; high drift and poor task focus |
| Task/owner-based BTP deploy + administer journeys | 5 | 4 | 1 | **Adopt now** |
| Keep two multi-target pages with strict ownership | 5 | 3 | 1 | **Adopt now** |
| Configuration ownership and change-impact tables | 5 | 2 | 1 | **Adopt now** |
| PP-first path with Basic as an exception | 5 | 2 | 1 | **Adopt now** |
| Version-aware Cloud Connector wording | 4 | 2 | 1 | **Adopt now** |
| Copyable destination templates without credentials | 4 | 2 | 1 | **Adopt now** |
| Screenshot-heavy cockpit walkthrough | 3 initially | 4 recurring | 1 | Avoid; cockpit labels drift |
| Generate role/destination/config tables from code | 4 long-term | 4 | 3 | Follow-up after schema stabilizes |
| `arc1 btp doctor` preflight command | 5 | 3 docs | 4 | High-value follow-up |
| Interactive deployment wizard | 4 | 5 | 5 | Defer; high maintenance during beta |
| Prebuilt signed MTAR releases | 5 | 3 | 5 | Future release/supply-chain decision |
| Dedicated runtime staging directory + MTAR secret inspection | 5 security | 2 docs | 3 | Recommend before broad distribution |
| Bound/file secret for `ARC1_DCR_SIGNING_SECRET` | 4 security | 2 docs | 4 | Design follow-up |
| Put the global safety ceiling in destinations | Negative | 3 | 5 security | Reject |

### Why the selected option helps most

It gives a non-BTP expert one ordered deployment path without duplicating the specialist
instructions. It also preserves existing links, keeps detailed operator diagnostics available, and
does not hide the important complexity behind an unreliable wizard. The main cost is one-time
documentation churn and maintaining explicit page ownership.

## BTP-specific conclusions

### Resource hierarchy and isolation

ARC-1 v1 discovers subaccount-level destinations. A CF space is not a hard destination-inventory
boundary. If two ARC-1 populations must not see the same target configuration, use separate
subaccounts or another deliberate isolation design; merely using two spaces is insufficient.

ARC-1 deliberately quarantines a subaccount target when an instance destination with the same name
could shadow it. That fail-closed behavior differs from ordinary Destination Service lookup
precedence and must be visible in operator documentation.

### Principal Propagation is a chain

The docs now present PP as:

```text
XSUAA user → ARC-1 JWT → Destination Service → Connectivity proxy
→ Cloud Connector trust/resource mapping → short-lived X.509 certificate
→ SAP STRUST/CERTRULE/ICF mapping → SAP authorization
```

PP is the default customer path. Shared Basic remains an explicit, mutation-free exception with
shared SAP attribution, reusable credentials, exactly one CF process, and non-rolling deployment.

Cloud Connector wording must be version-aware. Newer versions expose an X.509 mode with a separate
system-certificate-for-logon choice; older versions use “general” and “strict” labels. The invariant
is strict user-certificate propagation with no system-certificate fallback, often represented as
`X509_RESTRICTED`.

### Lifecycle is mode-dependent

| Change | Required action |
|---|---|
| Destination add/remove or non-secret field change | Restart every ARC-1 process; no MTAR rebuild |
| Discovered multi-target Basic destination `User`/`Password` only | No restart; checked on the next protected request |
| Single-target `SAP_BTP_DESTINATION` credential | Restart every process; the destination is resolved at startup |
| SU01/CERTRULE/SAP authorization | Retry; no ARC-1 restart |
| Customer `.mtaext` or service topology | Build/deploy the reviewed desired state |
| `ARC1_DCR_SIGNING_SECRET` | Restart/restage after set; rotation revokes every DCR client |
| Role collection assignment | Obtain a new token and reconnect/restart clients that cache tools |
| Code/runtime dependencies | Rebuild and deploy |

`cf restart` reuses the staged droplet. `cf restage` rebuilds the droplet and is needed for staging or
buildpack changes. ARC-1's destination restart requirement exists because the registry is an
immutable startup snapshot, not because Destination Service generally requires restarts.

### Scaling is a security decision

PP-only deployments can scale after load testing. Each process has its own destination snapshot,
SAP semaphore, and process-local rate buckets; aggregate backend pressure is approximately
`instances × ARC1_MAX_CONCURRENT`.

Any multi-target Basic destination forces the entire application to exactly one process. Rolling or
blue-green deployment temporarily creates overlapping old/new processes, so this mode requires a
non-rolling maintenance window with downtime.

## Immediate documentation changes

- Make the BTP CF page the canonical MTA deployment runbook and start it with a four-mode decision.
- Add a common BTP administration page and a pre-customer acceptance/handover checklist.
- Remove the older PP procedure from the destination reference.
- Keep the multi-target setup page as a PP-first quick start; keep diagnostics and Basic operations
  in the administration page.
- Correct DCR, PP flag, role-collection upgrade, placeholder-destination, and rolling-update claims.
- Add mode-specific client URL and scope guidance.
- Add explicit terminology for SAP MTA packaging versus ARC-1 multi-target routing.

## Follow-up engineering proposals

1. Add an `arc1 btp doctor` command that validates bindings, startup invariants, expected role
   collections, safe route metadata, registry state, and a non-mutating target call.
2. Generate or validate the public destination-property and role-collection tables from their
   machine-readable sources to prevent drift.
3. Build the runtime module from an allowlisted staging directory and inspect the MTAR in CI for
   forbidden secret/key/config files.
4. Support a bound or file-based DCR signing key. Cloud Foundry environment variables are visible to
   sufficiently privileged platform operators and can appear in diagnostic output; docs cannot
   turn them into a full secret store.
5. Decide separately whether ARC-1 will publish signed MTAR artifacts. This can greatly reduce
   customer setup effort, but changes the release, provenance, vulnerability-response, and support
   contract.

## External sources

- [SAP: Deploying Applications](https://help.sap.com/docs/btp/btp-admin-guide/deploying-applications)
- [SAP: Defining MTA Extension Descriptors](https://help.sap.com/docs/btp/sap-business-technology-platform/defining-mta-extension-descriptors)
- [SAP: Destination Service](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/destination-service)
- [SAP: Access Destinations Editor](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/access-destinations-editor)
- [SAP: Set Up Trust for Principal Propagation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/set-up-trust-for-principal-propagation)
- [SAP: Configure Principal Propagation for HTTPS](https://help.sap.com/docs/connectivity/sap-btp-connectivity-neo/configure-principal-propagation-for-https)
- [SAP: Working with Role Collections](https://help.sap.com/docs/btp/sap-business-technology-platform/working-with-role-collections)
- [Cloud Foundry: Start, Restart, and Restage](https://docs.cloudfoundry.org/devguide/deploy-apps/start-restart-restage.html)
- [Cloud Foundry: Environment Variable Security](https://docs.cloudfoundry.org/devguide/deploy-apps/environment-variable.html)
- [Diátaxis documentation framework](https://diataxis.fr/)
- [Google developer documentation: Procedures](https://developers.google.com/style/procedures)
