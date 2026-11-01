# ARC-1 Idea Roadmap

**Last reviewed:** 2026-10-29

This page is ARC-1's idea parking lot. It records worthwhile work that is **not implemented now** so
it does not disappear, but it is not a delivery schedule and it does not answer "what should we do
next?". Listing an idea does not promise that it will be built.

The page deliberately contains no completed section. When an idea ships, is rejected, or is fully
subsumed by another capability, remove it from this page. Git history remains the archive.

## How to use this page

- Search by ID, category, or keyword before opening an issue or starting design work.
- Read an item's status and resume trigger before investing in it.
- Revalidate the current product, SAP endpoints, MCP specification, and linked evidence before
  implementation. A parked idea can become obsolete.
- Keep one row and one detail section per independently useful outcome. Avoid umbrella entries.
- Update priority, effort, category, status, and evidence when new information changes the idea.

### Keep it current with every change

Contributors and coding agents check this page before starting and before finishing a change,
including fixes, documentation, refactors, and research. Update the roadmap in the same PR:

- **New work to do later:** add a focused idea with the missing outcome, evidence or PR links,
  priority, effort, category, status, and the condition for resuming it. Reuse an existing item
  when it covers the same outcome; check Git history before allocating an unused ID.
- **Partly done:** describe only the remaining work and reassess the labels in both the overview
  and details.
- **Done:** remove the overview row and detail section once the outcome is implemented and
  verified. Keep release history in [Release Notes](release-notes.md).
- **PR closed without implementation:** keep the unfinished idea and its PR links.

Record the affected IDs in the PR description, or write "No roadmap impact" after checking.
The PR template includes this check; unrelated changes do not require a roadmap edit.

### Labels

Priorities express potential value or urgency, **not execution order**:

| Priority | Meaning |
|---|---|
| **P1** | Important strategic, security, or compatibility gap; review regularly |
| **P2** | Material improvement with an acceptable workaround or partial coverage today |
| **P3** | Speculative, niche, or blocked idea; retain until its explicit trigger occurs |

Effort is a rough end-to-end estimate including research, implementation, tests, documentation, and
review: **XS** (hours), **S** (1–2 days), **M** (3–5 days), **L** (1–2 weeks), **XL** (2–4 weeks).
It is not a commitment.

| Status | Meaning |
|---|---|
| **Ready** | The gap and a credible implementation direction are understood |
| **Needs research** | The outcome is useful, but the contract or design is not sufficiently proven |
| **Blocked** | A named external or technical prerequisite is missing |
| **Revisit on trigger** | Do not invest until the item states what changed |
| **Contributor-driven** | Useful bounded work that can proceed when someone supplies the missing evidence |
| **Parked proposal** | Substantial prior work exists, but it needs a fresh decision and review before revival |

## At a glance

The table is grouped by category so it can be scanned as an idea inventory without implying a work
sequence.

