# Opt-in writes on pinned multi-target routes (ADR-0008)
Customer: personal · Project: arc-1 · Date: 2026-10-03 · Status: approved · Card: T-0087

## Goal
When ARC-1 runs in multi-target (multi-backend) mode, allow write and activate — and, per
destination opt-in, transport, SAPManage and Git mutations — for selected systems, configured
mainly on the BTP destination. Today any write-related `arc1.*` property quarantines the
destination (`UNSUPPORTED_V1_WRITE_CONFIG`) and the surface is mutation-free by construction
(ADR-0006, ADR-0007).

## Scope
**In**
- New ADR-0008 that amends ADR-0006: writes allowed **only** on pinned routes
  (`/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp`) of **PrincipalPropagation** targets, under a two-key opt-in.
- Tools on a writable pinned target: `SAPWrite`, `SAPActivate`, `SAPManage`, full `SAPTransport`,
  `SAPGit`, plus the write-only actions of `SAPLint` (formatter) and `SAPDiagnose` that v1 omitted —
  each gated by the same safety ceiling as single-target.
- Destination properties `arc1.allow_writes`, `arc1.allowed_packages`, `arc1.allow_transport_writes`,
  `arc1.allow_git_writes` become supported (only on PP destinations).

**Out**
- Writes on the aggregate `/multi/mcp` route, for every target, writable or not.
- Writes on `BasicAuthentication` targets (ADR-0007 stays as is).
- Plugins, caching and hyperfocused mode in multi-target mode (unchanged v1 restrictions).
- Per-target XSUAA roles (scopes stay instance-wide; SAP authorization is per user via PP).

## Approach
**Chosen: two-key opt-in, pinned + PP only.** Effective write permission for one call =
instance ceiling ∧ destination opt-in ∧ PP identity ∧ pinned route ∧ XSUAA scope ∧ SAP auth.
Same shape as today's data preview (`SAP_ALLOW_DATA_PREVIEW ∧ arc1.allow_data_preview`).

