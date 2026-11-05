# Private runtime trace and classic FLP adapters — 2 November 2026

PR 2 now has private native adapters for profiler requests, ST05 state and classic Fiori Launchpad
content. **Nothing is publicly admitted:** the capability matrix is unchanged, so pinned, aggregate,
Copilot, Basic and read-only routes all refuse these actions before PP preparation. This is offline
work. No SAP system, cloud service, browser or credential was used, and no result here is live proof.
It does not qualify PR 2 as a whole: other families and the current two-writer PP and
recording-transport runs remain open.

## Resource policy

Trace and FLP resources have no repository owner, so package lists never authorize them. As with the
formatter, each call requires the common pinned gates, then native SAP authorization decides.

| Family | Selected resource | Guard | Reported scope |
| --- | --- | --- | --- |
| Profiler request | One exact SAP user, the route's client, native server selection `*` | Explicit `traceUser` (never a login name), 1–100 executions, expiry above 0 and at most 24 hours | `scope` gives user, client and server; `request.actingUser` carries the native `admin` role |
| Profiler cancel | One entry listed for that exact user and client | The DELETE path comes from the native listing, not the caller's string | Native entry and absence readback |
| ST05 | Every application-server instance in the native document | Exact `user` to arm, `sqlOn=false` to disarm; refuses to replace a live filter | `clientIsolated: false`, `ownUserOnly: false`, all instances before and after |
| Classic FLP | One exact client-level catalog, group or tile | Exact identifiers, native type/scope/read-only checks, group-container relationship | `resource: classic-flp-client-content`, `recording: not-established` |

Read-only companions `flp_list_*` are candidates too. Reader catalogs stay unchanged apart from the
`traceUser` correction below.

## What the adapters do

**Shared lifecycle.** Every native call goes through `mutationHttp` and a registered
`PinnedMutationContext`, so it carries no-replay, no transient retry, the shared deadline and
cancellation. Each adapter checks cancellation before a submission and returns one truthful state.
No outcome triggers a retry or an automatic compensating write.

**`trace_start`** (`src/adt/pinned-trace.ts`). The two POSTs report separately:

| State | Meaning |
| --- | --- |
| `unchanged` / `parameters-rejected` | Nothing created |
| `parameters-unconfirmed` | First POST ambiguous, or it returned no usable location |
| `parameters-orphaned` | Parameters exist; the request was refused (`requestOutcome: rejected`) or never sent (`not-sent`). No native delete for them is known, so ARC-1 leaves them |
| `request-unconfirmed` | Second POST ambiguous or its response unusable; a request may be armed |
| `armed-unverified` | A request exists but differs from the selection, or its listing omits it. It is reported, not cancelled |
| `armed` | Create response matches user, client, executions, types and expiry |

Only the explicit native `trace` role counts as the traced subject. The legacy parser's role fallback
stays unchanged for its own callers.

**Readback that would consume the trace is skipped.** Live 758 evidence
([June research](2026-06-25-abap-trace-requests-and-sapquery-metrics.md)) shows an HTTP request armed
for a user is consumed by that user's next ADT call. A listing GET would use up the execution it is
checking. For `http` and `any` armed for the acting user, the create response is the evidence and the
result says `readback: skipped-would-consume-trace`. Other selections are read back.

**`trace_cancel`** lists the exact user's requests, requires one matching entry for that user and the
route's client, deletes the native path once, then reads back. Repository paths, traversal, absolute
URLs and other clients' or users' entries send no DELETE. `traceUser` is required because the native
listing is per user.

**`set_sql_trace_state`** reads the v1 document, refuses unknown shapes, edits only `sqlOn` and
`traceUser` on the raw XML, validates the prepared document, submits one PUT (`If-Match` when SAP
provides a strong ETag) and verifies every instance. Unrelated fields must match; SAP's modification
stamp, `isLocal`, `isSelected` and instance order are excluded because they can differ by responding
server. The trace intentionally stays armed after the call. Readback validation failures retain
`update-unconfirmed` and inspection guidance; only preflight failures can say no change was submitted.

