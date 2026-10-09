# ARC-1 Idea Roadmap

**Last reviewed:** 2026-10-05

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
| [SEC-16](#sec-16) | Client ID Metadata Documents (CIMD / SEP-991) | P1 | XL | Parked proposal | Auth / Compatibility |
| [SEC-15](#sec-15) | Durable DCR signing-key lifecycle | P2 | L | Needs research | Auth / Operations |
| [COMPAT-06](#compat-06) | Standard outbound proxy support | P2 | M | Ready | Compatibility |
| [COMPAT-07](#compat-07) | CDS view-entity replacement lineage | P2 | S | Needs research | Compatibility |
| [COMPAT-09](#compat-09) | Exact lookup with decorated SAP object names | P2 | S | Needs research | Compatibility |
| [COMPAT-10](#compat-10) | CDS set-operation lineage | P2 | M | Needs research | Compatibility |
| [SEC-14](#sec-14) | DNS rebinding and Host-header hardening | P3 | M | Revisit on trigger | Security |
| [SEC-17](#sec-17) | Match echoed abapGit credentials by value | P2 | M | Needs research | Security |
| [SEC-18](#sec-18) | Implicit CDS conversion dependencies | P3 | M | Revisit on trigger | Security |
| [FEAT-03](#feat-03) | Enhancement authoring beyond BAdI implementations | P2 | L | Needs research | ABAP authoring |
| [FEAT-81](#feat-81) | Set the ABAP language version of packages and objects | P1 | M | Needs research | ABAP authoring |
| [FEAT-05](#feat-05) | Safe rename and extract refactorings | P3 | L | Needs research | Developer workflow |
| [FEAT-21](#feat-21) | ABAP F1 documentation | P3 | S | Needs research | Developer workflow |
| [FEAT-23](#feat-23) | Recursive program include reading | P2 | M | Needs research | Developer workflow |
| [FEAT-30](#feat-30) | ABAP cleaner integration | P3 | L | Revisit on trigger | Developer workflow |
| [FEAT-66](#feat-66) | Interactive confirmation for destructive actions | P3 | L | Blocked | Safety / UX |
| [FEAT-75](#feat-75) | Delete mutually-referencing objects as one set | P2 | S | Ready | Developer workflow |
| [FEAT-76](#feat-76) | Parameterized extension service calls | P2 | M | Needs research | Integration |
| [FEAT-77](#feat-77) | Verified read-only POST operations for extensions | P2 | M | Needs research | Integration |
| [FEAT-22](#feat-22) | Safe gCTS mutation workflows | P3 | L | Needs research | Integration |
| [FEAT-34](#feat-34) | Translation workflows beyond text symbols | P3 | L | Needs research | Localization |
| [FEAT-62](#feat-62) | Transaction source and write support | P3 | M | Blocked | Object coverage |
| [FEAT-70](#feat-70) | Table technical settings | P2 | M | Needs research | Object coverage |
| [FEAT-72](#feat-72) | CDS index objects | P3 | M | Blocked | Object coverage |
| [FEAT-73](#feat-73) | Additional server-driven object types | P3 | S | Needs research | Object coverage |
| [FEAT-78](#feat-78) | Table type access type and keys | P2 | M | Needs research | Object coverage |
| [FEAT-09](#feat-09) | Cross Trace result reader | P2 | M | Needs research | Diagnostics |
| [FEAT-69](#feat-69) | Mass syntax check | P2 | S | Ready | Diagnostics |
| [FEAT-71](#feat-71) | Dictionary activation log | P3 | M | Needs research | Diagnostics |
| [FEAT-74](#feat-74) | Dump feed attribute filters | P3 | S | Ready | Diagnostics |
| [FEAT-50](#feat-50) | ADT type-probe fixture coverage | P3 | XS each | Contributor-driven | Diagnostics |
| [FEAT-32](#feat-32) | Stable data-preview pagination | P3 | M | Needs research | Data access |
| [FEAT-36](#feat-36) | Type information | P3 | S | Blocked | Code intelligence |
| [FEAT-79](#feat-79) | DDIC-aware dependency context | P2 | M | Needs research | Code intelligence |
| [FEAT-42](#feat-42) | Additional CI output formats | P3 | XS | Revisit on trigger | CI |
| [OPS-02](#ops-02) | Bounded deep health check | P3 | S | Needs research | Operations |
| [OPS-05](#ops-05) | SAP Cloud Logging and OpenTelemetry | P2 | L | Revisit on trigger | Operations |
| [OPS-06](#ops-06) | Per-user SAP session reuse over HTTP | P2 | M | Needs research | Operations |
| [OPS-07](#ops-07) | Bounded HTTP request sizes for large source edits | P2 | S | Needs research | Operations |
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

<a id="compat-09"></a>
### COMPAT-09 — Exact lookup with decorated SAP object names

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Compatibility

**Remaining gap.** On SAP_BASIS 750, quickSearch labels functions such as
`BAPI_USER_GET_DETAIL` with ` (Function Module)`. `lookupObjects` compares that display name
literally, discards the hit, and `SAPContext(usages)` without a type reports no object. Both standard
and `/UI2/` function lookups reproduce this on 750 and succeed on 758. The function-specific group
resolver repaired by [PR #911](https://github.com/arc-mcp/arc-1/pull/911) does not repair this path;
provide `type="FUNC"` for usages to select that resolver.

**Resume with.** Establish canonical identity for generic lookup and type-free usages across ADT
object families, using verified fields or URIs rather than stripping arbitrary display text. Test
namespaces, ambiguous names, unrelated hits, and both releases before replacing the exact filters.

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

<a id="feat-81"></a>
### FEAT-81 — Set the ABAP language version of packages and objects

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

<a id="feat-23"></a>
### FEAT-23 — Recursive program include reading

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Developer workflow

**Idea.** Read a program and its nested includes in one bounded response through `SAPRead`.

**Why it remains.** Function-group expansion is implemented, but `expand_includes` currently applies
only to FUGR. `SAPContext` extracts class, type, and function dependencies; it does not recursively
resolve program `INCLUDE` statements. Reading each include manually is possible but costs multiple
tool calls.

**Resume with.** Validate include discovery on supported on-premise releases, then extend the
existing read tool with cycle detection, depth/object/byte limits, source boundaries, and explicit
truncation. Reuse the function-group traversal where appropriate.

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

## Integration and localization

<a id="feat-76"></a>
### FEAT-76 — Parameterized extension service calls

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Integration

**Remaining gap.** [#884](https://github.com/arc-mcp/arc-1/issues/884) needs structured parameters
and results for custom report/SmartForms functions. Existing `ctx.run` operations are name-in,
text-out; raw HTTP requires explicit write authorization. The contributor's generic SOAP 6.20
endpoint is deprecated, and no supported binding has been verified for a core helper.

**Resume with.** A redacted binding WSDL and harmless request/response/fault samples from an
authorized supported service, including table and empty-value behavior, auth route and retry
semantics. Start with a small transport-independent codec only if that contract supports it; a
named executor additionally needs explicit operation authorization and bounded results. Keep the
single-target identity and write ceiling. [Investigation](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-09-29-plugin-post-rfc.md).

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
### FEAT-70 — Table technical settings

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Object coverage

**Idea.** Read and safely edit a database table's technical settings, including data class, size
category, buffering, and storage type where supported.

**Why it remains.** TABL source writes already accept annotations such as delivery class, but
technical table settings are a separate development object. Their lifecycle is not implemented by
passing table DDL through `SAPWrite`; ARC-1 has no dedicated technical-settings read/write contract.
SAP describes the distinction in its
[database-table guide](https://learning.sap.com/courses/building-data-models-with-the-abap-dictionary-and-abap-core-data-services/creating-database-tables_ebc1477d-96ed-414b-82d4-4171da43f4a6).

**Resume with.** Capture the live ADT contract, identify release-specific fields and defaults,
preserve unchanged settings during partial edits, and verify package/transport gates, activation,
and read-back. Keep already-supported DDL annotations outside this gap.

<a id="feat-72"></a>
### FEAT-72 — CDS index objects

- **Priority / effort / status:** P3 / M / Blocked
- **Category:** Object coverage

**Idea.** Add read/create/update coverage for CDS index objects advertised by ADT discovery.

**Why it remains.** Discovery markers exist, but ARC-1 has no verified object instances, source
shape, lifecycle, or cross-release tests.

**Unblock when.** A test system has a seed object or a reproducible creation path. Record the live
media types and activation behavior before adding schemas.

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
### FEAT-74 — Dump feed attribute filters

- **Priority / effort / status:** P3 / S / Ready
- **Category:** Diagnostics

**Idea.** Let `SAPDiagnose(action="dumps")` filter short dumps by the other attributes SAP's feed
supports, not only `user` and the time window.

**Why it remains.** `GET /sap/bc/adt/feeds` self-describes the dumps feed, and its
`feed:attributes` list is much wider than what ARC-1 exposes: `runtimeError`, `exception`,
`objectName`, `package`, `packageHierarchy`, `component`, `responsible`, `objectResponsible`,
`packageResponsible`, and a `dateTime`-typed `datetime`. The declared operators are `equals`,
`notEquals`, `contains`, `notContains`, `greater`, `greaterOrEquals`, `less`, `lessOrEquals`,
`between`, `notBetween`, with `queryDepth` 2. Live-verified on SAP_BASIS 816 (2026-09-22):
`and(contains(objectName,SAPM))` returned 11 entries and
`and(between(datetime,20260901000000,20260910000000))` returned 49, against an unfiltered feed
capped at 100. Filtering server-side is far cheaper than paging the whole feed and discarding
entries client-side, and answers questions ARC-1 cannot express today, such as "every TIME_OUT
dump in package Z\*".

**Resume with.** Read the per-system `feed:attributes` rather than hardcoding the list (it is
release-dependent and also published for system messages and the gateway error log), map a small
typed filter input onto the `and(...)` grammar without string-concatenating caller text, and keep
the existing `user`/`from`/`to` parameters working. Note that the feed's own `rel="next"` link
appends `sap-client` on every hop, so paging must keep rebuilding the `to` cursor as
`listDumps` does.

<a id="feat-69"></a>
### FEAT-69 — Mass syntax check

- **Priority / effort / status:** P2 / S / Ready
- **Category:** Diagnostics

**Idea.** Extend the read-only `SAPRead(type="SYNTAX")` route to check a bounded list of objects
and return per-object findings without stopping at the first failure.

**Why it remains.** The current syntax action accepts one object. ATC can cover packages or object
sets, but it is heavier and semantically different from a direct syntax check.

**Resume with.** Validate multiple entries in ADT's existing `checkObjectList` request, then add a
strict object-count limit, deterministic per-object findings, explicit incomplete/error results,
and aggregate counts. Bound concurrency if a per-object fallback is necessary.

<a id="feat-71"></a>
### FEAT-71 — Dictionary activation log

- **Priority / effort / status:** P3 / M / Needs research
- **Category:** Diagnostics

**Idea.** Return useful DDIC activation-log details after a failed or warning-producing activation.

**Why it remains.** The known activation-log resource is not a simple readable GET endpoint. The
request shape, lifetime, and relation to an activation request are not sufficiently established.

**Resume with.** Capture the live request/response sequence for a controlled DDIC activation
failure and define a bounded, sanitized output contract.

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
### OPS-06 — Per-user SAP session reuse over HTTP

- **Priority / effort / status:** P2 / M / Needs research
- **Category:** Operations

**Idea.** Reuse a principal-propagation user's SAP session across MCP HTTP requests instead of
logging on again for every tool call.

**Why it remains.** HTTP mode builds an MCP Server per request. The shared single-target SAP
transport is reused with ten-minute replacement for new requests, but per-user PP clients and
multi-target clients are still built per request, so each tool call logs on again and refetches a
CSRF token. On SAP_BASIS 816 such bursts coincided with fresh stateful contexts failing (`400 Session not found`); see the
[investigation](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-09-27-sap-816-session-failures.md).

**Resume when.** A PP or multi-target deployment reports `400 Session not found` or failed stateful
closes under load, or SAP logon volume becomes an operator concern. Key any cache by SAP identity and
token lifetime, keep users isolated, and keep ADR-0007's request-local Basic credentials.
Specify credential revocation and an absolute reuse lifetime before extending the sharing model;
the single-target transport's bounded reuse and remaining revocation limitations are documented in
[security-model R21](https://github.com/arc-mcp/arc-1/blob/main/docs/security-model.md#r21-shared-login-credential-freshness).

<a id="ops-07"></a>
### OPS-07 — Bounded HTTP request sizes for large source edits

- **Priority / effort / status:** P2 / S / Needs research
- **Category:** Operations

**Remaining gap.** The HTTP server uses Express's default 100 KiB JSON body limit. Large source
writes or batches can fail with HTTP 413 before tool dispatch, even when a reverse proxy permits
larger bodies. Smaller edits or local stdio are current workarounds; see [SAPWrite](tools.md#sapwrite).
The limitation was confirmed during [PR #793](https://github.com/arc-mcp/arc-1/pull/793)'s docs review.

**Resume with.** Define a bounded request-size contract and useful client errors before raising the
limit. Review parsing before authentication, concurrent memory use, and proxy limits; test both
oversized rejection and an authenticated large-source write/read-back round trip.

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
