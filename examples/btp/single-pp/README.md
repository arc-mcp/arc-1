# Single-target strict Principal Propagation

One `/mcp` endpoint, one intended system/client, per-user SAP requests. Start with
[shared preparation and ownership](../README.md); fill the [worksheet](../../../docs_page/btp-setup-worksheet.md).

| File | Owner-supplied replacements |
|---|---|
| [profile.mtaext](profile.mtaext) | Two destination names; other values are the reviewed conservative policy |
| [startup.destination.json](startup.destination.json) | Name, virtual URL, SID/client, label, least-privileged startup user and managed secret |
| [request.destination.json](request.destination.json) | Name, virtual URL, same real SID/client, label; optional connector location |

From the repository root, after checking that the destination file does not already exist:

```bash
cp -n examples/btp/single-pp/profile.mtaext mta-overrides.mtaext
```

`-n` avoids overwriting an existing override; if it already exists, compare it explicitly instead
of assuming this profile was copied. Prepare private destination copies as described in the shared guide.

The startup Basic destination and request PP destination must point to the **same intended physical
backend and client**. They may use different virtual mappings: Basic startup uses principal type
None, while PP uses strict X.509 user propagation. Use verified internal HTTPS for both. Matching
`sap-sysid`/`sap-client` labels alone is not proof; the connector/Basis owner confirms the mappings.
The startup identity is not a PP fallback. Never use a dialog administrator or `SAP_ALL` for it.

## Acceptance after approved deployment

- Record the actual route from `cf app <app-name>`, append `/mcp`, and log in as the intended
  application Viewer. CF CLI login does not authenticate that human to MCP.
- `SAPRead` with `type=SYSTEM`, `SAPRead` with `type=COMPONENTS`, and a bounded search of a known
  repository object should work. Verify the backend username, not only the upstream email. Empty
  ADT collections on some releases alone do not prove failed authentication.
- An unmapped or unauthorized test identity fails without switching to the startup user. Have an
  owner provide/approve a negative-test identity; do not alter working users to manufacture failure.
- Data/SQL/mutations and ATC/Unit are denied by this profile. Do not run them to establish identity.
- There are no multi-target routes. Repository metadata does not independently prove client
  isolation; use backend evidence from Basis or a separately approved existing client marker test.

Use [strict-PP setup](../../../docs_page/principal-propagation-setup.md) and the
[layered verification procedure](../../../docs_page/btp-cloud-foundry-deployment.md#10-verify-the-service-in-layers)
when a check fails. A successful health check alone is not a PP test.