Two decisions go beyond the plan's minimum and are recorded for review:

- **Arming refuses to replace a live filter.** One `traceUser` filter is shared by all trace types,
  so changing it would silently redirect another operator's active trace. Disarming stays allowed
  because it is an explicit request and reports the prior state.
- **`allUsers` is not in any schema.** The plan requires qualifying its native encoding before
  enabling that input. The adapter contains the mutual-exclusion and refusal logic only. Omitted or
  blank `user` refuses, so nothing inherits an empty filter.

**Classic FLP** (`src/adt/pinned-flp.ts`) reuses the existing `PAGE_BUILDER_CUST` calls through the
scoped transport:

- Identifiers exclude OData key delimiters, encoded characters and reserved `X-SAP-UI2-` prefixes;
  `/UI2/FLPD_CATALOG` cannot be selected.
- No keyed 404 proves entity absence: a service-level failure can also have an OData error envelope.
  Private catalog/group creation now refuses before SAP I/O until an entity-specific absence contract
  is qualified. No guessed SAP error code or substitute empty response is accepted.
- Catalogs that receive a tile or are deleted must be `CATALOG_PAGE`, `CUSTOMIZING` and not read-only.
  An assignment's source catalog only needs to be the exact catalog page, because the group is what
  changes. Groups must belong to the group container, have `scope=CUSTOMIZING`, and explicitly
  report false `isCatalogPage` and `isReadOnly` values. Missing or unknown flags refuse. The current
  private false-value candidates are `false`, `"false"` and `""`; their native domains still need proof.
- Nested `tile` fields are validated raw, because the schema would otherwise strip an unknown one.
- Tiles have no natural key, so a duplicate logical `tile.id` refuses. A page at the 500-entry read
  limit also refuses, because a full page cannot prove membership or absence. Tile targets must be a
  same-origin path, launchpad hash or `https` URL, because tiles are shared with other users.
- `flp_add_tile_to_group` verifies membership only from the native group listing. An HTTP success
  without that evidence is `membership-accepted-unconfirmed` with a manual Launchpad Designer step.
  Every returned tile row must belong to the exact requested page and have non-empty string instance
  and chip IDs; duplicate instance identities refuse. Foreign or missing ownership is never filtered
  away to infer absence, accepted as an existing member, or used as post-write verification.
- Deletion uses the canonical native key and reports `tilesAtDelete`; an accepted DELETE stays
  `delete-unconfirmed` until a qualified native absence discriminator exists. A readable keyed entity,
  malformed response, service error or generic 404 cannot produce `deleted`.
- Pinned lists use a bounded 8 MiB response, return at most 500 rows and label a full page, native
  continuation or larger native count incomplete. They do not follow continuation URLs. Only a
  successful OData collection proves emptiness; collection 404s, including OData errors, propagate
  as unavailable. Legacy single-target lists retain their prior behavior. Mutation verification
  refuses an incomplete collection even after a successful write and preserves its partial state.

## Admission state

| Entry | State |
| --- | --- |
| `pinned-mutation-capabilities.ts` | Unchanged. No trace or FLP row |
| `pinned-runtime-candidates.ts` | Final input contracts and projection, plus the scenarios each row still needs. Not consulted by public invocation |
| Public handlers | `handlePinnedTrace` and `handlePinnedFlp` refuse through `pinnedOperationContext`, instead of falling back to the legacy adapters |
| FLP mutations | A second independent lock: even with an admitted row, `handlePinnedFlp` refuses until recording evidence exists |
| Private entries | `executePrivatePinnedTrace` and `executePrivatePinnedFlp`, code-only qualification entries. They need a registered context and repeat the policy gates. FLP also needs a typed observation argument |

Offline tests replay admission with a mocked matrix to prove projection, scopes, denials and the FLP
recording lock. `allUsers` and quickfix are not candidates in this change.

## Named compatibility fix

