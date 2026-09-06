# BTP Principal Propagation examples

These fictional examples are starting configurations for a **new, MTA-owned deployment**.
They are not customer-ready files or a migration procedure.

| Example | Use it for | Files |
|---|---|---|
| [Single system](single-pp/README.md) | One SAP system/client through `/mcp` | One extension, a Basic startup destination and a per-user PP destination |
| [Multiple systems/clients](multi-pp/README.md) | Experimental, mutation-free pinned and aggregate routes | One extension and two per-user PP destinations |

Follow the [deployment runbook](../../docs_page/btp-cloud-foundry-deployment.md) from your selected
checkout. Its step 4 selects one of these profiles; later steps prepare destinations, deploy and
verify it. Do not copy a profile and then overwrite it with the generic extension example.

Both profiles keep strict PP enabled and data/SQL, mutations, UI/plugins and ATC/Unit workloads off.
They inherit the checkout's MTA-owned XSUAA, Destination and Connectivity services. An existing
deployment needs a separate [configuration review](../../docs_page/btp-administration.md#configuration-ownership).

Maintainers: `npm run btp:validate` and `tests/unit/server/btp-pp-profiles.test.ts` check these files.
Those checks do not prove a customer's connectivity or SAP identity.
