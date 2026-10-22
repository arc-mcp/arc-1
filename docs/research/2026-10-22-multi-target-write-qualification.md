# Pinned PP write qualification — 22 October 2026

This is a live evidence log for PR #1080, not a claim that the implementation is ready.
Preimplementation baseline: `11092547`, including `origin/main` `815e3ddb` (#1081).
The owner requests the complete scoped feature in one PR, with no separate beta release.

## Environment and isolation

The existing isolated `arc1-ta-677-test` CF application and its dedicated XSUAA instance were
reused. Its previous droplet and configuration were backed up privately. Other ARC-1 applications
and their shared XSUAA were not modified. At the protocol qualification stage the test application
still had `SAP_ALLOW_WRITES=false`: a local harness used its bindings, verified user token and a
loopback CF SSH tunnel to Connectivity. This is PP/ADT protocol evidence, not writable MCP evidence.
The SSH setting is temporary. Credentials/tokens and raw configuration remain outside the repository.

Selected target: A4H client 001 through the marked PP destination, SAP_BASIS 758 SP02.
Repository objects are cross-client; client 100 is not an independent write sandbox.
Disposable names use `ZCL_ARC1080_1022*` / `ZIF_ARC1080_1022*`.

## Confirmed observations

- An attribute-bearing `MCPTargetDeveloper` role can be created with the BTP CLI, assigned through
  a role collection, and populated with exact `arc1_targets` / `arc1_write_targets` values.
- Fresh authorization, refresh and same-application JWT bearer exchange retained both attributes.
  The read/write token held read access to A4H/001 and A4H/100 and write access only to A4H/001.
- A separately authorized **read-scope-only** token retained the write-target attribute. Both the
  verified raw functional scope and exact target grant must therefore be checked independently.
- PP CLAS and INTF create, source save, whole-owner activation and read-back succeeded in `$TMP`.
  Omitting `adtcore:responsible` produced SAP metadata `createdBy`, `changedBy`, `responsible=MARIAN`;
  the email display name was not used as the SAP identity.
- Local create preflight affirmed result S, package `$TMP`, insert operation, delivery unit LOCAL,
  local=true, recording=false and no CTS owner. The lock affirmed local=true and empty CORRNR.
- Both types also completed create/save/activation/read-back in `ZARC1_DEMO`, using a dedicated
  Workbench request. The lock returned the parent request; CTS stored the objects under its task.
- Passing the **task ID** to INTF creation was accepted, but source save with that ID returned HTTP
  500 and left a stub. Cleanup with the task ID did not remove it. Verified parent-request cleanup
  did. A subsequent run of both types using the canonical parent completed successfully.
- GET of the task's CTS URL returns the parent request containing that task. Existing
  `getTransport(task)` returns null because it searches only request IDs. The new resolver must
  validate exact task membership and canonicalize to the parent before submitting a mutation.
- Transportable modify preflight can report **recording=false while local=false**, with a parent
  request and tasks already holding the object. `!recording` is not proof of locality.
- Whole-owner activation with preexisting inactive local definitions/implementations completed in
  the first preaudit POST. It did not produce an expanded confirmation prompt on this system.
  Expanded-reference refusal therefore also needs controlled wire fixtures; no broader SAP shape
  is considered qualified by this test.

All created protocol-test objects were independently verified absent (GET 404). The dedicated
request A4HK906584 and task A4HK906585 were deleted and independently verified absent. One early
cleanup call omitted the required lock handle and failed with 423; the harness was corrected and
cleanup verified. Failed calls are retained as evidence, not counted as successful flows.

## Resulting design changes

1. Transportable writes are required before #1080 is ready; local-only stages are internal tests.
2. `arc1.allowed_transports` authorizes **canonical Workbench requests and their SAP-managed tasks**.
   Both global and destination lists constrain that parent. Task inputs are accepted only with
   verified membership in a modifiable parent; task-only allowlist entries do not grant the parent.
   This is an explicit request-level policy, not an undocumented task wildcard.
3. Check actual package and recording again under the editing lock. Reject ambiguity or drift;
   never infer local status from a name prefix or recording=false alone.
4. Preserve partial-create/unknown-save states and return `retryable:false`; no automatic mutation
   replay or generic “retry the 500” advice.
5. Document the verified BTP CLI role workflow alongside Cockpit instructions.

## Remaining acceptance

Runtime tests and the deployed writable MCP artifact must still establish route/grant isolation,
negative inputs, both package constraints, policy drift, hash conflicts, activation reference
refusal, cleanup/error behavior, real client authentication and final independent implementation
review. The earlier #677 refresh-token revocation finding remains a limitation: old refresh
sessions can retain removed assignments. This run has not yet repeated revocation or qualified a
second SAP identity. Passing protocol probes does not replace those checks.

## Initial deployed MCP findings

The official TypeScript MCP SDK completed protected-resource discovery, DCR, PKCE authorization
through ARC-1/XSUAA, callback token exchange and initialize on `/PR1080/001/mcp`. The verified
result held only read/write scopes despite the SDK requesting the advertised scope set. The pinned
catalog exposed the three SAPWrite actions and SAPActivate with mutation annotations.

The first deployment revealed `.cfignore` matching `public/` inside `dist/public`, dropping required
runtime modules. Anchoring that exclusion to `/public/` allowed the rebuilt application to start. This unrelated
packaging correction is split into [PR #1082](https://github.com/arc-mcp/arc-1/pull/1082).
The first MCP CLAS create/save completed on SAP, but strict read-back reported uncertainty because
SAP converted LF to CRLF. `SAPRead(format="editable")` independently showed the intended complete
source. The check was adapted to allow only CRLF/LF normalization and return the stored-byte hash.
This was a read-back classification failure, not a safe reason to recreate the object.

## Deployed implementation qualification

Build `ef2b14c7` (including source normalization, sibling-task membership and positive activation
execution evidence) was deployed to the isolated CF app at 15:25 UTC. Destination alias
`PR1080/001` pointed to the existing A4H/001 PP connection; its package policy was `$TMP,ZARC1_DEMO`
and its request policy named only the disposable Workbench request A4HK906586.

- Official SDK OAuth discovery/DCR/PKCE was already verified against the earlier implementation;
  subsequent calls retained that same user token and connection across deployments.
- Same writer token: aggregate `/multi/mcp`, Copilot `/authorize`, and read-only pinned A4H/100
  hid mutations and refused direct mutation calls. Pinned PR1080/001 remained writable.
- A fresh read-only-scope token carried the exact write attribute but exposed no write tools and
  refused activation. A second fresh IAS identity carried raw read/write scope and access to
  PR1080/001, but only an unrelated write grant; it also hid/refused mutations. Its SAP read was
  denied under PP, while the primary user's read succeeded. No shared-identity fallback occurred.
  This is a two-user negative isolation test, not a second SAP writer's positive qualification.
- A stale full-source hash was refused under the lock with state unchanged and retryable=false.
  A disallowed package and unresolved/deleted CTS request were refused before mutation.
- Local interface save exposed another normalization: SAP strips terminal newlines. The comparison
  now permits CRLF/LF and terminal line-break differences only, returns SAP's actual byte hash,
  and rejects other changed bytes. Controlled fixtures cover both acceptance and rejection.
- Task-selected create initially refused safely because the generic request parser ignores sibling
  task nodes in task-detail documents. The scoped resolver now reads the exact task's parent,
  independently fetches that parent's tree, and verifies exact modifiable membership before saving.
  Task A4HK906587 then successfully created and updated INTF using canonical request A4HK906586.
- Scoped activation now requires SAP's positive `activationExecuted="true"` checklist evidence;
  an empty, unknown or explicitly non-executed response is an uncertain result, never success.
  Initial and expanded-confirmation cases are covered in controlled tests; legacy parsing is unchanged.

A final 34-call MCP matrix on `ef2b14c7` passed: main-source update and CLAS method edit in
both local and transportable packages; new local CLAS/INTF creation with terminal newlines;
whole-owner activation for all six fixtures; independent active-source comparison against the
complete editable source in every case. The earlier CTS creation paths also succeeded, including
INTF task input mapped to the allowed parent. No retry was used to cover an uncertain mutation.
Final reviewer dispositions and environment cleanup are recorded below when complete.

## Cleanup and policy change verification

After the successful matrix, metadata for all six MCP-created fixtures confirmed
`createdBy=changedBy=responsible=MARIAN` and their intended real package. Each was deleted with an
owning lock and independently verified absent (GET 404). Request A4HK906586 and task A4HK906587
were also removed and independently verified absent. Earlier protocol fixtures had already been
cleaned. Test tokens and service credentials remain private and are not included in this record.

Changing only the disposable destination's write opt-in to false caused the still-connected writer's
next activation to fail with `TARGET_CONFIG_CHANGED` before SAP mutation. The global write switch
was then turned off and the test application restarted for the disable check.

After restart the still-connected writer saw only read tools and a direct activation was refused.
The disposable destination, both temporary role collections and all three temporary roles were
removed. The isolated XSUAA descriptor was restored. The application's user environment matches
its original snapshot exactly; SSH was disabled. Production applications and their shared XSUAA
were not changed.

Cloud Foundry expired the original 13 October droplet during repeated qualification deployments;
reassignment was refused because it was no longer staged. The reused, obsolete test app therefore
runs `028f0ab6` (current-main `815e3ddb` plus the isolated #1082 packaging correction), with the
original read-only environment. That exact standalone build started and passed MCP initialization
and a PP `SAPRead` of `CL_ABAP_CHAR_UTILITIES`. The packaging fix is excluded from #1080's final diff.


## Post-review qualification of 293cbaf2

The full unit suite passed 10,045 tests; typecheck, build, lint (three informational suggestions),
policy validation, file/schema budgets, strict docs build, standard MTA validation and the chained
pinned-write overlay validation passed. Latest main `06517021` (#1083, Windows documentation only)
was merged at `da44218c`; the deployed runtime remains the exact `293cbaf2` source.

Deployed at 16:11 UTC to the same isolated app using a private staging directory with #1082's
packaging exclusion correction. Fresh primary-user XSUAA login supplied raw read/write, read access
to PR1080/001 and A4H/100, and exact PR1080/001 write access. Six new fixtures (G/H/I suffixes)
covered local and transportable CLAS/INTF create, main update, CLAS method edit, whole-owner
activation and independent active-source equality. Parent request A4HK906588 was used for CTS
saves; the INTF create/update also exercised verified task A4HK906589. All passed.

The qualification journal contains 45 calls: 43 successful operations, one intentional repeat
activation of an already-active owner returning activation-not-confirmed, and one test-harness
SAPTransport call rejected for the wrong parameter `request`. The harness was corrected to `id`
and resumed from the known created fixture without replaying creation. The rejected call never
reached SAP. It was not an application defect.

New negative checks passed: existing request A4HK906522 could be read despite lying outside the
write allowlists, but using it for a source save was refused. Disallowed package and stale hash
were refused and the source hash stayed unchanged. Same-token aggregate, Copilot and read-only
pinned-target activations were refused. A fresh read-only token retained the exact write attribute
but exposed no mutation tools and refused activation while its PP source read succeeded.

Already-active owner activation on SAP_BASIS 758 did not affirm execution; the API conservatively
returned activation-not-confirmed rather than success. This is now explained in the operator guide.
Expanded preaudit confirmation, ambiguous CTS evidence, failed cleanup and network uncertainty
remain controlled-wire coverage, not claimed live fault injection. Only one positive SAP writer
was qualified; the earlier second identity supplied negative grant/PP-isolation evidence.

Post-review cleanup confirmed createdBy/changedBy/responsible=MARIAN on all six fixtures and
verified each object absent after deletion. Request A4HK906588 and task A4HK906589 were removed
and verified absent. Global write-off plus restart hid mutation tools and refused a direct call.
The disposable destination, role and collection were removed; original application environment
was restored exactly, original XSUAA descriptor restored, and SSH disabled. The app was returned
to the independently qualified #1082 droplet `028f0ab6` and is healthy. A private droplet backup was
made before this round so CF retention cannot prevent restoring that tested read-only baseline.