`SAPDiagnose(trace_requests)` previously defaulted to `client.username`, a display claim from the
login token on PP routes. On multi-target PP routes it now requires `traceUser` or `user`, and the
catalog description says so. Single-target and shared Basic defaults are unchanged. This is the one
behavior change visible today.

## Native qualification recipe

Run on an isolated system and client, with disposable resources, one positive mapped writer and a
second identity whose IdP name differs from its SAP user. Separate direct-Basic observation from real
pinned PP evidence. Record build, release, route, client, prior state, outcome and cleanup. Use
`scripts/qualification/pr1142` conventions and the private entries. Representative 750, 758 and 816
routes are expected where available.

| ID | Scenario | Required evidence | If absent |
| --- | --- | --- | --- |
| TRC-1 | PP `trace_start` for the mapped writer through Cloud Connector | `admin` and `trace` roles name the mapped SAP user, not the IdP name; returned client equals the route | Keep closed |
| TRC-2 | `trace_start` naming the second identity | SAP authorizes or refuses; `actingUser` differs from `traceUser`; the listing readback does not consume the request | Keep explicit-subject input closed |
| TRC-3 | Fault injection on each POST | Orphaned or unconfirmed state matches native listing; no replay on the wire. Determine whether orphaned parameters expire or can be deleted | Document the leftover; do not claim cleanup |
| TRC-4 | Selection fidelity | Native user grammar for the characters ARC-1 accepts; `expires` rounding against the 60-second tolerance; maximum executions; PP client on `any`, `dialog`, `batch`, `rfc`; multi-instance behavior for `server=*`, including whether creation returns one request or one per instance. The current adapter accepts exactly one entry | Narrow the accepted grammar or bounds; keep multi-instance start closed if its shape is incompatible |
| TRC-5 | `trace_cancel`, including an already consumed or expired entry and another client's entry | Listing returns the same id spelling; DELETE then absence; refusal for other clients | Keep closed |
| ST5-1 | Exact-user semantics | Whether `traceUser` accepts patterns natively, and the exact-user behavior on 750, 758 and 816 | Keep closed |
| ST5-2 | Native all-users representation | Whether an empty filter means all users, per release. Only then add `allUsers` to schema, runtime and handler together | `allUsers` stays absent |
| ST5-3 | Multi-instance behavior | PUT reaches every listed instance; readback agrees across responding servers; ETag and `If-Match` behavior; whether `isLocal`/`isSelected` change between responses | Report unconfirmed; keep closed |
| ST5-4 | Prior-state restoration | Capture the prior document; arm; disarm; restore through a harness-owned step. The adapter keeps the filter on disarm and has no generic XML restore. Another operator's active trace must stay untouched and be recorded | Keep closed |
| FLP-1 | Non-ADT route on PP | Cloud Connector exposes `PAGE_BUILDER_CUST`; CSRF token from the ADT bootstrap is accepted on OData writes with no replay; SAP roles recorded; keyed `Catalogs(...)` and `Pages(...)` GETs work, including a qualified discriminator between entity-not-found and service/gateway failure. An OData error envelope alone is insufficient; no keyed absence classifier currently exists. Lists return valid collections and truthful cap/continuation/count information; collection errors never mean zero entries | Keep closed; no Basic fallback |
| FLP-2 | Customizing recording and allowed request selection | Use clients with automatic recording, changes without recording, and no changes allowed; test no open, one open and several open customizing requests for the mapped SAP user. Before each mutation, establish recording (or native refusal of unrecorded changes) AND check the selected request/task against both allowlists, or prove native selection constrained to them. An operator declaration or post-write CTS result alone is not evidence of this precondition | **Public FLP mutations stay closed** |
| FLP-3 | Catalog create (private submission currently refused) | First qualify FLP-1 absence before implementing this preflight; then native response and keyed readback match the checked `id`, `domainId`, `type`, `scope`; `isReadOnly` is present and its false-value domain is established. Missing/unknown values cannot prove writable ownership | Adjust the shape with authoritative evidence or keep closed |
| FLP-4 | Group create (private submission currently refused) | First qualify FLP-1 absence before implementing this preflight; then native `id`, group-container relation and `scope=CUSTOMIZING`; explicit presence/value domains of `isCatalogPage` and `isReadOnly`. Prove customer writable content separately from delivered or cross-client groups | Adjust the shape with authoritative evidence or keep closed |
| FLP-5 | Tile create | Stored configuration equals the requested fields through the association; native length limits; instance id grammar | Adjust or keep closed |
| FLP-6 | Tile assignment | Group `PageChipInstances` read is supported on all releases, with no ST22 dump; every tile row identifies the requested `pageId`, a unique non-empty `instanceId` and the composite `chipId` | Report `membership-accepted-unconfirmed` permanently, with the manual step |
| FLP-7 | Catalog delete | Qualified entity-specific absence proof that distinguishes service/gateway failures; effect on tiles and on groups that reference them. The private adapter currently leaves every accepted deletion unconfirmed | Keep closed; do not infer deletion from generic 404 |

