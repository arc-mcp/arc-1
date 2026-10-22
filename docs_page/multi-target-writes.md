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
off. Missing destination transport policy allows only positively verified local objects.

**Transport policy authorizes requests and their SAP-managed tasks.** In this example only
`DEVK900123` is allowed. If a caller supplies one of its tasks, ARC-1 verifies membership and uses
the parent request for the SAP save. A task-only allowlist entry does not grant its parent. The
request must be a modifiable Workbench request; unknown/mismatched recording evidence denies the
write. Manage requests in ADT/SAP GUI or a separately authorized single-target connection.

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

| Action | Requirements |
|---|---|
| `SAPWrite.create` | One CLAS or INTF; explicit package and complete source; required allowed request/task for a transportable package |
| `SAPWrite.update` | CLAS/INTF main source; `expectedSourceHash` from `SAPRead(format="editable")` |
| `SAPWrite.edit_method` | Existing CLAS main-source method; hash of the complete editable main source |
| `SAPActivate` | One CLAS/INTF owner; activates all of that owner's existing inactive drafts and includes |

Creates and edits save inactive source. Review it before activation. **Activation is whole-owner**,
including drafts created previously or by another session; it is not method-only activation.
Use `SAP_DENY_ACTIONS=SAPActivate` if your team must activate separately in ADT. Hidden actions,
other types, deletes, include editing, batches, RAP/DDIC, publication, transport management and Git
are refused even if a client sends the call directly. Per-call lint-disable options are unavailable.
ABAP Unit can execute newly authored code under the SAP user; deny `SAPDiagnose.unittest` unless
that execution is intended. Global lint configuration applies; `SAP_CHECK_BEFORE_WRITE` remains advisory. SAP authorization is
always required in addition to ARC-1 policy. Live qualification used SAP_BASIS 758 SP02 with
Cloud Connector PP. Other releases must affirm the same lock, recording and activation evidence;
unrecognized responses fail closed. An activation response without positive execution evidence
is reported as unconfirmed, even when the HTTP request succeeded. On the qualified 758 system,
activating an already-active owner returned no positive execution evidence and therefore this
unconfirmed result. Read the active/inactive state before deciding whether any action is needed.

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
| CTS denied | Explicit destination request allowance, global allowance, modifiable parent and exact task membership |
| Source changed | Read the same owner's editable main source again, review changes, and use its new hash |
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
