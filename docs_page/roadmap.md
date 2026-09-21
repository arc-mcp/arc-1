# ARC-1 Idea Roadmap

**Last reviewed:** 2026-09-18

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
| [ARCH-02](#arch-02) | Server-driven types in generic object-URL callers | P2 | S | Ready | Architecture |
| [FEAT-59](#feat-59) | Embeddable multi-tenant server API | P3 | L | Revisit on trigger | Architecture |
| [SEC-16](#sec-16) | Client ID Metadata Documents (CIMD / SEP-991) | P1 | XL | Parked proposal | Auth / Compatibility |
| [SEC-15](#sec-15) | Durable DCR signing-key lifecycle | P2 | L | Needs research | Auth / Operations |
| [COMPAT-06](#compat-06) | Standard outbound proxy support | P2 | M | Ready | Compatibility |
| [SEC-14](#sec-14) | DNS rebinding and Host-header hardening | P3 | M | Revisit on trigger | Security |
| [FEAT-03](#feat-03) | BAdI and enhancement authoring | P2 | L | Needs research | ABAP authoring |
| [FEAT-05](#feat-05) | Safe rename and extract refactorings | P3 | L | Needs research | Developer workflow |
| [FEAT-21](#feat-21) | ABAP F1 documentation | P3 | S | Needs research | Developer workflow |
| [FEAT-23](#feat-23) | Recursive program include reading | P2 | M | Needs research | Developer workflow |
| [FEAT-30](#feat-30) | ABAP cleaner integration | P3 | L | Revisit on trigger | Developer workflow |
| [FEAT-66](#feat-66) | Interactive confirmation for destructive actions | P3 | L | Blocked | Safety / UX |
| [FEAT-22](#feat-22) | Safe gCTS mutation workflows | P3 | L | Needs research | Integration |
| [FEAT-34](#feat-34) | Translation workflows beyond text symbols | P3 | L | Needs research | Localization |
| [FEAT-62](#feat-62) | Transaction source and write support | P3 | M | Blocked | Object coverage |
| [FEAT-70](#feat-70) | Table technical settings | P2 | M | Needs research | Object coverage |
| [FEAT-72](#feat-72) | CDS index objects | P3 | M | Blocked | Object coverage |
| [FEAT-73](#feat-73) | Additional server-driven object types | P3 | M | Blocked | Object coverage |
| [FEAT-09](#feat-09) | Cross Trace result reader | P2 | M | Needs research | Diagnostics |
| [FEAT-69](#feat-69) | Mass syntax check | P2 | S | Ready | Diagnostics |
| [FEAT-71](#feat-71) | Dictionary activation log | P3 | M | Needs research | Diagnostics |
| [FEAT-50](#feat-50) | ADT type-probe fixture coverage | P3 | XS each | Contributor-driven | Diagnostics |
| [FEAT-32](#feat-32) | Stable data-preview pagination | P3 | M | Needs research | Data access |
| [FEAT-36](#feat-36) | Type information | P3 | S | Blocked | Code intelligence |
| [FEAT-42](#feat-42) | Additional CI output formats | P3 | XS | Revisit on trigger | CI |
| [OPS-02](#ops-02) | Bounded deep health check | P3 | S | Needs research | Operations |
| [OPS-05](#ops-05) | SAP Cloud Logging and OpenTelemetry | P2 | L | Revisit on trigger | Operations |
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
### ARCH-02 — Server-driven types in generic object-URL callers

- **Priority / effort / status:** P2 / S / Ready
- **Category:** Architecture

**Idea.** Resolve `SDO_REGISTRY` types to their registered collection in generic object-URL callers.

**Why it remains.** After [#809](https://github.com/arc-mcp/arc-1/pull/809), `objectBasePath()` still
maps these types to program URLs in `SAPTransport` (`check`, `history`) and single-object
`SAPDiagnose` (`syntax`, `atc`, `unittest`). On SAP_BASIS 758 SP02, syntax checking DSFD
`CALENDAR_OPERATION` reports "The REPORT/PROGRAM statement is missing". ATC batches reject these
types in `ATC_BATCH_TYPES` before dispatch; they are not an exposed instance of this defect.

**Resume with.** Derive generic paths from `SDO_REGISTRY`, remove redundant per-caller guards,
and preserve `SAPActivate`'s discovery gate. Verify every affected tool on a real system;
a valid object URL does not establish support for each operation.

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

## Developer workflows

<a id="feat-03"></a>
### FEAT-03 — BAdI and enhancement authoring

- **Priority / effort / status:** P2 / L / Needs research
- **Category:** ABAP authoring

**Idea.** Add guarded creation or editing workflows for enhancement implementations and BAdIs.

**Why it remains.** ARC-1 can read enhancement implementation metadata and relations, but that is
not authoring support. The create/update wire contracts and activation behavior are not proven
across supported releases.

**Resume with.** Capture live ADT traffic for one narrowly scoped enhancement type, define package
and transport gates, and add read-back verification before exposing writes.

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

## Integration and localization

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

- **Priority / effort / status:** P3 / M / Blocked
- **Category:** Object coverage

**Idea.** Extend the server-driven registry to DRTY, DRAS, and DSFI if their live contracts are
stable enough for ARC-1.

**Why it remains.** The registry already covers DESD, DTSC, CSNM, EVTB, EVTO, COTA, DSFD, DTDC,
and UIAD. The remaining candidates lack complete live create/update evidence, and every added type
also consumes model-facing schema budget.

**Unblock when.** Live probes provide discovery markers, media types, metadata roots, source format,
create/update/delete behavior, and read-back fixtures for each type. Add candidates independently;
do not ship them as an all-or-nothing bundle.

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

<a id="feat-69"></a>
### FEAT-69 — Mass syntax check

- **Priority / effort / status:** P2 / S / Ready
- **Category:** Diagnostics

**Idea.** Check a bounded list of objects in one `SAPDiagnose` call and return per-object findings
without stopping at the first failure.

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