Admission after these pass: move the row into `pinned-mutation-capabilities.ts`, update the
capability tests and inventory, then run a real MCP client through the fresh catalog. Remove the FLP
recording lock only with both FLP-2 preconditions proven. Capture sanitized native status, relevant
headers/error bodies and keyed readback after every refusal; any success additionally needs the
recorded request/task, mapped SAP owner and entries, including catalog deletion's nested effects.
Compare a proposed pre-mutation signal with every matrix cell; any wrong prediction disqualifies it.

## Concrete open design decision

**FLP-2 may have no acceptable answer.** PAGE_BUILDER_CUST has no preview step, and the
[review](multi-target-write-parity/claude-followup-review.md) rules out an operator declaration. If
qualification finds neither a native pre-mutation recording signal nor native refusal of unrecorded
changes, FLP mutations stay a named gap. Even when recording is proven, the selected request must
be checked against both allowlists before the call, or native selection must be proven constrained
to those allowlists. Recording into an arbitrary open request is insufficient. The list reads could still be admitted
separately. Reporting that gap is the correct outcome; no workaround is designed here.

## Offline validation

Based on `13f5518a`, uncommitted, author run only: 505 files and 13,673 unit tests, three TypeScript
projects, build, lint (three existing informational findings), policy, file and schema budgets and
the strict documentation build pass. Tool-definition snapshots are unchanged. The
[independent review and follow-up](2026-11-02-pinned-trace-flp-review-followup.md) record later
corrections and checks; every native scenario above remains open.

## Limits

- Private catalog/group creation is not implemented while native entity absence remains unqualified;
  private catalog deletion cannot report a verified success. These are explicit FLP-1/3/4/7 gaps.
- ST05 filter restoration to empty needs a harness step until ST5-2 settles.
- Trace users outside `[A-Z0-9_.@&-]`, up to 12 characters and starting alphanumeric, refuse.
- Tile creation in a catalog and assignment from or to a page listing 500 tiles refuse.
- The private entries take a caller-built config. Their exact-grant gate is the destination write
  policy that `buildMultiTargetConfig` projects from the verified token, so a harness must build the
  config that way. They do not repeat the public route's token-scope check.
- A same-user HTTP request can still be consumed by any later call on the connection. The result's
  `next` text says so; this is inherent to the native mechanism.
- Only classic catalog, group and tile content is covered, not spaces, pages or Work Zone.
- Offline coverage combines earlier native research with synthetic candidate shapes. The role-bearing
  profiler feed and FLP ownership fields are not established by that research; TRC-1 and FLP-3/4 must
  prove them. No new native observation was made for this component.

## Native create-only follow-up

The [3 November candidate](2026-11-03-pinned-flp-create-only.md) supersedes the private create refusal
in FLP-3/4 above: it relies on the native locked duplicate check and preserves lookup uncertainty.
The source confirms that `604` can hide provider/cache failures, so FLP-1 does not establish read
absence and FLP-7 deletion stays unconfirmed. Recording/request selection, native create/error/
cleanup scenarios, current-code PP and public admission remain open.
