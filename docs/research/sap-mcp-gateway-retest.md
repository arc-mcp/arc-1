# Retest ARC-1 behind SAP Integration Suite’s MCP Gateway

Use this runbook to repeat a read-only VS Code call, verify who executed it in ABAP, and decide whether a new SAP release can simplify the setup. It applies to one remote ARC-1 server on Cloud Foundry, in the same subaccount as the gateway, with one pinned principal-propagation target. The tested configuration requires no ARC-1 runtime change.

## Baseline from 19 November 2026

The request path was **VS Code → SAP-managed Integration Cell → ARC-1 → BTP Connectivity and Cloud Connector → A4H client 001**. The gateway imported an existing MCP tool. The Microsoft Copilot Studio example instead generates tools from Business Partner API operations and gives the gateway the SAP connection. Its user sign-in and backend identity checks are relevant to both designs. [Microsoft reference](https://learn.microsoft.com/en-us/azure/sap/microsoft-ai/copilot-studio/architecture-mcp-gateway-integration-suite) · [Walkthrough, part 4](https://github.com/hobru/sap-mcp-gateway-copilot-studio/blob/c31f5f34e26b96546c3982b6b91daa5b09e977d3/guides/04-principal-propagation.md)

| Boundary | Observation in the US10 Integration Suite Free tenant |
|---|---|
| Direct control | On deployed ARC-1 v0.9.27, a signed-in user read `CL_ABAP_CHAR_UTILITIES` via `/A4H/001/mcp`. The same call succeeded with a destination-exchanged token carrying the same user, tenant and IdP origin and only ARC-1's `read` scope. A CF platform-user token failed the exchange with `Unable to map issuer`. |
| Design time | Two labeled `OAuth2JWTBearer` destinations were visible under **Runtime** and absent under **Discovery**. Discovery offered the credential-free control and, later, the Basic catalog. With the credential-free control, the wizard returned HTTP 500 with zero tools while ARC-1 logged HTTP 401. Discovery with OAuth client credentials was not tested. This was an observation in one tenant. SAP's remote-source table lists JWT bearer and its editor documents separate destinations. [Creation](https://help.sap.com/docs/SAP_INTEGRATION_SUITE/9519789d5664487f8b9cd89eba514477/742216d01dfd4c58ab22090068216638.html) · [Editor][editor] |
| Workaround | A separate Basic-authenticated MCP catalog returned the deployed `SAPRead` definition. It had no SAP binding and rejected `tools/call` with JSON-RPC `-32601`. SAP imported one tool and started the artifact. The runtime destination still exchanged the human's credential for ARC-1. |
| Published endpoint | A local MCP client negotiated `2025-11-25`, listed exactly `SAPRead`, and received the class definition with HTTP 200 and no tool error. ARC-1's per-user audit and A4H workload statistics (STAD) matched at 11:03:20 UTC. |
| Native VS Code | VS Code 1.145.2 invoked the gateway tool through `vscode.lm.invokeTool`. The result contained the class declaration. ARC-1 recorded the exact object and active source GET. At 11:49:27 UTC, STAD showed one matching HTTP class read under the developer's mapped ABAP account in client 001. An assistant choosing the tool in a chat, a second user, refresh, quotas and schema synchronization remain untested. |

## Reopen the Free pilot

1. **Check the landscape.** Record date, region, plan, artifact version and deployed ARC-1 version. Use the BTP commands below with the intended subaccount ID. Check the CF target, routes and quota before provisioning anything. Reuse the active Free subscription, managed Integration Cell, API Management, Developer Hub and existing catalog where available. Free activation is time-limited and reactivation deletes previous integration content. Export the package before expiry and retain the catalog deployment bundle, schema, destination settings without secrets and OAuth callback details in the operator's handover. Store credentials separately. If the region or feature needs a paid plan, record that limitation and stop the Free test. [Free plan lifecycle](https://help.sap.com/docs/SAP_INTEGRATION_SUITE/51ab953548be4459bfe8539ecaeee98d/using-free-service-plans) · [Plan matrix](https://me.sap.com/notes/2903776)

   ```sh
   btp list accounts/entitlement --subaccount "$GATEWAY_SUBACCOUNT_ID"
   btp list accounts/subscription --subaccount "$GATEWAY_SUBACCOUNT_ID"
   cf target
   cf apps
   cf routes
   cf org "$CF_ORG"              # org shown by cf target
   cf org-quota "$CF_QUOTA_NAME" # quota name shown by cf org
   ```

   If the tenant has expired, first confirm the Free subscription and available CF quota in the target subaccount. Activate API Management with Developer Hub, then the SAP-managed Integration Cell under **Settings → Runtime**. Assign the artifact designer `PI_Integration_Developer`. Import the saved package and recheck its destinations and subscriptions. Free-tenant recovery was not exercised. Before retirement, an operator can use `cf download-droplet <catalog-app> --path catalog-droplet.tgz` for a pre-staged CF backup. Record its start command, CF stack and environment variable **names**. To restore it on a compatible stack, push to an approved disposable app with `cf push <new-app> --droplet catalog-droplet.tgz -i 1 -m 96M --no-route --no-start`, restore the protected configuration, map the approved Free route and start the app. The portable Node bundle in step 4 is a separate archive format. [Activate Integration Cell](https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ISuite_Integrations_APIs/activate-integration-cell-1a627da.md)

2. **Establish a direct control.** Use an individually mapped developer, an ARC-1 read role, writes disabled, and the known working pinned route. Call the tool below directly and confirm the expected ABAP account. For the runtime hop use an Internet HTTP destination with the ARC-1 origin, a dedicated consumer key for ARC-1's XSUAA client, its tenant token URL, `OAuth2JWTBearer`, and the qualified ARC-1 read scope. Set the BTP destination **labels** `IntegrationCell.Include=true` and `IntegrationCell.Provides=mcp`. Set the pinned path once in the artifact. The application user's assertion supplies the user context. [ARC-1 exchange setup](../../docs_page/xsuaa-setup.md#calling-arc-1-from-another-btp-application) · [SAP destination fields](https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ISuite_Integrations_APIs/configure-a-destination-to-connect-an-mcp-server-to-a-remote-mcp-server-1c8b388.md)

3. **Try native discovery first.** In a disposable copy or new artifact choose **Remote MCP Servers**. Compare the destination choices under **Source → Discovery** and **Runtime**. If the protected ARC-1 route can now be discovered, select only `SAPRead`, save, reopen, and verify both paths and authentication settings. If discovery fails, capture the wizard status, the upstream HTTP status (if reached), and the destination auth type shown in each list. Preserve the working artifact while testing.

4. **Restore the known two-destination configuration when needed.** For **Discovery**, use an HTTP destination with the catalog HTTPS origin, `ProxyType=Internet`, `Authentication=BasicAuthentication`, the two Integration Cell labels from step 2, and artifact path `/arc1-discovery/mcp`. For **Runtime**, retain the user's JWT bearer destination and the pinned ARC-1 path. Reopen the saved artifact to verify both.

   The pilot operator keeps `sapread-discovery-2026-11-19.tgz` alongside the pilot VS Code workspace configuration. Obtain it from the pilot owner for a rebuild. Extract it privately, verify `shasum -a 256 -c SHA256SUMS` and run `node --test server.test.mjs` with Node 22.19 or newer. Follow its `RESTORE.md` for the start command and a fresh catalog-only credential. The archive contains no SAP binding or credentials. If recreating the fixture independently, capture the complete `SAPRead` entry from the read-scoped pinned endpoint. Serve it verbatim through authenticated Streamable HTTP `initialize` and `tools/list`, accept the initialized notification, expose empty resource/prompt lists and reject `tools/call` with JSON-RPC `-32601`. Verify anonymous HTTP 401 and compare the entire tool definition before import. [Remote source configuration][editor]

5. **Publish and connect.** Deploy to the managed Integration Cell and copy the **Started** artifact's endpoint from **Monitor → Manage Integration Content**. In Developer Hub publish a product containing this artifact and register an Agent subscription with the editor callback. Use user authorization code with PKCE and store the client secret using VS Code's **Set Client Secret** action. In this tenant the Hub rejected the numeric loopback callback and accepted `https://vscode.dev/redirect`. Desktop VS Code offered **Try a different way? → URL Handler** after cancelling the loopback attempt. [Gateway XSUAA setup](https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ISuite_Integrations_APIs/configure-mcp-server-access-using-default-authentication-xsuaa-dc283ab.md) · [VS Code OAuth](https://code.visualstudio.com/api/extension-guides/ai/mcp)

   Substitute the published endpoint and client ID in the workspace's `.vscode/mcp.json`.

   ```json
   {
     "servers": {
       "arc1-gateway-free": {
         "type": "http",
         "url": "https://<integration-cell-host>/<published-artifact-path>",
         "oauth": { "clientId": "<developer-hub-subscription-client-id>" }
       }
     }
   }
   ```

## Run the read and check the backend

Use **MCP: List Servers** to start the configured server. Run each client separately and record the client and time.

1. **Repeat the native editor control.** The original test used a temporary extension in an Extension Development Host. Open the configured pilot workspace in that host and sign in there. In an async extension command with the `vscode` API in scope, select the exact gateway tool from `vscode.lm.tools`, invoke it and accept the editor confirmation. This example returns only the class-marker check.

   ```js
   const readTools = vscode.lm.tools.map(tool => tool.name)
     .filter(name => name.toLowerCase().endsWith('sapread'));
   const name = await vscode.window.showQuickPick(readTools, {
     placeHolder: 'Select SAPRead from arc1-gateway-free'
   });
   if (name) {
     const result = await vscode.lm.invokeTool(name, {
       input: { type: 'CLAS', name: 'CL_ABAP_CHAR_UTILITIES' },
       toolInvocationToken: undefined
     });
     const found = result.content.some(part =>
       part instanceof vscode.LanguageModelTextPart &&
       part.value.toUpperCase().includes('CLASS CL_ABAP_CHAR_UTILITIES DEFINITION')
     );
     vscode.window.showInformationMessage(found ? 'Class declaration found' : 'Check tool result');
   }
   ```

2. **Qualify the actual assistant.** Start a separate chat, select only the gateway's `SAPRead` and ask it to read the class. Record the actual tool name and new request. This adds coverage beyond the native API control.
3. **Compare with a local MCP client.** The original local probe used a dedicated Developer Hub subscription, user authorization code with PKCE S256 and a registered localhost callback. A repeatable alternative is MCP Inspector with Streamable HTTP, the gateway URL and its own subscription. Register the exact callback displayed by that client, configure its OAuth client ID and secret, sign in as the same user and send the following `tools/call` parameters. [Inspector OAuth configuration](https://github.com/modelcontextprotocol/inspector/blob/main/docs/mcp-server-configuration.md)

```json
{"name":"SAPRead","arguments":{"type":"CLAS","name":"CL_ABAP_CHAR_UTILITIES"}}
```

| Check | Evidence to retain |
|---|---|
| Ingress and tool result | Anonymous initialization receives 401. Signed-in initialization negotiates a protocol version, `tools/list` returns exactly `SAPRead`, and the result contains `CLASS CL_ABAP_CHAR_UTILITIES DEFINITION` without a tool error. An HTTP 200 can also carry an MCP error. |
| Unpublished tool (new test) | Confirm an unimported read tool such as `SAPSearch` is available and succeeds on the direct read-only route. Send the same benign call by name through the gateway with the same user. Expect rejection there and no corresponding ARC-1 tool-start event in the same window. A hidden tool that still executes fails the pilot. |
| Human identity | Correlate the UTC window, request ID, target and exact class GET in ARC-1's `auth_pp_created` and tool audit events. Capture STAD promptly, convert UTC to SAP system time, select the target client, include in-memory records and check the matching HTTP class read and its ABAP user. STAD can abbreviate the path. If multiple records match, repeat in a quiet window or obtain a backend trace before marking identity verified. [Backend identity checks](../../docs_page/principal-propagation-setup.md#verify-the-backend-identity) |
| Second user | Use an isolated VS Code session and separately authenticated browser session for B. For **each** user compare a direct read with the same gateway read. Include an object both can read to verify two distinct backend accounts. Separately use an object A may read and B is expected to be denied by SAP. Give both the ARC-1 read role so an upstream role denial cannot masquerade as an ABAP decision. Record the object, denying layer and authorization outcome. |
| Refresh and operations | Repeat after normal token expiry and reconnect. Verify the same backend user. Exercise revocation of a disposable pilot grant through its documented propagation/expiry window. For a configured gateway quota, use a small agreed test limit and compare its rejection with the presence or absence of an ARC-1 call. |
| Schema lifecycle | After an ARC-1 schema change, capture the upstream read-scoped `tools/list` again. If using the static catalog, refresh its snapshot first. On a disposable artifact choose **Synchronize**, inspect the diff, retain only the authorized tool, redeploy and compare the published schema and a real call. Restore the previous artifact/catalog pair if acceptance fails. [SAP synchronization procedure][sync] |

Keep a row per attempt. Use pseudonyms for user A/B. Keep production identifiers, user mappings, credentials, tokens and returned source in their appropriate private systems.

| UTC / region / plan | ARC-1 / artifact / client versions | Discovery + runtime auth and paths | MCP version / tool / call result | ARC-1 request / SAP client / ABAP user / decision | First failing hop / next check |
|---|---|---|---|---|---|
| _Run date_ | _Deployed versions and assistant_ | _Catalog or stock_ | _Status and class marker_ | _Correlated evidence, A or B_ | _Pass, fail or unverified_ |

## Reassess when SAP ships a relevant change

SAP's North Star calls for the registered agent and original human to be attributable and for the downstream credential to be scoped to the invoked tool. This pilot established the human and a read-scoped ARC-1 token. A Developer Hub subscription alone does not establish the signed agent identity or a per-tool backend grant. [SAP third-party MCP architecture](https://architecture.learning.sap.com/docs/ref-arch/137800) · [SAP agent identity](https://architecture.learning.sap.com/docs/ref-arch/140bdb)

SAP Road Map Explorer statuses below were **planned on 19 November 2026**. Use the item's current status, linked release documentation and availability in the test region/plan to trigger a rerun. A target quarter alone is insufficient.

| SAP signal | What to reassess and what would change the decision |
|---|---|
| **Remote discovery or authentication release note**, or SAP support provides a supported design-time credential. No published milestone for JWT-bearer discovery in this selector was identified. [Remote editor][editor] | Ask which credential the designer uses for unattended discovery of a protected remote server. Repeat native import and **Synchronize** against stock ARC-1, then run both users through the delegated runtime. Retire the catalog only when initial import, refresh and runtime identity all pass. |
| **Q4 2026**. AI Agent Hub inventory of Integration Suite MCP tools and integration with Cloud Identity Services agent identities. The identity item initially covers SAP-stack agents and mentions Joule Studio Early Adopter Care. [Inventory roadmap](https://roadmaps.sap.com/board?PRODUCT=73555000100800004545&range=FIRST-LAST#;INNO=A0C46AAA612145B8929B319BB6969780) · [Identity roadmap](https://roadmaps.sap.com/board?PRODUCT=73555000100800004545&range=FIRST-LAST#;INNO=F263C4EB04AD40F2B472CCF75306D1C0) | Check whether the pilot appears with its selected tool. Ask for the supported external-client registration and delegation contract. If available, use two agent registrations for the same user and verify distinct signed actors, stable human identity, intended audience and downstream permission for the invoked tool. Record independent audit evidence. Continue SEC-19 if a documented contract exposes an ARC-1 validation or audit gap. |
| **Q1 2027**. External MCP specification upload in Developer Hub, MCP verification through AI Agent Hub, and announced GA target for SAP Enterprise AI Gateway. [Upload roadmap](https://roadmaps.sap.com/board?PRODUCT=73554900100800003241&range=FIRST-LAST#;INNO=47D027C627094DEDA321C551E35E1D69) · [Verification roadmap](https://roadmaps.sap.com/board?PRODUCT=73554900100800003241&range=FIRST-LAST#;INNO=F9AE731E9E734AF195B4A16E836178F8) · [SAP announcement](https://www.sap.com/topics/events/teched/innovation-news-guide-2026) | Check separately whether upload creates only a catalog product or can also populate a deployable remote artifact. Test verification on a disposable product and confirm where it affects execution. Repeat the identity checks through any newly supported gateway path before recommending it. |
| **Q2 2027**. Integration Cell federation of multiple remote MCP servers. [Federation roadmap](https://roadmaps.sap.com/board?PRODUCT=73554900100800003241&range=FIRST-LAST#;INNO=D26B1B8E0C4540268DCBA385F5A61901) | Revisit only for a multi-server requirement. Test tool routing and separate user grants on each origin. The existing one-server route works independently. |

[editor]: https://help.sap.com/docs/integration-suite/isuite-integrations-and-apis/govern-and-manage-mcp-server-created-by-connecting-to-remote-or-third-paty-mcp-servers?locale=en-US
[sync]: https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ISuite_Integrations_APIs/synchronize-remote-mcp-server-changes-87ec798.md
