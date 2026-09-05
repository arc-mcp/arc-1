# PP-only multi-target setup

Two fictional targets, `QAS/001` and `QAS/100`, each using a user's propagated SAP identity.
Start with [shared preparation and ownership](../README.md) and the
[worksheet](../../../docs_page/btp-setup-worksheet.md). This mode remains experimental and mutation-free.

| File | Owner-supplied replacements |
|---|---|
| [profile.mtaext](profile.mtaext) | No target values; explicitly enables the conservative multi-only mode |
| [qas-001.destination.json](qas-001.destination.json) | Destination name, virtual URL, real SID/client and factual label |
| [qas-100.destination.json](qas-100.destination.json) | Destination name, virtual URL, real SID/client and factual label |

From the repository root, after checking that the destination file does not already exist:

```bash
cp -n examples/btp/multi-pp/profile.mtaext mta-overrides.mtaext
```

If the override already exists, compare it; do not assume `cp -n` changed it. Prepare private
destination copies as described in the shared guide. Keep `SAP_BTP_DESTINATION` and
`SAP_BTP_PP_DESTINATION` absent, including from existing app env: this pack does not configure `/mcp`.
Do not add direct SAP credentials, cookies, plugins, an API-key alternative or the Basic exception.

Create the two destinations at **subaccount** level. Ensure no service-instance destination shadows
either name. Their virtual URL must match an internal HTTPS Cloud Connector mapping with strict
X.509 user-certificate propagation, not system-certificate fallback. Both client numbers remain
three-character strings. Adding a client destination does not create/copy the SAP client or its users.

## Acceptance after approved deployment

1. Restart all ARC-1 processes after destination creation/nonsecret changes. Read the actual route
   from `cf app <app-name>`; connect to `/multi/mcp` or a pinned `/QAS/001/mcp` endpoint.
2. As the intended Viewer, call `SAPTargets` on `/multi/mcp`. For these two valid targets it lists
   `QAS/001` and `QAS/100`, both `per-user`. The catalog is configuration inventory, **not proof of
   that user's SAP access**, and current v1 does not hide targets per user.
3. Select each target explicitly for `SAPRead(type=SYSTEM)` and `SAPRead(type=COMPONENTS)`; perform
   one bounded known-object search. Verify the backend username. A pinned call needs no `target`.
4. Confirm `/mcp` is unavailable and pinned routes never list `SAPTargets`. Have an already approved
   Admin inspect quarantine/shadow diagnostics when needed; do not grant Admin merely for discovery.
5. Data/SQL, mutations and ATC/Unit are denied by this profile. A separately approved pre-existing
   client marker can support client-isolation testing; do not enable data or create a marker just
   to get a green deployment check. Repository metadata is shared across clients.
6. With an owner-approved negative identity, verify failed PP/SAP authorization does not become
   Basic access. Record outcomes per client; no result on one client proves the other.

Continue with [setup](../../../docs_page/multi-target-setup.md) and
[administration](../../../docs_page/multi-target-administration.md) for exact boundaries and recovery.
