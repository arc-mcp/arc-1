# Write to a pinned SAP target

Multi-target writes use the existing pinned URL and the existing `SAP_ALLOW_WRITES` switch.
They require Principal Propagation (PP), target-filtered authorization, destination opt-in,
and a separate exact write grant. Enabling the global switch alone grants no multi-target writes.

| Connection | Reads | Scoped object writes |
|---|---|---|
| Pinned PP `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp` | Subject to access grants and SAP authorization | Only when every write gate below agrees |
| Aggregate `/multi/mcp` | Explicit target on each call | Never |
| Copilot `/authorize` compatibility connection | Aggregate reads | Never; register a separate pinned connection for writing |
| Pinned BasicAuthentication | Shared technical identity | Never |
| Independent single-target `/mcp` | Existing single-target rules | Existing single-target rules; this guide does not change them |

Use the [CF deployment runbook](btp-cloud-foundry-deployment.md),
[multi-target destination setup](multi-target-setup.md), and
[target authorization guide](multi-target-authorization.md) first. Target-filtered mode cannot coexist
with an independent single-target destination in the same application. The example below adds writes
to a configured target-filtered PP deployment; it is not a second deployment recipe.

## Configure one writable and one read-only target

The validated [write overlay and destination example](https://github.com/arc-mcp/arc-1/tree/main/examples/btp/multi-pp)
provide this configuration with fictional targets. In the application's MTA extension `properties:` (or equivalently `cf set-env`), set:

```yaml
SAP_ALLOW_WRITES: "true"
SAP_ALLOWED_PACKAGES: "$TMP,ZTEAM/**"
SAP_ALLOWED_TRANSPORTS: "DEVK9*"
ARC1_MULTI_TARGET_ENDPOINTS: "true"
ARC1_MULTI_TARGET_AUTHORIZATION: "xsuaa-attribute"
ARC1_CACHE: "none"
ARC1_TOOL_MODE: "standard"
ARC1_UI: "off"
```

Keep the existing XSUAA/Destination/Connectivity bindings and PP configuration. Do not add a
second write-enable parameter. Plugins and shared cookies remain unavailable in multi-target mode.
`SAP_ALLOW_TRANSPORT_WRITES` and `SAP_ALLOW_GIT_WRITES` need not be enabled: transport/Git
**management** is outside this write surface.

On the enabled **PP destination** for development target `DEV/001`, add:

```properties
arc1.allow_writes=true
arc1.allowed_packages=$TMP,ZTEAM_COMPONENT/**
arc1.allowed_transports=DEVK900123
```

Keep the destination's real `sap-sysid`, `sap-client`, URL, Cloud Connector location and optional
`arc1.target_alias` from the existing setup. On read-only target `QAS/001`, omit all three write
properties. A pinned URL names the public target ID, including its alias if configured.

**Both package lists apply.** A package must match the global list and the destination list.
Here, `ZTEAM_OTHER` is not writable merely because it matches the global subtree. Conversely, a
destination cannot permit a package excluded globally. Existing-object checks use the real SAP
package, not a package supplied by the caller. Package subtree lookup failures deny the write.

Destination package lists support exact names, prefix patterns (`ZTEAM*`), DEVCLASS subtrees
(`ZTEAM/**`) and explicit `*`. Transport lists support exact request IDs, prefixes and explicit `*`.
Lists are bounded to 128 entries, 128 characters per entry and 8192 characters total; use ASCII,
commas and optional surrounding spaces. Empty entries and malformed values quarantine the destination.
A package list is required whenever the destination requests writes, even while the global switch is
off. Without a destination transport list, every request is refused; only saves that carry no
request at all remain possible.

**Transport policy authorizes requests.** In this example only `DEVK900123` is allowed. Every CTS
request ARC-1 sends to SAP must be on both lists — whether the caller supplied it or SAP returned it
from the object lock — and is checked again on the wire before the request leaves ARC-1. A request
off either list is refused before SAP sees it; a lock already taken is released. A save with no
request at all is decided by SAP, which refuses a transportable object without one; ARC-1 does not
prove that an object is local (for example in `$TMP`). ARC-1 does not map a task to its parent
request: a task ID is refused unless the task itself is on both lists. List and pass parent
requests; on SAP_BASIS 758 a save with a task ID failed and left an empty object stub. Manage
requests in ADT/SAP GUI or a separately authorized single-target connection.

## Assign the exact write grant

Deploy the updated `xs-security.json` to the application's XSUAA service. It adds the
`MCPTargetDeveloper` template; it does not grant users access automatically. In BTP Cockpit,
create a concrete role from that template with:

| Attribute | Example values | Meaning |
|---|---|---|
| `arc1_targets` | `DEV/001`, `QAS/001` | Targets this user may access |
| `arc1_write_targets` | `DEV/001` | Exact targets this user may write through pinned PP connections |

First enable and verify `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute` on the application.
`MCPTargetDeveloper` carries application-wide read/write scopes; its attributes only restrict access
in that enforced multi-target mode. Do not assign it to standard or single-target apps expecting
target isolation, or reuse an XSUAA service/role collection across apps without checking each app.

Add that concrete role to a collection and assign the collection to the intended user or identity
group. The template supplies `read` and `write` scopes. Read `*` is supported by the existing read
contract; write `*`, globs and comma-separated values inside an attribute value are rejected.
Admin does not bypass the exact write grant. A token containing a write-target attribute but only
read scope cannot write either.

The equivalent BTP CLI role creation was verified during qualification. Target the intended
subaccount first, obtain the actual application ID from `btp list security/app`, and save:

```json title="target-developer-attributes.json"
[
  { "attributeName": "arc1_targets", "attributeValueOrigin": "static", "attributeValues": ["DEV/001", "QAS/001"] },
  { "attributeName": "arc1_write_targets", "attributeValueOrigin": "static", "attributeValues": ["DEV/001"] }
]
```

```sh
btp create security/role "Develop DEV, read QAS" --of-app "<application-id>" \
  --of-role-template MCPTargetDeveloper --attributes target-developer-attributes.json
btp create security/role-collection "ARC1 DEV developers"
btp add security/role "Develop DEV, read QAS" --to-role-collection "ARC1 DEV developers" \
  --of-app "<application-id>" --of-role-template MCPTargetDeveloper
btp assign security/role-collection "ARC1 DEV developers" --to-user "<user>" \
  --of-idp "<configured-identity-provider-origin>" --create-user-if-missing false
```

Use the actual trust origin from your subaccount, not a guessed email-to-SAP mapping. SAP PP maps
the signed-in identity to the SAP user; ARC-1 does not use the JWT email as object responsible user.

Restart every ARC-1 application instance after changing destination or server policy. Then register
`https://<arc1-route>/DEV/001/mcp` as a separate MCP connection, request read/write scope, sign in
fresh and refresh the tool catalog. Keep `/multi/mcp` for cross-target reads. A client that exposes
only the aggregate compatibility connection cannot write through that connection.

## What the writer can do

`SAPWrite` (every action except `edit_content`) and `SAPActivate action="activate"` (single and batch) behave as on a
single-target connection: same types, fields and result text. The pinned connection adds only these
controls, each enforced once for every handler:

| Control | Effect |
|---|---|
| Who may write | Pinned PP route, strict PP, raw write scope, exact read and write grants, destination opt-in |
| Admission | Explicit `Tool.action` list. Fields outside the single-target schema and `preaudit=false` are refused. `edit_content` and `publish_srvb`/`unpublish_srvb` are not admitted |
| Package ceiling | Global **and** destination package lists, against the real SAP package |
| Request ceiling | Global **and** destination transport lists, for the caller's request, every request sent to SAP and the request an object is locked in |
| No transient retry | POST/PUT/DELETE are not resent after a 503, 429 or lost database connection; the error is reported. Definitive rejections (expired session, a 403 with SAP's CSRF challenge, content type) are retried once; a plain authorization 403 is not resent |
| Activation scope | If SAP would also activate an object you did not list (other than a sub-resource of one you listed), nothing is activated; list it in `objects[]` to include it. `edit_text_symbols` activates exactly its own text pool after the save |

CLAS and INTF follow the same rules as every other type; the earlier CLAS/INTF-only contract
(ADR-0010) is replaced. Compared with it you no longer get read-back comparison after save,
re-validation under the lock, task-to-parent request resolution, positive activation-execution
evidence (an explicit "not executed" answer from SAP is reported as a warning), a JSON
`state`/`phase` result, or a mandatory source hash: `expectedSourceHash` is
optional, as in single-target, and recommended for updates. Saves remain inactive until activation. Whole-object activation can include other
users' inactive parts of the **same** object, as in single-target; other objects are never pulled in.
Per-call `lintBeforeWrite=false` is accepted as in single-target; lint is not an access control.

Package and CTS management, service-binding publication, Git, and plugin tools remain unavailable,
even if a client sends the call directly. ABAP Unit can execute newly authored code under the SAP
user; deny `SAPDiagnose.unittest` unless that execution is intended. Use `SAP_DENY_ACTIONS` to
narrow further (for example `SAPWrite.delete`). SAP authorization is always required in addition
to ARC-1 policy. This surface is tested against mocks only until live qualification is recorded
(the earlier CLAS/INTF adapter was qualified on SAP_BASIS 758 SP02 with Cloud Connector PP).

A hash establishes source freshness, not target identity. Verify the pinned connection before
editing. SAP repository objects are generally cross-client: two clients of one physical system are
not independent development sandboxes.

## Diagnose, disable and recover

`SAPTargets` is available to readers with more than one visible granted target and to admins;
with one target use its pinned connection and tool catalog. On the aggregate connection it reports a bounded `pinnedWrite` status for configured write
targets visible to the caller. Admin diagnostics additionally show configured/effective flags,
rule counts and a policy digest. No raw restriction list or destination credential is exposed.

| Symptom | Check |
|---|---|
| No write tools on the pinned PP connection | Global switch, destination opt-in, target-filtered mode, fresh token's raw write scope, access grant and exact write grant |
| Destination quarantined | Strict property syntax; PP required for write opt-in; standard mode rejects write properties; transport/Git enabling properties are unsupported |
| Package denied | Both independent allowlists and the real SAP owner package; subtree metadata access |
| CTS denied | The request (or task) itself must be on the destination list and the global list; this includes a request SAP returns from the object lock |
| Source changed | You passed `expectedSourceHash`: read the editable source again, review changes, and use its new hash |
| Activation refused: SAP would also activate … | Another inactive object is pending. Review it, then list it in `objects[]` or activate it separately |
| Text elements saved, activation not confirmed | Program pool: `SAPActivate type="REPT"`; if SAP proposes the program too, list both in `objects[]`. An inactive pool blocks deleting its program |
| Activation not executed (warning) | SAP accepted the request without activating. Check the object with `SAPRead version="inactive"` |
| `TARGET_CONFIG_CHANGED` | Restart all instances after reviewing the changed destination; never silently remap an old ID to another backend |
| Partial/unknown write result | Inspect the object, inactive source, CTS recording and locks. Do not automatically replay; creation may have left a stub or a save may have completed |

For immediate administrative disable, set `SAP_ALLOW_WRITES: "false"` and restart all instances,
or turn off the destination's write opt-in. A changed destination fingerprint refuses subsequent
lookups immediately; restart every instance to adopt the new snapshot. Already admitted work may complete. Merely
removing a role is not immediate revocation: old tokens and refresh sessions can retain grants.
Require fresh authorization and verify the new effective permissions after IAM changes.

Keep the prior application artifact/configuration for rollback. Old binaries quarantine destinations
containing the new properties. On upgrade, those previously quarantined destinations may become
readable (and writable only if all new gates agree); review them before upgrading. Restore the corresponding destination configuration when rolling
back. Do not delete an MTA property to turn it off; explicitly set its false value. Audit delivery
retains the existing asynchronous BTP Audit Log contract; monitor failures rather than assuming a
write waits for a durable audit acknowledgement.