Rejected in one line each:
- *Destination-only*: anyone who can edit subaccount destinations could make ARC-1 writable; breaks the centralized-ceiling principle.
- *Shared Basic writes*: no per-person SAP authorization or attribution; shared lock/transport ownership.
- *Aggregate writes*: a wrong or hallucinated target ID becomes a write to the wrong system (the confused-deputy risk ADR-0006 rejected PR #543 for).

## Architecture
### Configuration
Instance (`.mtaext`, all default `false`; dedicated keys so the optional single-target `/mcp`
settings (`SAP_ALLOW_WRITES`, …) never leak into multi-target):

| Key | Meaning |
|---|---|
| `ARC1_MULTI_TARGET_ALLOW_WRITES` | Master ceiling. Without it every target stays mutation-free. |
| `ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES` | Ceiling for transport mutations (needs the master). |
| `ARC1_MULTI_TARGET_ALLOW_GIT_WRITES` | Ceiling for abapGit/gCTS mutations (needs the master). |

`SAP_DENY_ACTIONS` keeps applying to every target. Startup fails if a sub-ceiling is set without the
master; it warns if the master is set without `ARC1_MULTI_TARGET_ENDPOINTS`.

Destination (per system):

| Property | Rule |
|---|---|
| `arc1.allow_writes` | `true`/`false`; enables SAPWrite/SAPActivate/SAPManage. |
| `arc1.allowed_packages` | **Required** when `allow_writes=true` (no implicit `$TMP` default); same syntax as `SAP_ALLOWED_PACKAGES` (`$TMP`, `Z*`, `ZFOO/**`, `*`). |
| `arc1.allow_transport_writes` | Needs `allow_writes=true`. |
| `arc1.allow_git_writes` | Needs `allow_writes=true`. |

Discovery outcomes (destination-registry):
- A write property that requests writes (`true`, an invalid value, or `arc1.allowed_packages`) on a non-PP destination → **quarantined** `WRITE_REQUIRES_PRINCIPAL_PROPAGATION`; explicit valid `false` values keep it an enabled read target.
- Invalid boolean, missing/invalid `allowed_packages`, sub-flag without `allow_writes` → **quarantined** `INVALID_WRITE_POLICY`.
- Valid request but instance ceiling off → target stays **enabled read-only**, with a diagnostic that the
  requested policy was narrowed (same pattern as data preview today: `requestedPolicy` vs `effectivePolicy`).
- Write properties enter `requestedPolicy`/`effectivePolicy` and therefore the **fingerprint**: changing
  them after startup triggers the existing `TARGET_CONFIG_CHANGED` drift refusal; a restart reloads them.

### Runtime
- `TargetPolicy` grows `allowWrites`, `allowedPackages`, `allowTransportWrites`, `allowGitWrites`.
- `multiTargetSafety(policy, blockedDataSources, route)` gets a **required** `route: 'pinned' | 'aggregate'`
  parameter (playbook rule 4: security values ride required parameters). `'aggregate'` always returns the
  current mutation-free ceiling; `'pinned'` maps the effective policy.
- `buildMultiTargetConfig(base, target, route)`: same required route; `server.ts` passes `'pinned'` from
  the pinned factory and `'aggregate'` from the aggregate per-call path (`multi-target-server.ts:458`).
- `multi-target-tools.ts`: today's `MULTI_TARGET_TOOLS`/action allowlists/`ALLOWED_OPS` stay the
  **aggregate and read-only-pinned** surface. A writable pinned target uses the single-target
  pruning (`ACTION_POLICY` + safety), so every new write action still goes through
  `checkOperation`, package enforcement on the object's real package, and deny actions.
  `readOnlyHint` is forced only where the surface really is read-only.
- Pinned server instructions get a writable variant ("writes go to <SID>/<CLIENT> as your own SAP
  user; packages limited to …"). The aggregate instructions are unchanged.
- Stateful lock→modify→unlock already runs inside one tool call on the per-request PP client; no
  lock crosses an MCP round-trip (ADR-0006-mcp-legacy invariant unchanged).

### Data flow (one write call on `/DEV/100/mcp`)
XSUAA JWT → pinned handler → target `DEV/100` (fixed by route) → drift check (uncached Find, fingerprint) →
`buildMultiTargetConfig(…, 'pinned')` → `handleToolCall` (scope `write` ∧ safety ∧ package) → PP
destination → SAP as the caller's user (`S_DEVELOP`, `S_TRANSPRT`).

## Clean core
N/A (ARC-1 server code, no ABAP changes). What ARC-1 writes stays bounded by `allowed_packages` and SAP auth.

## Security
- Five keys must align: instance ceiling, destination opt-in, PP identity, XSUAA scope (`write`/`transports`/`git`/`admin`), SAP authorization.
- Destination admins can narrow but never exceed the instance ceiling; an instance admin alone cannot make a
  system writable either (destination must opt in).
- PP keeps SAP-native attribution and per-user `S_DEVELOP`; ARC-1 audit events already carry the target ID.
- Aggregate route can never mutate: enforced in the safety ceiling (`route` parameter) **and** in the tool surface.
- Security-model update: new residual risk "pinned connector set up against the wrong system" (mitigated by the
  route showing SID/client, `ARC1_SYSTEM_LABEL`-style instructions and package allowlists; prod destinations
  simply omit `arc1.allow_writes`).

## Environments
Code change in the open-source repo → PR to `arc-mcp/arc-1` (`feat:` → minor release). No `personal` BTP
landscape is wired, so live verification needs an authorized BTP CF test deployment with one PP destination.

## Testing
- Unit: registry (every quarantine/narrow/enable combination, fingerprint change), `multiTargetSafety` /
  `buildMultiTargetConfig` (aggregate always mutation-free even for writable targets), tool surface
  (new snapshot for pinned-writable; existing aggregate and read-only-pinned snapshots byte-identical),
  dispatch (write on aggregate refused, write outside `allowed_packages` refused, Basic quarantined),
  config validation (sub-ceiling without master), `mta-descriptor` tests if defaults are added.
- Gate: `npm test`, `typecheck`, `lint`, `validate:policy`, `build`, `check:sizes`.
- Live (PR template): create + activate a class in `$TMP` via the pinned route on a PP destination;
  confirm the same call on `/multi/mcp` is refused; confirm the SAP object's author is the caller.

## Risks & open questions
- Per-call PP logon with stateful sessions: lock→update→unlock in one call is what single-target PP already
  does, but the multi-target client is rebuilt per request — confirm live (816 session notes).
- `SAPManage` FLP / UI5-repo actions are gated by `allowWrites` but not by packages; acceptable (same as single-target).
- No live BTP landscape in `personal` → live evidence depends on the user's test subaccount.

## Decisions
- Two-key opt-in (instance ceiling ∧ destination) — user, 2026-10-03.
- PrincipalPropagation only; Basic stays read-only — user, 2026-10-03.
- Pinned routes only; aggregate stays mutation-free — user, 2026-10-03.
- Full write parity on pinned routes (write, activate, transport, SAPManage, Git), each separately gated — user, 2026-10-03.
- Plan gate (user, 2026-10-03): `admin` keeps implying write; Basic with only explicit `false` write keys stays readable; pinned OAuth metadata advertises write scopes whenever the instance ceilings are on; `arc1.allowed_transports` out of scope.
