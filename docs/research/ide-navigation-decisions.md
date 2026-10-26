# IDE navigation: decisions and alternatives

Consolidated 20 October 2026 for [draft PR #1025](https://github.com/arc-mcp/arc-1/pull/1025).
[Setup](../../docs_page/ide-integration.md) · [Verification](ide-navigation-verification.md)

## Current design

| Client | Responsibility | Additional configuration |
|---|---|---|
| VS Code + SAP ADT 1.2 | Copilot combines ARC-1 research with SAP's local MCP resolver and URI handler | SAP MCP enabled/logged on, tools available, user-confirmed local destination; no ARC-1 link settings |
| Eclipse | ARC-1 appends bounded SID links after successful research | Admin `off`/`eclipse` ceiling, real SID, per-request HTTP opt-in (or per-server stdio env) |
| Other clients | Ordinary ARC-1 responses | Links off; optional Eclipse handoff is explicit and its UI behavior needs qualification |

BTP retains its normal SAP authorization and connection. The editor needs its own SAP network route
and logon: Cloud Connector access from BTP does not give the laptop connectivity. ARC-1 never
connects to a laptop resolver or receives its token.

### VS Code resolver contract

Use `abap_object_get_file_uri` with ARC-1's name/type; no guessed filename or tree traversal:

```json
{
  "destination": "My-Dev",
  "objectIdentifiers": [
    { "objectName": "CL_ABAP_TYPEDESCR", "objectType": "CLAS" }
  ]
}
```

SAP's identifier `oneOf` accepts exactly one form: name/type, ADT URI, or AFF filename.
It is a schema rule, not an input field. Use `abap_object_list_file_uris` with singular
`objectIdentifier` for include selection; select the declared `mainFile` for main source.
The class base ADT URI can resolve to `.clas.json`; name/type resolves source in the tested cases.
Check returned name, type and source file: SAP accepted four mismatched/unknown type inputs.

Copilot wraps the **exact returned** `abap:` URI using:

```text
vscode://sapse.adt-vscode/open?abapUri=<encodeURIComponent(exact URI)>
```

Bare `abap:` Markdown rendered as text. SAP ADT 1.2's registered `/open` handler decodes the query
and opens it with `vscode.open`. An already escaped inner `%20` becomes `%2520` in the outer query.
Do not reconstruct the localized tree path, substitute a flat URI or assume every alias character
is qualified. The installed 1.1.2 bundle lacked this handler; open an ABAP workspace first.

The navigation hint is sent in full single-target and authorized multi-target MCP instructions.
`ARC1_SERVER_INSTRUCTIONS=short` omits it on single-target connections; pinned and aggregate routes keep it.
Its wording conditions navigation on a VS Code request and available native tools.
It says to stop on errors/mismatches, preserve ARC-1
denials and never edit/activate natively. **Instructions cannot enforce another server's behavior.**
URI resolution alone is not evidence of an opened editor.

### Destination identity

An ARC-1 connection/target, BTP Destination name, SAP SID/client and local ADT alias are different
identifiers. Developers may name the same local connection differently.

Installed SAP 3.62 inspection (`AdtMcpDestination.computeResolveProject`) found exact alias lookup
first, then the first logged-on SID match. The fallback checks neither backend nor client and
does not reject ambiguity. `abap_destination_list` returns names, not verified backend/client
metadata; it also returned aliases while project access failed. Neither one listed destination
nor a matching SID replaces user confirmation. SAP's destination allowlist controls access to the
resolved destination; it does not prove that it matches the ARC-1 backend.

The installed 1.2 manifest confirms **ABAP: Open Destination Settings (JSON)** as the command title
(`adt-vscode.openDestinationsJson`, category ABAP), rechecked 20 October.

Keep the confirmation in personal chat/instructions, scoped to the ARC-1 connection and target.
A future local picker could save that choice and invalidate it when either connection changes.
It is not implemented; supported local destination metadata would be needed for safer automation.

### Eclipse contract and unresolved selection

Emit `adt://<SID>/sap/bc/adt/...` for CLAS, INTF, PROG and DDLS main objects. The SID comes from
single-system configuration or the authorized target's `sap-sysid`, never its route alias.
No version query, fragment or include promise: inspected version handling invokes
`UnlockHandler.doUnlock`, so a version query is not assumed to be a passive selector.

`A4H_2023` and `A4H_2025` both have SID A4H/client 001. A chooser was observed, but ARC-1 cannot
force one or verify the chosen backend. Native selection is not fail-closed.

| Alternative tested/inspected | Finding and disposition |
|---|---|
| Encoded project authority | `H01.EN` selected `H01_EN`; backend unavailable, so opening unqualified. `A4H_2023` and `A4H.2023` failed Java URI host validation. Arbitrary names/collisions remain unsupported. |
| Destination ID / HTTP host authority | Installed matching code considers these after an exact project name (underscores converted to dots); no portable live contract established. |
| `sap-adt-project-*` parameters | Connection matching may launch project creation and includes credential/routing fields; excluded from simple links. |
| `eclipse+command://`, semanticfs/file paths | Broader command execution or local workspace dependence; no qualified object-opening contract. |
| HTTP landing page / 302 | Browser-to-Eclipse opened source; user confirmed Copilot-to-browser separately. Complete chain not observed in one attempt. Not shipped. |
| Local companion | Could verify an exact existing project, but adds installation/maintenance; defer until native matching options are qualified. |

Direct Eclipse Copilot dispatch remains inconclusive. User screenshots show chooser then source,
but not which adjacent direct/HTTP link initiated it. Automated clicks also failed on an HTTP
control, so those failures do not prove a scheme restriction. The inspected chat hyperlink path
uses JFace/SWT launch; no scheme allowlist was found there.

## Alternatives retired from this draft

| Approach | What it established | Why it was removed / when to revisit |
|---|---|---|
| ARC-1 builds `abap:/flat/<alias>/<AFF file>` | CLAS/INTF/PROG/DDLS and two class includes opened; `(namespace)name`, not `#namespace#name`, is the SAP AFF representation | Requires the same ADT extension, duplicates SAP resolution, couples ARC-1 to internal filenames and may create a second editor beside a dirty canonical URI. Revisit only with a demonstrated native-resolver gap. |
| Per-request VS Code alias map | Pinned/aggregate BTP preference isolation, encoding and exact target selection passed | Native composition keeps aliases local and removes the parser/configuration. Historical settings: `ARC1_IDE_DESTINATION`, `Arc1-Ide-Destinations-V1`, modes `vscode`/`on`. None is a current VS Code setup. |
| Infer editor from MCP identity/User-Agent | Three real-client loopback probes; VS Code and Eclipse also relayed to BTP | Hints are self-declared; stateless later requests lacked initialized clientInfo. They express neither preferred editor nor local backend mapping. Never cache the last preference by user/token/IP. |
| Infer SID from discovery/host | Both A4H discovery endpoints returned 200 without a usable SID | No hostname, cookie, object-master-system or project-count guessing. Eclipse uses explicit SID provenance. |
| Custom agent/proxy/bridge resolver | Earlier bridge tree search required 2,181 listings | Existing SAP MCP tools plus a short ARC-1 hint suffice for tested navigation; avoid another installed service. |
| Interactive alias input in MCP JSON | VS Code has input variables | Copilot harness compatibility differs; no universally portable setup. Prefer personal confirmation. |
| Plugin dropdown | Isolated `options` shape validated | Requires Claude Code 2.1.271+; keep ordinary off/default-empty string preferences pending a minimum-version policy. |

Earlier-draft migration: remove the old alias variable/map header; set VS Code link mode to default
`off`. Old `vscode`/`on` modes fail with guidance; old VS Code headers are inert. Use `eclipse`
only where explicitly wanted. Never use a process-wide alias shared by unrelated MCP servers.

## Original requirements still separate

The closed, unmerged [PR #676](https://github.com/arc-mcp/arc-1/pull/676) and
[ABAP Bridge](https://github.com/arc-mcp/arc1-abap-bridge) record native editing, Keep/Undo,
pre-save validation (`abapValidate`), editable active/inactive diffs (`abapChanges`) and proposal
review. Navigation does not replace those. Dirty-buffer identity, save, transport and activation
need their own tests. Session-release work already merged in #803; do not revive its old patch.
ADT 1.2 transport, notebook, policy and diagnostics work belongs to #1008–#1011.

## Code review and maintenance

The feature has no new SAP endpoint or tool schema. VS Code adds only shared initialize guidance.
Eclipse's formatter is the remaining runtime feature: known result envelopes, four source types,
eight unique links, 256 Ki characters/1,000 candidates, and no additional SAP request.

Keep these boundaries even when simplifying:

- Request preferences affect presentation only; recheck selected target/SID at the formatter.
- Decorate after authorization, post-dispatch checks and both nested/outer audits.
- Preserve original source/JSON/cache bytes; CLI exports disable presentation.
- Ignore arbitrary URLs, source/SQL/plugin text, failures, unsupported includes and malformed results.
- Keep initialize instructions under 2,048 characters, including escaped target labels.

TADIR lookup links require ADT provenance; references may also contain database-derived interface
implementers. A successful link is a navigation aid, not an additional existence/authorization check.

Review scope on 20 October: all feature runtime/configuration/manifest changes and their tests.
The substantial duplication was in documentation and the already removed VS Code path.
The cleanup removes the redundant SID-validation wrapper and replaces nested formatter selection
with explicit guards, preserving behavior. No new resolver layer or broader rewrite is warranted.
The offline Eclipse fragment helper remains useful for different client JSON shapes; auth/cache/target tests cover distinct boundaries.

An unrelated earlier review observation remains deferred: multi-target runtime configuration does
not inherit `ARC1_SERVER_NAME`. It is not the cause of Copilot's stale input-validator cache.

## Evidence and sources

Version-specific findings come from installed SAP ADT 1.2.0 / MCP 3.62.0, Eclipse ADT 3.60.2 and
the [live test record](ide-navigation-verification.md). Vendor code and private settings are not copied here.

- [SAP MCP setup](https://developers.sap.com/tutorials/abap-dev-adt-mcp-server-tools), rechecked 20 October: native MCP enablement, active destination and Copilot tool selection are still prerequisites.
- [SAP's MCP update and identifier interoperability](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-development-tools-mcp-server-major-update-available/ba-p/14496064), read during the original investigation; reopening on 20 October returned an error.
- [VS Code MCP setup](https://code.visualstudio.com/docs/agent-customization/mcp-servers) and [provider API](https://code.visualstudio.com/api/extension-guides/ai/mcp).
- [SAP ADT links](https://help.sap.com/docs/ABAP_Cloud/abap-development-tools-user-guide/4ec63adf6e391014adc9fffe4e204223.html) and [Eclipse hyperlink implementation inspected](https://github.com/microsoft/copilot-for-eclipse/blob/b314db437af736364f851334391bc06aa49a6105/com.microsoft.copilot.eclipse.ui/src/com/microsoft/copilot/eclipse/ui/chat/FileAnnotationHyperlinkDetector.java).
- [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

The nine dated notes were consolidated into this file and the verification record. Their complete
chronology, provisional configurations and superseded conclusions remain in the
[immutable pre-consolidation snapshot](https://github.com/arc-mcp/arc-1/tree/50ba71c6f0ce4da16fcbc73d7e907bb67a57685c/docs/research).