| ID | Idea | Priority | Effort | Status | Category |
|---|---|---:|---:|---|---|
| [ARCH-01](#arch-01) | Discovery-driven endpoint routing | P1 | M | Ready | Architecture |
| [ARCH-02](#arch-02) | Server-driven source-state version verification | P3 | S | Needs research | Architecture |
| [FEAT-59](#feat-59) | Embeddable multi-tenant server API | P3 | L | Revisit on trigger | Architecture |
| [FEAT-93](#feat-93) | Broader pinned PP mutation capabilities | P2 | XL | Ready | Architecture |
| [SEC-16](#sec-16) | Client ID Metadata Documents (CIMD / SEP-991) | P1 | XL | Parked proposal | Auth / Compatibility |
| [SEC-15](#sec-15) | Durable DCR signing-key lifecycle | P2 | L | Needs research | Auth / Operations |
| [COMPAT-06](#compat-06) | Standard outbound proxy support | P2 | M | Ready | Compatibility |
| [COMPAT-07](#compat-07) | CDS view-entity replacement lineage | P2 | S | Needs research | Compatibility |
| [COMPAT-16](#compat-16) | API-release directory cleanup | P2 | S | Needs research | Compatibility |
| [COMPAT-17](#compat-17) | Direct package browser release coverage | P2 | S | Needs research | Compatibility |
| [COMPAT-18](#compat-18) | Newly created program metadata on 7.50 | P2 | S | Needs research | Compatibility |
| [COMPAT-19](#compat-19) | Remaining BTP IDE navigation qualification | P1 | S | Needs environment | Compatibility |
| [COMPAT-20](#compat-20) | Canonical ADT editor identity for AI edits | P2 | M | Needs research | Compatibility |
| [COMPAT-21](#compat-21) | Eclipse Copilot links and exact project selection | P2 | M | Needs research | Compatibility |
| [COMPAT-10](#compat-10) | CDS set-operation lineage | P2 | M | Needs research | Compatibility |
| [COMPAT-12](#compat-12) | Deletion with another user's text draft | P3 | S | Needs research | Compatibility |
| [COMPAT-15](#compat-15) | Empty inactive text-pool recovery | P2 | M | Needs research | Compatibility |
| [SEC-14](#sec-14) | DNS rebinding and Host-header hardening | P3 | M | Revisit on trigger | Security |
| [SEC-17](#sec-17) | Match echoed abapGit credentials by value | P2 | M | Needs research | Security |
| [SEC-18](#sec-18) | Implicit CDS conversion dependencies | P3 | M | Revisit on trigger | Security |
| [SEC-19](#sec-19) | Registered agent identity and downstream tool scopes | P2 | L | Needs research | Auth / Security |
| [COMPAT-22](#compat-22) | Integration Suite remote MCP gateway validation | P2 | M | Needs research | Compatibility |
| [FEAT-03](#feat-03) | Enhancement authoring beyond BAdI implementations | P2 | L | Needs research | ABAP authoring |
| [FEAT-85](#feat-85) | Set the ABAP language version of packages and objects | P1 | M | Needs research | ABAP authoring |
| [FEAT-05](#feat-05) | Safe rename and extract refactorings | P3 | L | Needs research | Developer workflow |
| [FEAT-21](#feat-21) | ABAP F1 documentation | P3 | S | Needs research | Developer workflow |
| [FEAT-92](#feat-92) | Function-group include expansion on the program walker | P2 | S | Ready | Developer workflow |
| [FEAT-30](#feat-30) | ABAP cleaner integration | P3 | L | Revisit on trigger | Developer workflow |
| [FEAT-66](#feat-66) | Interactive confirmation for destructive actions | P3 | L | Blocked | Safety / UX |
| [FEAT-75](#feat-75) | Delete mutually-referencing objects as one set | P2 | S | Ready | Developer workflow |
| [FEAT-76](#feat-76) | Parameterized extension service calls | P2 | M | Needs research | Integration |
| [FEAT-77](#feat-77) | Verified read-only POST operations for extensions | P2 | M | Needs research | Integration |
| [FEAT-22](#feat-22) | Safe gCTS mutation workflows | P3 | L | Needs research | Integration |
| [FEAT-34](#feat-34) | Translation workflows beyond text symbols | P3 | L | Needs research | Localization |
| [FEAT-62](#feat-62) | Transaction source and write support | P3 | M | Blocked | Object coverage |
| [FEAT-70](#feat-70) | Additional table technical settings | P3 | S | Needs research | Object coverage |
| [FEAT-72](#feat-72) | CDS index objects | P3 | M | Blocked | Object coverage |
| [FEAT-73](#feat-73) | Additional server-driven object types | P3 | S | Needs research | Object coverage |
| [FEAT-78](#feat-78) | Table type access type and keys | P2 | M | Needs research | Object coverage |
| [FEAT-09](#feat-09) | Cross Trace result reader | P2 | M | Needs research | Diagnostics |
| [FEAT-69](#feat-69) | Wider syntax-batch qualification | P3 | S | Needs research | Diagnostics |
| [FEAT-71](#feat-71) | Dictionary activation log | P3 | M | Needs research | Diagnostics |
| [FEAT-91](#feat-91) | Validate the legacy dump user filter | P2 | S | Needs research | Diagnostics |
| [FEAT-74](#feat-74) | Qualify dump-filter matching | P2 | S | Needs research | Diagnostics |
| [FEAT-94](#feat-94) | Report a dump feed's shorter time window | P2 | S | Needs research | Diagnostics |
| [FEAT-50](#feat-50) | ADT type-probe fixture coverage | P3 | XS each | Contributor-driven | Diagnostics |
| [FEAT-32](#feat-32) | Stable data-preview pagination | P3 | M | Needs research | Data access |
| [FEAT-86](#feat-86) | Additional stored-text profiles and persistence | P3 | M | Needs research | Data access |
| [FEAT-87](#feat-87) | Preserve repeated spaces in general data queries | P2 | S | Needs research | Data access |
| [FEAT-88](#feat-88) | Application-log discovery and wider qualification | P3 | M | Needs research | Data access |
| [FEAT-89](#feat-89) | Additional typed data-cluster use cases | P3 | M | Needs research | Data access |
| [FEAT-90](#feat-90) | Historical transport scope beyond source | P2 | M | Needs research | Developer workflow |
| [FEAT-36](#feat-36) | Type information | P3 | S | Blocked | Code intelligence |
| [FEAT-79](#feat-79) | DDIC-aware dependency context | P2 | M | Needs research | Code intelligence |
| [FEAT-96](#feat-96) | Bounded class overview and large-read policy | P2 | M | Needs research | Code intelligence |
| [FEAT-97](#feat-97) | Complete SHLP definitions and effective appends | P3 | M | Needs research | Object coverage |
| [FEAT-42](#feat-42) | Additional CI output formats | P3 | XS | Revisit on trigger | CI |
| [OPS-02](#ops-02) | Bounded deep health check | P3 | S | Needs research | Operations |
| [OPS-05](#ops-05) | SAP Cloud Logging and OpenTelemetry | P2 | L | Revisit on trigger | Operations |
| [OPS-06](#ops-06) | Per-user SAP session reuse beyond single-target Cloud Connector PP | P2 | M | Needs research | Operations |
| [OPS-07](#ops-07) | Signed single-file executables | P3 | M | Revisit on trigger | Operations |
| [OPS-08](#ops-08) | SAP outage isolation and queue deadlines | P2 | M | Needs research | Operations |
| [FEAT-07](#feat-07) | Native TLS listener | P3 | M | Revisit on trigger | Operations |
| [DOC-02](#doc-02) | Basis administrator handbook | P2 | M | Ready | Documentation |

## Architecture

<a id="arch-01"></a>
### ARCH-01 — Discovery-driven endpoint routing

- **Priority / effort / status:** P1 / M / Ready
- **Category:** Architecture

**Idea.** Resolve source and object endpoints from ADT discovery metadata for object families where
ARC-1 still constructs a known URL directly.

**Why it remains.** Specialized discovery gates exist, but there is no general resolver comparable
to `resolveSourceUrl()` with deterministic fallbacks and release-aware tests. This is the remaining
useful part of the former "remove static release gates" proposal; it should not be tracked twice.

**Resume with.** Start with the six object families identified in
[the implementation plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-05-08-discovery-driven-endpoint-routing.md).
Preserve known-good fallbacks, cache discovery per target, and prove behavior on at least two SAP
releases.

<a id="arch-02"></a>
### ARCH-02 — Server-driven source-state version verification

- **Priority / effort / status:** P3 / S / Needs research
- **Category:** Architecture

**Remaining gap.** Generic URLs now use SDO_REGISTRY, but `SAPDiagnose object_state` refuses
server-driven types: live 758/816 source GETs substitute the active body for a missing inactive
version, so status 200 and matching hashes cannot prove two version identities. Explicit
`SAPRead version` provides a narrower alternative; it does not make the multi-read snapshot atomic.

**Resume with.** Reuse verified version metadata while preserving object_state's ETags/hashes and
honest missing-version results. Reproduce active-only, inactive-only and divergent drafts on two
releases before enabling it. See [routing evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/completed/2026-09-25-server-driven-generic-routing.md).

<a id="feat-59"></a>
### FEAT-59 — Embeddable multi-tenant server API

- **Priority / effort / status:** P3 / L / Revisit on trigger
- **Category:** Architecture

**Idea.** Offer a supported library API for hosts that need to create isolated ARC-1 server
instances with per-tenant configuration, lifecycle, and audit context.

**Why it remains.** Experimental read-only multi-target HTTP routing is implemented, but it is not
an embeddable API and does not generalize to writable tenant instances. Extracting internals now
would create a public compatibility surface without a known consumer.

**Resume when.** A concrete embedding customer can define lifecycle, isolation, writable-safety,
and upgrade requirements. Do not widen the mutation-free multi-target contract as a shortcut.

<a id="feat-93"></a>
### FEAT-93 — Broader pinned PP mutation capabilities

- **Priority / effort / status:** P2 / XL / Ready
- **Category:** Architecture

**Remaining gap.** PR [#1080](https://github.com/arc-mcp/arc-1/pull/1080) implements the scoped
CLAS/INTF create/main-update, CLAS method-edit and whole-owner activation contract for local and
transportable packages, with exact target write grants and independent server/destination policy.
The owner selected broader built-in development and management parity, including object types,
includes, deletes, batches, package changes, RAP/DDIC, publication, transport management, runtime
tracing and classic FLP. Git and custom extensions/plugins are excluded. None of this expansion
is enabled by the shared-infrastructure extraction; aggregate and Basic writes remain excluded.

**Design evidence.** The [26 October research](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-26-multi-target-write-parity.md)
separates accepted scope from proposed resource policies and live qualification gaps. It proposes
[PR 1](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-26-shared-mutation-infrastructure.md)
for behavior-preserving shared mutation infrastructure, merged in [#1138](https://github.com/arc-mcp/arc-1/pull/1138) with
[separate qualification evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-29-shared-mutation-infrastructure.md), followed by
[PR 2](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-26-broader-pinned-pp-writes.md)
for the capability expansion. Existing opted-in writers may gain the documented capabilities;
read-only applications/destinations must remain mutation-free.
Implementation in draft [#1142](https://github.com/arc-mcp/arc-1/pull/1142) includes an explicit
capability matrix, request-scoped package hierarchy and CTS parent/task checks, native adapter
budgets, local deletion, class-include replacement and mapped-user formatter preferences.
[Fresh two-writer PP evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-11-01-broader-pinned-pp-writes-includes.md)
at `77e41fdcd` covers the shared main-method handler, all four local include kinds, native
`testclasses` initialization, owner activation, CLAS/INTF deletion, formatter preservation and
read-only-route refusals. Native authorship/source checks and complete temporary-access/configuration
restoration passed. The recorded failed attempt remains failed. Actual Opus 5.5 max reviews and
finding dispositions are linked from the evidence; this is not whole-PR acceptance.

Remaining work is transportable deletion/includes, other object types and class/procedural surgery,
DDIC/RAP, batches, package/API/publication, CTS, runtime tracing and classic FLP, each with its
resource policy, tests and PP qualification. Broader class metadata surgery also requires positive
owner/source/name/range checks; the existing declaration-chain refusal is only a partial guard.
Source-save cleanup results now retain transport/warnings and report close failures consistently.
Existing-include method edits share the main-method lifecycle and have offline tests; their PP
qualification remains pending. Secondary
native formatter-preference proof, untested native styles, other releases and the separate legacy
v2 preservation issue remain evidence limits. Aggregate, Basic and read-only connections stay
mutation-free. Git and custom extensions/plugins remain excluded.

**Resume when.** The PR 1 acceptance and owner request prerequisites are met. Continue the guarded
adapters and native qualification against the reviewed PR 2 plan. Preserve the shared foundation's
existing behavior; PR 2 requires a new reviewed ADR qualifying ADR-0010, explicit per-operation
resource policies, negative tests and real PP evidence. Do not remove the explicit action matrix
or add a duplicate global write switch. Caching, SaaS and embedding remain separate work. The
roadmap entry stays open until the expanded scope is implemented and verified.

**Prior work.** [#906](https://github.com/arc-mcp/arc-1/pull/906), the
[alternatives assessment](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-22-multi-target-write-strategy.md)
and [V2 roadmap](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/multi-target-v2-roadmap.md)
remain design history; revalidate older gap statements against the current scoped implementation.

## Authentication, compatibility, and security

<a id="sec-16"></a>
### SEC-16 — Client ID Metadata Documents (CIMD / SEP-991)

- **Priority / effort / status:** P1 / XL / Parked proposal
- **Category:** Auth / Compatibility

**Idea.** Let OAuth clients identify themselves with a trusted HTTPS metadata-document URL, while
retaining Dynamic Client Registration (DCR) for clients that still need it. Keep the feature
default-off until its outbound-fetch and deployment contract is approved.

**Why it is parked.** A cross-repository implementation and threat model exist, and the MCP
2026-07-28 authorization specification recommends CIMD while retaining DCR for backward
compatibility. The work was not merged and needs a fresh maintainer decision, security review,
dependency release, rebase, and live acceptance rather than piecemeal copying.

**Resume with.**

1. Resolve the architecture and trust-policy questions captured in the research PR.
2. Review the SSRF-resistant resolver and cache in `@arc-mcp/xsuaa-auth` before changing ARC-1.
3. Release the dependency first, then rebase ARC-1's default-off wiring.
4. Test root and path-prefixed deployments, proxy behavior, real CIMD clients, DCR coexistence,
   bounded caching, and audit logs that reveal no fetched secrets.

**Prior work.**

- [arc-1 PR #711 — threat model and architecture research](https://github.com/arc-mcp/arc-1/pull/711)
- [arc-1 PR #712 — ARC-1 configuration and metadata wiring](https://github.com/arc-mcp/arc-1/pull/712)
- [xsuaa-auth PR #57 — CIMD resolver, fetch policy, and cache](https://github.com/arc-mcp/xsuaa-auth/pull/57)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

Closing those pull requests does not close this idea; the links are retained as design and
implementation evidence.

<a id="sec-15"></a>
### SEC-15 — Durable DCR signing-key lifecycle

- **Priority / effort / status:** P2 / L / Needs research
- **Category:** Auth / Operations

**Idea.** Give self-hosted and Cloud Foundry deployments an explicit, durable lifecycle for the
HMAC key behind stateless DCR client identifiers, including rotation and multi-instance behavior.

**Why it remains.** `ARC1_DCR_SIGNING_SECRET` solves stable redeploys when operators manage it, but
automatic generation, storage, and safe rotation remain deployment-specific. CIMD may materially
reduce the DCR population, so the remaining problem should be measured before adding a secret
service.

**Resume when.** We know which supported deployments still require durable DCR and can specify
rotation overlap, failure behavior, and an operator-owned secret store. See
[the research note](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-07-31-durable-dcr-signing-key-lifecycle.md)
and
[PR #607](https://github.com/arc-mcp/arc-1/pull/607).

<a id="compat-06"></a>
### COMPAT-06 — Standard outbound proxy support

- **Priority / effort / status:** P2 / M / Ready
- **Category:** Compatibility

**Idea.** Honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` consistently for direct SAP ADT and
other outbound HTTP calls, without changing BTP Destination/Connectivity routing.

**Why it remains.** The current direct ADT client does not support the standard proxy environment
variables. Enterprise installations often require them, and a partial implementation would be
misleading.

**Resume with.** Use the existing
[implementation plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/http-forward-proxy-env-support.md);
test redirects, TLS verification, `NO_PROXY`, OAuth metadata, SAP cookies, and BTP isolation.

<a id="compat-07"></a>
### COMPAT-07 — CDS view-entity replacement lineage

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Compatibility

**Remaining gap.** [#848](https://github.com/arc-mcp/arc-1/pull/848) maps DDIC-based replacement
SQL views through `DDLDEPENDENCY OBJECTTYPE=VIEW`. SAP also permits CDS view-entity replacements;
these remain unmapped and fail closed.

Direct CDS view entities and transactional projection views are handled by the graph traversal
after [#912](https://github.com/arc-mcp/arc-1/issues/912); that does not resolve this catalog-mapping gap.
The issue's 816 evidence reports `DDLDEPENDENCY OBJECTTYPE=STOB` without a `VIEW` row, but still lacks
a live table-to-view-entity replacement capture.

**Resume with.** A live table using a CDS view-entity replacement, verified `VIEWREF`/`STOB` identities,
and graph-alias/blocklist regressions before broadening the catalog join.

<a id="compat-10"></a>
### COMPAT-10 — CDS set-operation lineage

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Compatibility

**Remaining gap.** The strict caller-SQL parser supports `UNION`, but SAP's dependency graphs for
CDS set operations contain structural nodes outside the current kind allowlist. A4H 758's
`DEMO_CDS_UNION_VE` is denied on `TYPE=SELECT`; this predates the view-entity fix in
[#914](https://github.com/arc-mcp/arc-1/pull/914). See the
[review evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-04-issue-912-cds-lineage.md#separately-tracked-limitations).

**Resume with.** Captured graphs for classic/view-entity UNION, EXCEPT and INTERSECT where supported;
define structural-node identity and traversal without mistaking branch labels for data-source names.
Prove every branch is checked before allowing these shapes. Keep unknown nodes fail-closed.

<a id="compat-16"></a>
### COMPAT-16 — API-release directory cleanup

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Compatibility

**Remaining gap.** On 816 and BTP, the original C4-after-C1 test deleted its class
while C4 was still RELEASED: the visibility-mismatch error hid an applied release.
The owner is absent but an APIS directory entry remains. [#967](https://github.com/arc-mcp/arc-1/pull/967)
now discloses the actual state and revocation instruction. Fresh 816 and BTP validation
that revokes every released contract before deletion leaves no directory entry; a supported
recovery for the old residue is still unproven. A post-deletion empty API_STATE is
not evidence that revocation preceded deletion. See the [plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-09-api-release-visibility.md).

**Resume with.** Isolate the native released-contract deletion behavior on disposable
classes and establish a supported ADT repair for existing APIS residue. Verify both
owner and directory state, preserve user intent, and never edit catalog rows or add
automatic revocation to deletion. Pre-existing BTP SUSH entries are separate evidence.

<a id="compat-12"></a>
### COMPAT-12 — Deletion with another user's text draft

- **Priority / effort / status:** P3 / S / Needs research
- **Category:** Compatibility

**Remaining gap.** Program and function-group deletion now holds owner and pool
locks and refuses explicit inactive pool metadata; it never activates a draft
automatically. The caller's inactive feed is not an ownership or absence check.
The remaining qualification is two users, recording transports and principal
propagation, including drafts outside a shared request and competing locks. See the
[cross-user deletion evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-09-cross-user-text-delete.md).

**Resume with.** Two authorized SAP test identities: save a draft as one user and
attempt PROG/FUGR deletion as the other, both inside and outside a shared transport
request, including lock races and principal propagation. Establish feed visibility,
SAP's activation/delete authorization and the existing guard's behavior;
preserve per-user identity, package checks and native authorizations. Avoid silently
activating or discarding another user's draft.

<a id="compat-15"></a>
### COMPAT-15 — Empty inactive text-pool recovery

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Compatibility

**Remaining gap.** Empty CLAS/FUGR pools can remain inactive despite successful
activation responses and an empty inactive-object feed (758/816; CLAS also BTP).
Writes report explicit pool state and skip a proven active, already-empty symbols
save. They do not repair existing drafts. Clearing a never-activated nonempty draft
can still produce this state; symbols alone cannot establish whole-pool emptiness.

**Resume with.** A supported native repair, or a qualified whole-pool precondition
for refusing the hazardous clear across active/working versions and all parts.
Preserve drafts and per-user authorization; do not add placeholder texts or write
catalog rows automatically. See the
[state plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-12-text-pool-state.md).

<a id="compat-17"></a>
### COMPAT-17 — Direct package browser release coverage

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Compatibility

**Remaining gap.** Explicit `packageScope=direct` now provides bounded native
contents on verified 750 SP02 and 758 SP02 contracts. Native 740 SP04, BTP ABAP,
and an existing empty package remain unverified; empty trees deliberately return
an ambiguous-result error. Indexed search and write-package authorization remain
separate.

**Resume with.** Sanitized native root/expansion evidence on those releases, or
independent proof distinguishing an empty package from a missing/inaccessible
one. Preserve direct scope, client budgets and unknown completeness; no automatic
search/RFC/helper fallback. See [#1065](https://github.com/arc-mcp/arc-1/issues/1065),
[the initial research](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-22-legacy-package-browser.md)
([research PR #1071](https://github.com/arc-mcp/arc-1/pull/1071)) and
[the implementation plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-22-direct-package-browser.md).

<a id="compat-18"></a>
### COMPAT-18 — Newly created program metadata on 7.50

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Compatibility

**Evidence.** On 750 with ARC-1 1.6.0, attempt to delete an absent disposable PROG, then
create it with source. Creation succeeds, but activation/update/delete can receive a 404
from the default metadata URL while `?version=inactive` returns its metadata and package.
A fresh client and `Cache-Control: no-cache` did not resolve this. Native activation after
verifying the inactive object's package allowed cleanup. The no-pre-delete control activated.
The pre-delete case's forced read returned the creation template; persistence of the supplied
inactive source was not checked. The control's delete hit a text-pool LOCK 404 until a later
source update and activation, so only its activation succeeded without recovery.

**Resume with.** Verify source persistence and default/active/inactive metadata across releases;
trace the SAP response before changing package resolution. Preserve fail-closed package checks. Unique E2E
fixtures avoid the pre-delete, but do not fix this runtime gap; do not add a skip for it.

<a id="compat-19"></a>
### COMPAT-19 — Remaining BTP IDE navigation qualification

- **Priority / effort / status:** P1 / S / Needs environment
- **Category:** Compatibility

**Remaining gap.** A4H/100 has successful discovery/source samples but recurring 120-second source
read timeouts, reproduced on original 0.9.27 too. Second-user SAP identity, a known-but-ungranted
live `xsuaa-attribute` target and PP-only multi-instance routing remain unqualified.

**Already verified.** Public-router OAuth, pinned/aggregate PP and shared-Basic reads, request-local
Eclipse preferences, restart/token refresh, and actual Copilot → SAP ADT MCP → VS Code opening.
[Evidence and timeout trace anchors](https://github.com/arc-mcp/arc-1/blob/main/docs/research/ide-navigation-verification.md#historical-btp-matrix).

**Resume with.** Trace the client-100 SAP/Connectivity source path, obtain a second authorized identity
and denied-target account, then test an isolated PP-only multi-instance deployment. Keep the existing
shared-Basic test app at one instance. Retain required aggregate `target`; stale Copilot validator
recovery uses window reload and stable separate entries.

<a id="compat-20"></a>
### COMPAT-20 — Canonical ADT editor identity for AI edits

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Compatibility

**Remaining gap.** Canonical opening does not establish dirty-buffer reuse, Keep/Undo, save,
validation, transport or activation parity with the [ABAP Bridge](https://github.com/arc-mcp/arc1-abap-bridge).
Local ADT session recovery, same-name/type collisions, includes and other clients also need qualification.

**Already verified.** The simplified runtime `7b00407a` passed pinned/aggregate BTP reads, SAP name/type
resolution, exact URI encoding, clicked interface/CDS opening and an explicit missing-object stop case.
Earlier native-error retries failed; instructions cannot enforce cross-server behavior.
[Current acceptance](https://github.com/arc-mcp/arc-1/blob/main/docs/research/ide-navigation-verification.md#final-simplified-runtime-acceptance).

**Resume with.** Diagnose local session logoff; test dirty buffers and each edit/save operation on
disposable objects. A local picker could save each developer's confirmed connection/target mapping;
SAP's first-match SID fallback cannot verify backend/client. No ARC-1 VS Code mapping settings remain.
[Decisions and original requirements](https://github.com/arc-mcp/arc-1/blob/main/docs/research/ide-navigation-decisions.md).

<a id="compat-21"></a>
### COMPAT-21 — Eclipse Copilot links and exact project selection

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Compatibility

**Remaining gap.** Direct Eclipse Copilot clicking and exact project/backend matching. User screenshots
show chooser and source but do not identify whether the direct or adjacent HTTP handoff link initiated it.
Same SID/client can describe different backends; ARC-1 cannot force a chooser.

**Already verified.** Local `npx`, HTTP/BTP pinned/aggregate reads, preference forwarding, rendering,
restart recovery and native-dialog opening for CLAS/INTF/PROG/DDLS. Isolated Claude plugin preference
substitution passed; installed ARC-1 UI and Desktop opening remain unqualified.
Namespaced Eclipse opening is unverified. Live HTTP evidence used the retired combined `on` mode;
the current `eclipse`-only mode has automated coverage, pending a fresh live Eclipse run.

**Resume with.** Enable the `adt` handler and manually click a fresh answer containing only the direct
link. Qualify project-name authorities, collisions, missing/cloud projects and other OSes before richer
links or a companion. Keep per-client opt-in; defer the plugin dropdown pending a minimum-client policy.
[Options and evidence limits](https://github.com/arc-mcp/arc-1/blob/main/docs/research/ide-navigation-decisions.md#eclipse-contract-and-unresolved-selection).

<a id="sec-14"></a>
### SEC-14 — DNS rebinding and Host-header hardening

- **Priority / effort / status:** P3 / M / Revisit on trigger
- **Category:** Security

**Idea.** Add explicit hostname/origin enforcement for self-hosted HTTP deployments where ARC-1 is
reachable without a trusted reverse proxy.

**Why it remains.** A previous implementation in
[PR #500](https://github.com/arc-mcp/arc-1/pull/500) was deferred. Mandatory authentication and the
recommended reverse-proxy deployment reduce present urgency, but they do not make this class of
hardening universally irrelevant.

**Resume when.** ARC-1 supports or documents an exposed self-hosted topology that cannot rely on a
trusted proxy. Rebase the prior work and re-evaluate forwarded-header trust rather than assuming
the old patch is still correct.

<a id="sec-17"></a>
### SEC-17 — Match echoed abapGit credentials by value

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Security

**Remaining gap.** [#894](https://github.com/arc-mcp/arc-1/pull/894) conservatively omits diagnostics
with recognizable credential labels, sensitive URLs or unresolved encodings. Local probes still
show unlabeled and non-English-labeled sentinels verbatim; an actual SAP echo is unverified.

**Resume with.** Benign fixtures representing echoed `SAPGit` credentials and a bounded design
that compares responses with credentials supplied for that request before extraction or truncation.
Keep values request-local, cover error and HTTP-200 result paths, and measure false positives
without logging or persisting the credentials. This is research, not a universal-secret-detector promise.

<a id="sec-18"></a>
### SEC-18 — Implicit CDS conversion dependencies

- **Priority / effort / status:** P3 / M / Revisit on trigger
- **Category:** Security

**Remaining gap.** SAP's SQL dependency graph does not list the implicit customizing tables used
by CDS currency/unit conversion functions. Fresh 758 metadata for both classic and view-entity
demo pairs lists only `DEMO_PRICES` or `DEMO_EXPRESSIONS`, despite conversion expressions in their
source. This is an existing policy coverage limit, documented during
[#914](https://github.com/arc-mcp/arc-1/pull/914); see the
[review evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-04-issue-912-cds-lineage.md#separately-tracked-limitations).

**Resume when.** An operator needs to block conversion customizing tables. Verify supported
SAP metadata for implicit dependencies and test representative releases. Choose a bounded proof or
explicit refusal for affected functions; do not infer full lineage from the present graph or add a
hard-coded table list without proving its completeness.

<a id="sec-19"></a>
### SEC-19 — Registered agent identity and downstream tool scopes

- **Priority / effort / status:** P2 / L / Needs research
- **Category:** Auth / Security

**Idea.** Investigate a supported credential flow carrying a registered Cloud Identity Services
agent identity and original user context, with downstream permissions narrowed for the invoked tool.

**Why it remains.** SAP ref. 137800 requires these properties. ARC-1's PP flow preserves user context,
but `clientAgent` is only an audit label and MCP tool scopes do not narrow the SAP credential per tool.
See the [2026-10-21 evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-21-sap-api-policy-custom-mcp.md).

**Resume with.** Tenant/release-specific SAP documentation and a test tenant supporting the required
agent registration, delegation and scope contract. Prove user/agent attribution and fail-closed
behavior without broadening existing PP or multi-target exceptions. Do not invent an IAS setup
requirement or claim this resolves the separate ADT-channel permission question.

<a id="compat-22"></a>
### COMPAT-22 — Integration Suite remote MCP gateway validation

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Compatibility

**Idea.** Validate ARC-1 behind Integration Suite's documented remote-MCP proxy and, if successful,
document a supported configuration.

**Why it remains.** Current SAP Help now documents Streamable HTTP remote MCP sources, superseding
the July inventory. ARC-1 interoperability and delegated identity through the gateway are unverified.
See the [source and validation boundary](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-21-sap-api-policy-custom-mcp.md#remote-mcp-gateway-validation-boundary).

**Resume with.** A suitable Integration Suite plan, Integration Cell, documented discovery/runtime
authentication and two users with different SAP permissions. Verify identity, scopes, tool filtering,
audit/traces, quotas, errors and reconnect behavior. Do not silently substitute a shared credential
for PP or present transport success as ADT permission. The gateway is optional for custom MCP.

## Developer workflows

<a id="feat-03"></a>
### FEAT-03 — Enhancement authoring beyond BAdI implementations

- **Priority / effort / status:** P2 / L / Needs research
- **Category:** ABAP authoring

**Idea.** Extend guarded enhancement authoring past BAdI implementations: source-code plug-ins
(`ENHO/XHH`), enhancement spots and BAdI definitions.

**Why it remains.** `SAPWrite type="ENHO"` creates, updates and deletes BAdI implementations
(`ENHO/XHB`) on-prem and on BTP (C1-released BAdIs with `useInSAPCloudPlatform`), including filter
values. Hook, class and spot authoring have no proven create/update contract.

**Resume with.** For hooks: capture live ADT traffic for one source-code plug-in, then follow the XHB
pattern (discovery gate, package gate, read-back; evidence:
`docs/research/2026-10-07-enho-xhb-write-contract.md`).

<a id="feat-85"></a>
### FEAT-85 — Set the ABAP language version of packages and objects

- **Priority / effort / status:** P1 / M / Needs research
- **Category:** ABAP authoring

**Idea.** Let `SAPManage` create/change a package with an ABAP language version and let `SAPWrite` set or
change an object's version on-prem: in a classic package any object may be switched to ABAP for Cloud
Development; in an ABAP Cloud package every object must be ABAP Cloud.

**Why it remains.** ARC-1 never sends a language version on-prem: `buildPackageXml` omits
`pak:languageVersion` (ADT reports it as editable; "ABAP for Cloud Development" is `5`), and object creates
inherit the package default. Updates keep the stored version (ENHO re-sends it since
[PR #939](https://github.com/arc-mcp/arc-1/pull/939)). The ENHO re-test had to switch its cloud package in
Eclipse (`docs/research/2026-10-07-enho-xhb-write-contract.md`).

**Resume with.** Capture Eclipse's package and object property saves for a version change, check which
object types expose `adtcore:abapLanguageVersion` as writable, and refuse a classic version in an ABAP
Cloud package before any write.

<a id="feat-05"></a>
### FEAT-05 — Safe rename and extract refactorings

- **Priority / effort / status:** P3 / L / Needs research
- **Category:** Developer workflow

**Idea.** Expose previewable, SAP-backed rename and extract-method refactorings with explicit impact
evidence.

**Why it remains.** Package moves already exist and are no longer part of this item. Rename and
extract have a larger blast radius than text edits and need a trustworthy preview, collision
handling, activation strategy, and partial-failure story.

Declaration quick-fix deltas work after [the #993 URI correction](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-13-quickfix-exact-uri.md); the provider URI alone does not imply an unsupported flow. This does not qualify rename/extract.

**Resume with.** Prove the relevant ADT refactoring contracts live and design preview-first output
that never silently performs multi-object changes.

<a id="feat-21"></a>
### FEAT-21 — ABAP F1 documentation

- **Priority / effort / status:** P3 / S / Needs research
- **Category:** Developer workflow

**Idea.** Return concise SAP documentation for a symbol or keyword from the current code context.

**Why it remains.** No supported implementation exists, and historic F1 endpoints have been
release-sensitive. Generic web links would add little over existing model knowledge.

**Resume with.** Demonstrate one discovery-advertised, structured endpoint on multiple supported
releases and define a useful fallback when documentation is unavailable.

<a id="feat-92"></a>
### FEAT-92 — Function-group include expansion on the program walker

- **Priority / effort / status:** P2 / S / Ready
- **Category:** Developer workflow

**Idea.** Read function groups with the bounded walker that `expand_includes` uses for PROG and INCL,
so that one parameter has one traversal.

**Why it remains.** `getFunctionGroupExpanded` finds includes with a regex: it misses
`INCLUDE … IF FOUND` and chained `INCLUDE: a, b.`, follows INCLUDE text inside `"` comments and
literals, reads the SAP includes of customer groups (a table-maintenance group on SAP_BASIS 7.50
returned 80 sources, nearly all `LSVIM*`, where the program walker read 8 customer sources), and has
neither a time nor a size limit. The program walker was kept separate so that function-group output
did not change in the same pull request.

**Resume with.** Move FUGR onto the program walker (root: the group's main program), keep the
`getFunctionGroupExpanded` result shape for extensions, and document the changed output: ownership
rule, 40,000-character text limit, deadline, and the closing note instead of `[truncated]`.

<a id="feat-30"></a>
### FEAT-30 — ABAP cleaner integration

- **Priority / effort / status:** P3 / L / Revisit on trigger
- **Category:** Developer workflow

**Idea.** Offer ABAP cleaner proposals as an explicit, reviewable formatting/refactoring action.

**Why it remains.** Research exists, but a Java runtime, profile management, process sandbox,
versioning, and source-diff contract would add substantial operational weight. SAP Pretty Printer
and abaplint already cover the common low-cost cases.

**Resume when.** Repeated user demand justifies the runtime dependency and a maintainer agrees to
support it. Re-evaluate the current [SAP ABAP cleaner](https://github.com/SAP/abap-cleaner) CLI and
license before designing the integration.

<a id="feat-66"></a>
### FEAT-66 — Interactive confirmation for destructive actions

- **Priority / effort / status:** P3 / L / Blocked
- **Category:** Safety / UX

**Idea.** Ask for in-protocol confirmation immediately before a destructive action while retaining
all server-side authorization and safety gates.

**Why it remains.** ARC-1 stays on SDK v1 under its
[MCP compatibility decision](https://github.com/arc-mcp/arc-1/blob/main/docs/adr/0006-mcp-legacy-era-until-triggers.md).
The proposed pull-based confirmation flow needs a compatible SDK and verified client support.
Confirmation must also survive retries without creating duplicate mutations.

**Unblock when.** The ADR's migration triggers are met and supported clients have verified
confirmation UX. Design intent binding, expiry, idempotency, and non-interactive refusal before
implementation. Complete confirmation before acquiring an ADT lock.

<a id="feat-75"></a>
### FEAT-75 — Delete mutually-referencing objects as one set

- **Priority / effort / status:** P2 / S / Ready
- **Category:** Developer workflow

**Idea.** Let `SAPWrite` delete a bounded object set in one ADT mass-deletion request, so a RAP
composition parent and its `association to parent` child can be removed without editing source.

**Why it remains.** Deleting either side of such a pair returns 400 (DDIC 039) on 758 and 816, and
the delete hint suggests a circular order ("delete the other first") for both. The only product path
today is strip the composition, activate, then delete. `POST /sap/bc/adt/deletion/delete` removed a
live pair in one call on both releases; the integration suite uses it for cleanup. 7.50 lacks it.

**Resume with.** Reuse the verified request shape in `deleteObjectSet`
(`tests/integration/crud-harness.ts`). Enforce the package gate for every object before sending,
report SAP's per-object `isDeleted` result, gate on discovery, and stop suggesting circular orders.

<a id="feat-90"></a>
### FEAT-90 — Historical transport scope beyond source

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Developer workflow

**Remaining gap.** Source diffs leave Dictionary objects, text pools, function-group sources, metadata,
deletions and Customizing keys unreviewed. Keep these gaps explicit; current metadata is not
historical evidence.

**Evidence.** [#1008](https://github.com/arc-mcp/arc-1/pull/1008) narrows the implementation to
bounded MCP source review. Fresh A4H/001 probes found DOMA/DTEL/TTYP history feeds, but their
advertised content URIs returned HTTP 403 “Request version … is not supported”, including
with the exact advertised media types. [Research and family matrix](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-18-transport-review-mcp.md).

**Resume with.** A real review needs one specific missing family and a read-only probe returns
two retrievable historical payloads, transport attribution and the native content contract.
Start with that family; no generic serializer, guessed URL or ABAP/RFC helper fallback.

## Integration and localization

<a id="feat-76"></a>
### FEAT-76 — Parameterized extension service calls

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Integration

**Remaining gap.** [#884](https://github.com/arc-mcp/arc-1/issues/884) needs structured parameters
and results for custom report/SmartForms functions. Existing `ctx.run` operations are name-in,
text-out; raw HTTP requires explicit write authorization. The contributor's generic SOAP 6.20
endpoint is deprecated, and no supported binding has been verified for an extension helper.

**Resume with.** A redacted binding WSDL and harmless request/response/fault samples from an
authorized supported service, including table and empty-value behavior, auth route and retry
semantics. Start with a small transport-independent codec only if that contract supports it; a
named executor additionally needs explicit operation authorization and bounded results. Keep the
single-target identity and write ceiling. Execution remains extension-only under
[ADR-0009](https://github.com/arc-mcp/arc-1/blob/main/docs/adr/0009-abap-execution-and-rfc-belong-in-extensions.md);
do not add built-in report/class execution or direct RFC calls.
[Investigation](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-09-29-plugin-post-rfc.md).

<a id="feat-77"></a>
### FEAT-77 — Verified read-only POST operations for extensions

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Integration

**Remaining gap.** [#885](https://github.com/arc-mcp/arc-1/issues/885) has a valid read-only service
use case, but a path-only exception would also authorize write bodies on SOAP and batch endpoints.
Dedicated read endpoints, such as the extension sample's LISA POSTs, are narrower candidates.
Verified read-only GET services already work through `ctx.http.get`; no read-POST exception or
function-name purity claim is implemented.

**Resume with.** One narrow operation with verified non-mutating semantics and a request contract
that rejects other operations, changesets and dynamic report/function dispatch before network
access. Decide whether its data requires `read`, `data` or `sql` scope; define response limits,
auditing and safe retry behavior. A SAP-owner-reviewed service and authorized live tests must
support the claim. Do not use a broad URL/prefix or wildcard FM exception to bypass the ceiling.
[Investigation](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-09-29-plugin-post-rfc.md).

<a id="feat-22"></a>
### FEAT-22 — Safe gCTS mutation workflows

- **Priority / effort / status:** P3 / L / Needs research
- **Category:** Integration

**Idea.** Add a narrow set of gCTS mutations whose success can be verified reliably.

**Why it remains.** Read operations and conservative abapGit workflows exist; the original broad
"gCTS/abapGit integration" item is therefore obsolete. gCTS mutations remain risky because
backends and asynchronous postconditions vary.

**Resume with.** Pick one customer-backed operation, capture live contracts on the target release,
require the existing Git-write gates, and define verifiable postconditions and recovery behavior.

<a id="feat-34"></a>
### FEAT-34 — Translation workflows beyond text symbols

- **Priority / effort / status:** P3 / L / Needs research
- **Category:** Localization

**Idea.** Add language-aware translation status and editing for assets not covered by text symbols
and message-class maintenance, such as OTR-backed texts.

**Why it remains.** Program/class/function text elements and message classes already have useful
coverage, so the old generic "translation support" entry overstated the gap.

**Resume with.** Start from a concrete translator workflow, identify authoritative language and
fallback behavior, then validate the read/write APIs on two releases.

## Object coverage

<a id="feat-62"></a>
### FEAT-62 — Transaction source and write support

- **Priority / effort / status:** P3 / M / Blocked
- **Category:** Object coverage

**Idea.** Read or write transaction definitions as structured ARC-1 objects.

**Why it remains.** The expected ADT transaction endpoint is absent on the tested 7.50, 7.58, and
8.16 systems. Inventing a GUI-automation or RFC fallback would violate the product boundary.

**Unblock when.** A supported SAP release advertises a usable ADT endpoint and a live create/read
contract can be captured.

<a id="feat-70"></a>
### FEAT-70 — Additional table technical settings

- **Priority / effort / status:** P3 / S / Needs research
- **Category:** Object coverage

**Idea.** Extend `TABL/DTT` updates to storage type or load unit only where
SAP advertises an editable, verified contract. Data class, size category, buffering and logging
already have separate read/update/activation support; table DDL annotations are outside this gap.

**Why it remains.** The additional fields vary by release and can be read-only. Current
reads expose native values but deliberately do not enable their mutation.

**Resume with.** A concrete use case and native editable-field evidence on the target
releases; qualify activation, recording transports and preservation of other pending settings.
See [the implemented contract](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-12-table-technical-settings.md).

<a id="feat-72"></a>
### FEAT-72 — CDS index objects

- **Priority / effort / status:** P3 / M / Blocked
- **Category:** Object coverage

**Idea.** Add read/create/update coverage for CDS index objects advertised by ADT discovery.

**Why it remains.** Classic transparent-table indexes (`TABL/DTI`) now have native listing,
JSON CRUD and separate activation, verified on 758/816/BTP; they do not establish the
contract for CDS table-entity index variants or XINX extension indexes. See the
[classic-index evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-12-table-indexes.md).

**Unblock when.** A test system has a CDS table-entity index or XINX seed object and a
reproducible creation path. Record native identity, media types, package/transport ownership
and database activation/conversion behavior before extending classic-index support.

<a id="feat-73"></a>
### FEAT-73 — Additional server-driven object types

- **Priority / effort / status:** P3 / S / Needs research
- **Category:** Object coverage

**Idea.** Extend the server-driven registry to DRAS and DSFI if their live contracts are stable
enough for ARC-1.

**Why it remains.** DRAS and DSFI lack complete live create/update evidence. DRTY now uses the
existing registry; its [verified contract](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-09-18-drty-cds-type-adt-contract.md)
is a reference for researching the remaining candidates, not a guarantee they share its format.

**Resume with.** Discovery markers, metadata/source media types, create subtype, stateful CRUD,
activation and read-back evidence for each remaining type. Measure schema cost and add candidates
independently; do not infer their create subtype or source format from the family.

<a id="feat-78"></a>
### FEAT-78 — Table type access type and keys

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Object coverage

**Idea.** Read and write a table type's complete definition: access type, primary-key definition
and components, secondary keys, initial row count, and reference or range row types.

**Why it remains.** `SAPWrite` writes only a standard table with a non-unique standard key. An
update with an explicit `rowType` therefore resets every other setting, and `SAPRead` reports
`plainStandardTable: false` without listing the key components or secondary keys. ARC-1 refuses an
update without `rowType` rather than lose them; see
[table type updates](tools.md#table-type-updates). About one in six table types on the tested
S/4HANA 2023 system has such a definition.

**Resume with.** Prefer sending back the stored `<ttyp:tableType>` envelope with only the requested
change, as SKTD updates do, over one input per setting. SAP_BASIS 758 and 816 accepted a PUT with a
sorted table and unique key components; secondary keys, aliases and reference or range rows are
untested. Prove the PUT contract for each of the
[recorded shapes](https://github.com/arc-mcp/arc-1/blob/main/docs/research/abap-types/types/ttyp.md)
on two releases, keep the refusal for anything ARC-1 still cannot reproduce, and add the key
components and secondary keys to the read.

## Diagnostics, data, and code intelligence

<a id="feat-09"></a>
### FEAT-09 — Cross Trace result reader

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Diagnostics

**Idea.** Read and summarize completed Cross Trace records through ADT.

**Why it remains.** ARC-1 can control ST05 SQL tracing, but it cannot retrieve Cross Trace result
records. Discovery shows Cross Trace resources on newer systems, yet their result contract and data
volume limits are not implemented.

**Resume with.** Capture a bounded real trace result, define redaction and response-size behavior,
and keep trace activation separate from result reading.

<a id="feat-74"></a>
### FEAT-74 — Qualify dump-filter matching

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Diagnostics

**Remaining gap.** Bounded typed filters and optional schema discovery are implemented for dump
lists, with A4H/001 positive/negative runtime-error matches and synthetic mixed-day/paging controls.
Other releases/auth routes and advertised attributes/operators are not qualified. Wildcard and
whitespace string values remain refused. Model success remains uneven; earlier failures are retained.

**Resume with.** A concrete target or filter task. Verify a positive and negative match on that
target, including date bounds and caller identity, before broadening values or claiming support.
Keep schema discovery optional and ordinary list/detail behavior unchanged.
[Extraction and evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-17-dump-filter-extraction.md).

<a id="feat-69"></a>
### FEAT-69 — Wider syntax-batch qualification

- **Priority / effort / status:** P3 / S / Needs research
- **Category:** Diagnostics

**Remaining gap.** Explicit CLAS/INTF/PROG/DDLS lists are implemented through `SAPDiagnose syntax`,
with bounded requests and per-object evidence. A4H/001 establishes the native batch contract;
other releases, live BTP/PP and additional type families remain unqualified.

**Resume with.** A concrete target/type need and comparison with its native single-object checks.
Transport integration additionally needs policy, failure isolation and source reconciliation:
a current-source check never proves a historical transport snapshot. No automatic collector or
hidden raw-HTTP scheduling. [Plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-19-bounded-syntax-checks.md).

<a id="feat-71"></a>
### FEAT-71 — Dictionary activation log

- **Priority / effort / status:** P3 / M / Needs research
- **Category:** Diagnostics

**Remaining gap.** [#1011](https://github.com/arc-mcp/arc-1/pull/1011) verified a readable advertised
DOMA log on 758. Saved logs have no verified latest-attempt correlation. Two model evaluations
misinterpreted historical evidence despite explicit caveats; other types/releases remain unqualified.

**Resume with.** A concrete historical-log workflow that preserves uncertainty, or independent
native correlation evidence. Keep the experiment deferred and never label saved messages as proof
of a recent activation. [Failed controls](https://github.com/arc-mcp/arc-1/blob/5725fab6515f7a410e3e488003ae1a7aa3d8c249/docs/research/2026-10-17-diagnostic-main-decision.md).

<a id="feat-91"></a>
### FEAT-91 — Validate the legacy dump user filter

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Diagnostics

**Remaining gap.** The older user-only path still inserts its trimmed value into the query grammar.
Typed-filter calls validate this value, but ordinary calls preserve existing behavior. The extraction
adds compatibility tests rather than changing SAP user-name or wildcard semantics without evidence.

**Resume with.** Verify supported username characters and matching semantics, then add a narrow
validator without schema discovery on the legacy path. Retain fail-before grammar tests and a live
positive match. [Original finding](https://github.com/arc-mcp/arc-1/blob/5725fab6515f7a410e3e488003ae1a7aa3d8c249/docs/research/adt-vscode-1.2/evidence/diagnostics-review/claude-review-1.md).

<a id="feat-94"></a>
### FEAT-94 — Report a dump feed's shorter time window

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Diagnostics

**Remaining gap.** On SAP_BASIS 7.50 the dump feed only reaches back 24 hours: its handler raises
`from` to now minus 24 hours. A list for an older window comes back empty or cut short without a
note, so a model reports no dumps while ST22 lists them. Dump detail already explains this when the
feed does not list a dump.

**Resume with.** A list contract that can carry a note (the result is a bare array today) and a
signal for the shorter window that does not depend on dumps being present, verified on a 7.50
target that has dumps older than one day. [Mechanism](https://github.com/arc-mcp/arc-1/blob/main/docs/dev-guide.md#dump-detail-on-sap_basis-750).

<a id="feat-50"></a>
### FEAT-50 — ADT type-probe fixture coverage

- **Priority / effort / status:** P3 / XS per fixture / Contributor-driven
- **Category:** Diagnostics

**Idea.** Add recorded ADT type-availability probe fixture sets from SAP product lines and
authorization setups not represented in the replay tests.

**Why it remains.** The probe classifier needs real discovery and endpoint responses from more
landscapes, including cloud and restricted-authorization setups. Existing synthetic fixtures test
branches, but cannot replace release-specific evidence.

**Resume with.** Follow the
[fixture contribution guide](https://github.com/arc-mcp/arc-1/blob/main/docs/probe-adt-types.md),
compare the existing fixture sets, and contribute sanitized captures plus replay assertions for the
observed verdicts. Prior context:
[issue #162](https://github.com/arc-mcp/arc-1/issues/162),
[PR #163](https://github.com/arc-mcp/arc-1/pull/163), and
[PR #170](https://github.com/arc-mcp/arc-1/pull/170).

<a id="feat-32"></a>
### FEAT-32 — Stable data-preview pagination

- **Priority / effort / status:** P3 / M / Needs research
- **Category:** Data access

**Idea.** Support bounded continuation of large table previews without suggesting that ADT
freestyle SQL supports a reliable generic `OFFSET`.

**Why it remains.** Result caps protect memory, but callers cannot request the next stable page.
Offset pagination is not supported by the relevant ADT endpoint and would be unstable without an
ordering key.

**Resume with.** Design keyset pagination for named-table preview where a unique ordering can be
proven. Refuse ambiguous tables, preserve all data-preview gates, and include a schema-only mode if
it can reuse the same safe contract.

<a id="feat-86"></a>
### FEAT-86 — Additional stored-text profiles and persistence

- **Priority / effort / status:** P3 / M / Needs research
- **Category:** Data access

**Remaining gap.** `SAPQuery(action="long_text")` covers guarded discovery, ordered reads, stored header
references, and bounded phrase search for the qualified FF06/4103 classic ITF profile
([implementation and evidence](https://github.com/arc-mcp/arc-1/pull/1012)). Other container/code-page
profiles, legacy ITCRF references, and non-ITF/STXB text remain unsupported. 750 systems without the
ADT preview endpoint stay unsupported. Memory, archives, custom/upgrade persistence, and form
layouts need separate API evidence; they cannot be inferred from ordinary table bytes.

**Resume with.** A concrete unsupported customer case and independently generated SAP oracle
fixtures for that profile or persistence route. Preserve exact keys, typed errors, current-user
identity, data gates/blocklists, cumulative budgets, and content-redacted audit logs. Matching
rereads are not a snapshot; opaque compressor trailers are not authenticated. Keep
[#1000](https://github.com/arc-mcp/arc-1/issues/1000)'s companion-service option extension-only
and separate from this reader, as with FEAT-76.
No RFC or dynamically executed ABAP fallback belongs in the reader
([ADR-0009](https://github.com/arc-mcp/arc-1/blob/main/docs/adr/0009-abap-execution-and-rfc-belong-in-extensions.md)).

<a id="feat-87"></a>
### FEAT-87 — Preserve repeated spaces in general data queries

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Data access

**Remaining gap.** The tested 816 ADT preview handler condenses repeated spaces inside SQL
literals. General `TABLE_QUERY` and free-SQL predicates can therefore match a different key.
The stored-text reader preserves its own literals; the general query paths still need a fix.

**Resume with.** Positive and negative live cases for leading, internal and trailing spaces in
equality, LIKE and IN predicates. Preserve existing query semantics and safety gates; qualify the
backend grammar before generalizing the stored-text workaround.

<a id="feat-88"></a>
### FEAT-88 — Application-log discovery and wider qualification

- **Priority / effort / status:** P3 / M / Needs research
- **Category:** Data access

**Remaining gap.** Exact `SAPQuery(application_log)` reads use SAP's native OData service;
restricted-user allow/deny checks passed on 7.58. Finding logs by object/time range, message
details, BTP ABAP, principal propagation and additional active-service releases remain unqualified. Positive `$top`
limits output, not SAP's full-log load. Do not add `/$count`, broad text searches, or BALDAT fallback
without separate authorization and resource-cost evidence.

**Resume with.** A concrete support workflow and an active service on the target landscape.
Qualify native filters, time zones, DCL/BAdI restrictions and pagination before expanding the tool.
See the [native-reader investigation](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-18-application-log-native-reader.md).

<a id="feat-89"></a>
### FEAT-89 — Additional typed data-cluster use cases

- **Priority / effort / status:** P3 / M / Needs research
- **Category:** Data access

**Remaining gap.** [PR #844](https://github.com/arc-mcp/arc-1/pull/844) also proposes INDX/custom
clusters, DDIC layouts and legacy formats. Stored SAPscript texts and native application-log reads
do not replace these capabilities. Broad integration is deferred: the proposed parser needs
independent allocation/row/depth limits, exact fragment identity, and qualified encoding/layout
semantics. Prefer purpose-specific native APIs where available.

**Resume with.** A named customer workflow that cannot use an existing API, plus sanitized native
fixtures and expected values across the relevant releases/platforms. Preserve data gates, blocklists,
current-user identity, and bounded output; no RFC or executed ABAP fallback in core (ADR-0009).

<a id="feat-36"></a>
### FEAT-36 — Type information

- **Priority / effort / status:** P3 / S / Blocked
- **Category:** Code intelligence

**Idea.** Return inferred or declared ABAP type information at a source position.

**Why it remains.** No reliable endpoint has been found on the available systems. Reconstructing
types locally would duplicate a compiler incompletely.

**Unblock when.** ADT discovery exposes a supported endpoint and it can be demonstrated on a real
object and release.

<a id="feat-79"></a>
### FEAT-79 — DDIC-aware dependency context

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Code intelligence

**Remaining gap.** `SAPContext(deps)` extracts body type references, but its resolver guesses CLAS
for DDIC names. Failed class reads consume `maxDeps` and may exclude later resolvable classes.
Function-module signature parameter types are also omitted. The parser repair in
[PR #911](https://github.com/arc-mcp/arc-1/pull/911) deliberately leaves these coverage limits explicit;
`BAPI_USER_GET_DETAIL` demonstrates the lookup starvation on 750 and 758.

**Resume with.** Design bounded, permission-respecting object-kind resolution and useful DDIC
contracts, then verify source/signature type references and lookup limits on both releases. Keep
failed attempts distinct from absent objects and preserve the existing source/cache identity policy.
Evaluate prioritizing known function/class candidates ahead of ambiguous type guesses without
increasing the lookup limit; verify that any ranking change improves useful coverage.

<a id="feat-96"></a>
### FEAT-96 — Bounded class overview and large-read policy

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Code intelligence

**Remaining gap.** An optional bounded class overview and a predictable large-source response policy
could help unknown-member discovery. Define completeness, continuation, and opt-in/default behavior
before changing existing full-source reads. Broader local/interface/inherited signature resolution
also needs explicit ownership and ambiguity rules. Existing named-method, grep, range and own-MAIN
signature reads cover focused requests; they do not establish a complete inherited API.

**Evidence.** [Focused-read implementation and live measurements](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-29-read-token-quick-wins/README.md)
separate returned model context from SAP transfer. The October 31 BTP/HTTP qualification and
strict model traces also expose unnecessary follow-up reads after a sufficient method body; a
wording-only experiment did not improve that sample, and the post-review five-case run still
failed the implementation-only call budget. Metadata first adds a call when the member
is already known, and caching alone does not shrink returned source.

**Resume with.** Compare equal completed unknown-member tasks across representative classes and
clients, including retries and discovery calls. Demonstrate a useful improvement before adding a
default cap or automatic overview. Preserve source/editable hashes, version and per-user cache
boundaries, and explicit full reads.

<a id="feat-97"></a>
### FEAT-97 — Complete SHLP definitions and effective appends

- **Priority / effort / status:** P3 / M / Needs research
- **Category:** Object coverage

**Remaining gap.** Native active partial SHLP metadata is available through SAPRead and SAPContext.
Selection-method/exit headers, collective assignments, parameter positions/defaults, inactive content
and effective append provenance remain unavailable. The bounded reader needs no SQL or execution.

**Resume with.** A concrete full-definition use case, an independent complete-definition oracle and
positive append fixtures covering switch/interface semantics. Preserve data/SQL permissions and
keep execution/export extensions outside core. BTP and live restricted-user/PP qualification remain
separate evidence requirements. See [native evidence](https://github.com/arc-mcp/arc-1/blob/main/docs/research/abap-types/types/shlp.md) and
[implementation plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-10-29-shlp-native-metadata.md).

## CI and operations

<a id="feat-42"></a>
### FEAT-42 — Additional CI output formats

- **Priority / effort / status:** P3 / XS / Revisit on trigger
- **Category:** CI

**Idea.** Add JUnit or Code Climate output to `arc1-cli check` for a CI platform that needs it.

**Why it remains.** Text, JSON, and Checkstyle already cover current workflows. More serializers are
cheap but create maintenance surface without a consumer.

**Resume when.** A supported CI integration cannot consume the existing formats; add only its
specific format with a golden-file test.

<a id="ops-02"></a>
### OPS-02 — Bounded deep health check

- **Priority / effort / status:** P3 / S / Needs research
- **Category:** Operations

**Idea.** Add an optional health probe that checks the configured SAP target and reports a bounded,
non-secret failure class.

**Why it remains.** `/health` intentionally proves process liveness only. A deep check can consume
SAP capacity, fail during transient maintenance, and needs an authentication policy.

**Resume with.** Define separate readiness semantics, a short timeout, rate limiting or caching,
and output that never exposes SAP responses or credentials.

<a id="ops-05"></a>
### OPS-05 — SAP Cloud Logging and OpenTelemetry

- **Priority / effort / status:** P2 / L / Revisit on trigger
- **Category:** Operations

**Idea.** Export structured logs, traces, and metrics through an OpenTelemetry-compatible path and
document SAP Cloud Logging integration.

**Why it remains.** ARC-1 has structured logs and audit sinks, but no supported OTel pipeline or
Cloud Logging binding. Operational logging and the BTP Audit Log sink serve different purposes;
adding Cloud Logging must preserve the audit contract.

**Resume when.** A production operator needs Cloud Logging or requires migration of an existing
Application Logging deployment. Define the required signals, retention, service binding, and
exporter support before implementation.

<a id="ops-06"></a>
### OPS-06 — Per-user SAP session reuse beyond single-target Cloud Connector PP

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Operations

**Idea.** Reuse a per-user SAP session across MCP HTTP requests for the routes that still log on
again for every tool call: multi-target PP clients and single-target PP destinations that return a
Bearer token (OAuth2UserTokenExchange), a SAMLAssertion, or a credential without a usable JWT expiry.

**Why it remains.** HTTP mode builds an MCP Server per request. The shared single-target transport
and, since [#1085](https://github.com/arc-mcp/arc-1/issues/1085), single-target Cloud Connector PP
transports (keyed by the exact per-user credential and route) are reused until ten minutes or JWT
expiry. The affected deployment still needs to confirm the cause of its reported 400 responses.
Multi-target clients and the Bearer/SAMLAssertion PP routes are still built per request,
so each tool call logs on again and refetches a CSRF token. On SAP_BASIS 816 such bursts coincided
with fresh stateful contexts failing (`400 Session not found`); see the
[investigation](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-09-27-sap-816-session-failures.md).
SAMLAssertion requests also send `x-sap-security-session: create`, so reuse there needs its own
evidence.

**Resume when.** A multi-target or Bearer/SAMLAssertion PP deployment reports `400 Session not found`
or failed stateful closes under load, or SAP logon volume becomes an operator concern. Key any cache
by SAP identity and token lifetime, keep users isolated, keep ADR-0007's request-local Basic
credentials, and keep ADR-0010's per-call drift checks. Reuse the single-target bound and revocation
notes in
[security-model R21](https://github.com/arc-mcp/arc-1/blob/main/docs/security-model.md#r21-shared-login-credential-freshness).

<a id="ops-07"></a>
### OPS-07 — Signed single-file executables

- **Priority / effort / status:** P3 / M / Revisit on trigger
- **Category:** Operations

**Idea.** Close the gaps of the unsigned Node SEA executables shipped with each release: code
signing/notarization, embedded UI assets, `ARC1_PLUGINS` support, and a Windows arm64 target.

**Why it remains.** The executables remove the thousands-of-files antivirus scan, but an unsigned
Windows binary is still scanned once on first start, and the SEA build does not embed the UI assets
or verify plugin loading. Signing needs a certificate and secret handling that the project does not have.

**Resume when.** Users report SmartScreen/Defender blocks despite checksums, or a supported
`windows-11-arm` runner is available. Define the signing identity and key custody first; verify
plugin loading in a SEA before claiming support.

<a id="ops-08"></a>
### OPS-08 — SAP outage isolation and queue deadlines

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Operations

**Idea.** Define target-specific circuit-breaker behavior and bounded queue waits for SAP calls.

**Why it remains.** SAP ref. 137800 calls for outage protection. ARC-1 has HTTP timeouts, bounded
retry paths and concurrency admission, but no built-in circuit breaker; ordinary semaphore waits
lack a queue deadline. A semaphore does not suppress repeated calls to an unavailable backend.
See the [current gap assessment](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-21-sap-api-policy-custom-mcp.md).

**Resume with.** Define transient-failure classification, target isolation, recovery probes, queue
deadlines and actionable errors. Test outage/recovery without replaying uncertain writes, treating
one user's authorization denial as a system outage, or letting one failed target block healthy ones.
Compare application and gateway controls before choosing where the breaker belongs.

<a id="feat-07"></a>
### FEAT-07 — Native TLS listener

- **Priority / effort / status:** P3 / M / Revisit on trigger
- **Category:** Operations

**Idea.** Let the standalone HTTP server terminate TLS directly with documented certificate
loading and rotation behavior.

**Why it remains.** A reverse proxy or platform router is the supported and more capable default.
Native TLS is useful only where operators cannot deploy one.

**Resume when.** A real supported topology requires direct termination. Specify certificate-chain
loading, encrypted key handling, reload/rotation, HTTP-to-HTTPS behavior, and integration tests.

## Documentation

<a id="doc-02"></a>
### DOC-02 — Basis administrator handbook

- **Priority / effort / status:** P2 / M / Ready
- **Category:** Documentation

**Idea.** Create a short Basis-first entry point that connects the existing deployment, role,
principal-propagation, Cloud Connector, certificate, transport, and troubleshooting material.

**Why it remains.** The facts exist across several accurate pages, but a Basis administrator still
has to infer the ownership sequence and evidence handoffs. This is consolidation and review, not a
second deployment runbook.

**Resume with.** Build a role-based index and checklist from the canonical pages, then have an
independent Basis administrator validate terminology and handoff steps. Keep configuration details
in their existing single sources of truth.
