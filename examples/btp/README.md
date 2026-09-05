# BTP Principal Propagation setup packs

Start with [single PP](single-pp/README.md) for one system/client, or
[multi PP](multi-pp/README.md) for several mutation-free targets. These are complete **fictional
templates**, not deployment-ready customer settings. Use the files from your selected ARC-1
checkout; record `git rev-parse HEAD` and the package version in the
[shared worksheet](../../docs_page/btp-setup-worksheet.md).

Both packs extend this checkout's `mta.yaml`, which owns XSUAA, Destination and Connectivity
services. They inherit HTTP transport, XSUAA, TLS validation, the default route, one instance and
the normal process limits. They explicitly disable mutations, data/SQL, UI/plugins and ATC/Unit
workloads. Cache none is mandatory for multi-target and a conservative choice for single PP.

These are starting profiles for a **new, clean MTA-owned deployment**. They do not erase old app
environment variables or migrate an existing topology. First review existing overlays/env and
[configuration ownership](../../docs_page/btp-administration.md#configuration-ownership). Renaming
a service does not turn it into an externally managed resource. Writable single-target, UI,
shared Basic and external-service lifecycles remain separate advanced setups.

## Prepare locally

1. Complete the nonsecret worksheet with the owners. Do not copy customer values into tracked
   examples. Keep private working copies under the ignored `.arc1/btp/` directory, outside the
   deployable module. Copy the chosen extension to the ignored root `mta-overrides.mtaext`.
2. Replace every fictional SID, client, description and virtual URL with the owner's values;
   update destination names and the single-target extension references together. Keep `001`
   quoted as a string. JSON destination files describe fields to create/review in the cockpit;
   they are not an automatic provisioning script or a promise of a particular import UI format.
3. Add `CloudConnectorLocationId` only when supplied by the connector owner; omit it for the
   default location. Do not guess it. For duplicate real SID/client combinations, agree a public
   alias using the [destination reference](../../docs_page/btp-destination-setup.md#multi-target-destination).
4. Validate the extension with `npx mbt validate -e mta-overrides.mtaext`. Maintainer tests validate
   the tracked packs, not your edited private files. No offline check proves login or connectivity.
5. Have the Destination/Connector/Basis owners prepare the destinations, trust and user mapping.
   **Single PP requires its startup destination to exist before starting ARC-1**: startup resolves
   that destination and fails if it cannot be resolved. Prepare the request PP destination too.
   Multi PP can start with an empty catalog, but it needs a restart after destinations are added.
6. Follow the [deployment runbook](../../docs_page/btp-cloud-foundry-deployment.md): build and
   inspect the exact local MTAR, confirm CF context, then deploy only after owner approval.
   The selected override is passed at deployment. Do not combine both profiles or add UI overlays.
7. Have the IAM owner assign the least-privilege Viewer collection for the correct application
   IdP origin after the MTA creates the application roles. The MTA manages the XSUAA binding.
   Protect the persistent [DCR secret](../../docs_page/xsuaa-setup.md#stable-dcr-signing-key-recommended)
   through the existing operator process; never include it here.
8. Perform the profile's acceptance checks. Record both successful evidence and unresolved checks.

Only secure owners fill the startup `User`/`Password` placeholders. Offline inspection does not
need a real password. Never paste secrets, tokens, certificates/private keys or raw binding dumps
into an LLM or PR. These templates deliberately do not grant extra SAP roles or copy a SAP client.

## Maintain these examples

Source-reviewed against main `5c36f2a734870081780a5d4be734f605b1036318` (package 1.2.0);
that is a source baseline, not a claim that every older release supports the pack. Actual-file
config/registry tests and `npm run btp:validate` guard changes. Update the examples and guidance when
the supported runtime contract changes. Proposed target-authorization attributes are not part of
these profiles. No live customer verification is implied by a green fixture test.
