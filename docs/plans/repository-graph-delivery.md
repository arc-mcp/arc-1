# Experimental graph delivery: reviewed implementation checklist

2026-09-07. Continues PR #756; **do not merge**. This checklist refines the specification using
the user's decision: one ARC-1 repository, independent optional backend build/deployment. The
latest request is interpreted as testing separate ARC instances against PostgreSQL and HANA.

## Non-negotiable boundaries

- Normal ARC npm/image/build and tool surface remain graph-backend-free/default-hidden.
- Move only metadata graph code into `services/repository-graph/`; do not import the older HANA
  source-storage experiment, its data, credentials, `.env`, or deployment artifacts.
- Retain the source PoC unchanged as a reference until migration/tests are complete.
- Reuse existing PostgreSQL **free** and the newly authorized HANA **hana-free** resource. No paid upgrade, entitlement
  expansion, database replacement, unrelated ARC redeployment or production-readiness claim.
- CF org initially used 3,328 MiB of its 4,096 MiB free quota, with 9/10 routes. The platform
  clamps build staging to **1,024 MiB** even when 512 MiB is requested. Temporarily stop only
  the graph PoC/test apps during staging; never unrelated apps. Reserve a full GiB in preflight.
- Shared metadata is the ADR-0008 exception, not per-user SAP authorization. Collector has no
  public route. Query API authenticates independently and never receives caller SAP credentials.

## Ordered delivery and evidence

1. [x] Import the metadata-only backend as a private independently installed package. Freeze the
   v2 contract, build the core without backend dependencies, and rerun offline Docker tests.
2. [x] Introduce a backend-neutral store boundary; implement PostgreSQL/HANA contract parity,
   independent reader/writer provisioning and transactional bounded queries. Diagnose existing
   HANA connectivity before creating any additional database resource.
3. [x] Fix bounded acquisition, parser execution, discovery/refresh and snapshot correctness;
   retain explicit unsupported/deletion semantics where authoritative evidence is unavailable.
   Prove failure retention, repeat refresh and concurrent query consistency.
4. [x] Package portable BTP configuration/preflight/bootstrap/connection handoff. Defaults must
   reuse selected resources, refuse paid fallback and preserve existing settings/credentials.
5. [x] Deploy an isolated ARC test instance and exercise authenticated MCP list/call, default hidden,
   enabled, denied and failure paths against each available backend. Track free quota throughout.
6. [x] Review security boundaries, perform local restore/API-key rotation and resource-limit checks,
   fix findings and rerun affected tests. Managed backup/DB credential rotation remains explicitly
   unverified. Unsupported SAP transports fail explicitly, never bypass Cloud Connector or identity.
7. [x] Replace PoC-only docs with one reproducible human/LLM entry and environment-specific steps.
   Validate examples against actual artifacts and walk fresh/existing/unsupported setup scenarios.
8. [x] Full core/backend/build/typecheck/lint/policy/schema/docs gates, final diff/secret review,
   push reviewable commits to the open PR and leave it unmerged. Report remaining gaps honestly.

Production-only scope expansion (restricted audiences, multi-target, vectors, full-system semantic
accuracy) is not part of this experimental release. HANA parity is now explicitly requested for
this delivery, overriding its earlier deferral. A real platform/credential blocker must be
reported rather than resolved with paid capacity or broader authorization.

## Verified evidence (2026-09-07)

### Live-versus-graph usefulness comparison

- [x] Start two matched local Docker ARC instances, baseline graph-off and graph-enabled,
  using the existing BTP HANA graph without consuming additional CF route quota.
- [x] Verify identical live schemas/configuration/source, auth and graph visibility boundaries,
  real relationship paths and implementers; repeat after restarting both containers.
- [x] Prepare nine grounded prompts including package-coupling, multi-hop impact and controls
  for current source, dynamic dispatch and an unindexed-but-live object.
- [x] Measure twenty graph-only MCP queries with a positive-control SAP request counter.
- [ ] Complete the actual LLM A/B evaluation before claiming better answers or maintenance ROI.

See [comparison evidence](../research/2026-09-07-graph-ab-comparison.md) and the
[human/LLM prompt guide](../../docs_page/repository-graph-comparison.md). This is a usefulness
gate, not permission to enable the experimental graph by default.

### Backend delivery evidence

- Metadata-only backend imported into the ARC repo; its package/lockfile/build remain independent.
  Root CF/MTA upload ignore lists now exclude `services/` as well as the npm files allowlist.
- Independent backend unit/typecheck/lint/audit gates pass; fresh and existing Docker flows passed,
  including API v2, last-good retention, no persisted source canary, read snapshots and writer leases.
  A second clean project used its own private secrets/volume/8094 port, passed all offline tests and
  restore, then was stopped without deleting its volume. Existing projects were preserved.
- Hardened live downloads (1 MiB decoded body), isolated parsing (5 s / 128 MiB old-space worker),
  destination identity/transport checks, credential-safe failures and session-fenced collector locks.
- The initial full core run had one UI-route flake. The isolated 16 UI tests and subsequent full
  runs passed. No speculative product change was made to hide the flake. Final gates include the
  new documentation/distribution/CF-template assertions and unchanged default tool snapshots.
- HANA SQL probe failed; CF broker parameters returned “instance does not exist”; BTP Service
  Manager returned **410 Gone**. User's HANA Cloud Central page independently shows **0 instances**.
  Old service/HDI records were not deleted. User authorized a new free instance: `arc-graph-hana-test`
  was created on **hana-free**, then its actual SQL endpoint passed a certificate-validated CF task
  probe (2026-09-07 08:45 UTC). SQL allowlist is `[]` (BTP CF regional access, no all-IP opening).
  A newly generated DBADMIN credential is stored only in owner-private local artifacts and an
  isolated, no-route bootstrap binding; that admin binding was removed after bootstrap/native tests.
  It is never a query/collector runtime credential. New instance GUID:
  `14281487-5887-4e73-83d0-a5ea589a0f51`; SQL is reachable from regional CF with validated TLS.
- PostgreSQL graph PoC upgraded from the monorepo artifact; dedicated `arc1-graph-validation`
  (384 MiB) was created without changing existing ARC apps. Graph is default-hidden there.
  The same dedicated ARC app was tested sequentially against PG and HANA, reusing its route.
  Enabled MCP passed 11 checks: all six actions, real one-edge path, missing-object semantics,
  argument bounds and a real live SAP class read. Explicit `SAPGraph` denial, hidden-by-default and
  backend-unavailable cases each passed two checks. Recovery passed the enabled suite again.
- Added a HANA SQL adapter with the same bounded traversal implementation as PostgreSQL. HANA
  schema/bootstrap and dedicated owner/reader/writer users now exist. A live spike caught HANA
  Cloud's user-name grammar: quoted names in `CREATE USER` fail with SQL 257; validated unquoted
  names work. Corrected bootstrap was rerun successfully without the diagnostic shim.
- The identical 13-check API v2 suite passed on actual HANA and Docker PostgreSQL. HANA's six
  live checks prove reader/writer restrictions, a stable concurrent read snapshot, atomic rollback,
  bounded collector exclusion, failure retention/valid-empty clearing, and a source-free column schema.
  Final HANA quality task `9538c001-bd82-4056-95ca-abf8ec2ec578` succeeded.
- Native HANA property-graph workspace `ARC_GRAPH.REPOSITORY_GRAPH` was created and catalog-verified.
  Query execution still uses shared bounded traversal + SQL. No native acceleration benchmark or
  vector/AI Core claim is made.
- Final live HANA collection task `d2232595-6101-4f4d-bf2f-f7d85251472f` succeeded: 125 objects,
  715 observations, 921,278 transient bytes, 152 logical requests, 67.77 seconds, concurrency 2.
  122 parsed, one empty DDLS source failed, two programs contained unsupported/macro statements.
  No read failures or discovery saturation; coverage correctly remains **partial**. Earlier narrow
  collection covered 75 objects / 505 observations / 380,456 bytes in 38.75 seconds.
- Large PostgreSQL synthetic test: 100,000 nodes / 1,000,000 observations, 502,259,712 bytes of
  relations/indexes and 1,073,862,048 initial WAL bytes. Bulk fixture seed 10.71 seconds is not a
  live SAP ingestion rate. Bounded traversal p95 1.51–13.25 ms across concurrency 1/5/10 and depth
  1/3; truncation is explicit. Metadata substring search separately measured 39.87–73.28 ms p95,
  concurrency 1, 30 warm queries. Its full-text GIN index is not used by `ILIKE`; full-system
  search optimization remains a documented follow-on.
- Local logical restore succeeded with 100,086 nodes / 1,020,153 observations; runtime reader
  access survived. Original DB untouched; scratch backup/database removed. Fresh-fixture restore
  also passed. No managed-service disaster-recovery claim is made.
- API credential HTTP tests cover old-only, bounded two-key overlap, new-only and invalid keys.
  The runbook explains coordinated API/ARC restart and rollback; DB-password rotation is separate.
- Final review found PG writer access to migration history. Fresh grants now enumerate writable
  graph tables; explicit admin migration repairs earlier schema-1 grants/default privileges.
  Local negative tests and BTP task `d5e83c4b-ef15-4433-a617-2f9080243ffe` prove the writer cannot
  change migration history. BTP PostgreSQL 16.13 TLS 1.3 bootstrap revalidation passed; its
  temporary administrator bindings were then removed.
- Normal npm pack dry run contained zero backend/private files (693 files, 5,102,721 unpacked
  bytes). Known-credential scan: 16 private values checked across 1,582 candidate repository files,
  zero hits. Backend npm audit: zero known vulnerabilities. Native SAP client retains SAP's license;
  no backend image is published in this PR.
- Documentation: canonical entry + backend runbook + specification, both CF manifests, MTA
  attachment guidance, strict MkDocs, schema-valid CLI examples and parsed template/navigation tests.
  CI has an independent Node 22/24 backend job with offline Docker/restore checks and its own audit;
  Dependabot monitors the independent lockfile.

## Explicit next-milestone limits

- At this delivery checkpoint, Cloud Connector and principal-propagation **collection** were unsupported.
  Cloud Connector technical Basic support is now covered by
  [the follow-up plan](repository-graph-cloud-connector-and-sizing.md); headless PP remains refused.
  This does not change ordinary ARC PP/Cloud Connector operations or graph retrieval.
- No unattended installer, scheduling, durable resume, conditional-source refresh, authoritative
  deletion, per-edge freshness, full-system precision/recall score or production managed restore.
  Manual collection is capped at 500 objects with bounded source/parser/discovery operations;
  counts are logical operations, not exact retry/load accounting.
- HANA free stops nightly; inactive deletion/lifecycle must be owned by the operator. PG free
  export decision is due before 2026-12-06 for this instance. No paid fallback or upgrade was used.
- Steady test allocation is 3,712/4,096 MiB and 10/10 routes. Stage serially with only owned test
  apps stopped. Old stale HANA/HDI entries and unrelated ARC apps remain untouched.
- Future release packaging needs an immutable backend image/SBOM/license review; this delivery
  is a source PR and independently buildable experimental profile, not a published hosted service.

## Final handoff

- Implementation committed and pushed as `4d49822b` to open PR
  [#756](https://github.com/arc-mcp/arc-1/pull/756); **not merged**.
- Final local gate: **5,841 ARC tests and 85 backend unit tests**, zero failures/skips. Build,
  typecheck, lint, policy/schema/file budgets, MTA validation and strict MkDocs pass. Seven
  documentation tests validate schemas, distribution exclusions, CF templates and navigation.
- The 09:56 UTC CF backend artifact was staged once, then reused without extra staging. HANA API
  droplet `951a3759-ab65-4f31-9cbb-c7dd038e3a09`; collector droplet
  `4ec2136e-134c-41cd-98dc-853d68b9f441`. ARC enabled MCP suite passed at 09:56 UTC, then
  `ARC1_GRAPH_TOOLS=false` was restored and hidden/non-invokable behavior rechecked.
- Both bootstrap apps have their administrator bindings removed. Collector web app is stopped;
  no unattended collection is configured. Free preflight remains 3,712/4,096 MiB and 10/10 routes.
- HANA administrator password is newly generated, **not** the older password from the conversation.
  It remains only in owner-private local preparation artifacts and the unbound bootstrap UPS;
  no credentials are in Git, task arguments, the API or ARC connection descriptor.
- Remote GitHub CI is separate from this local/live evidence; its status must be checked before
  any later merge. No production readiness, unsupported transport or future-milestone gate is
  implied by the checked experimental delivery steps above.
- The first Linux CI run exposed Compose file-secret UID mismatch (Mac Docker did not reproduce
  it). Setup now keeps original ARC files at 0600 and stages individual read-only mount copies
  inside a 0700 host-only directory. No container is changed to run as root. Existing secrets are
  preserved; mismatched staged copies fail closed. Linux Docker CI passed on the corrected build
  (runs `34109422849` and `34109701835`).
- CodeQL review also prompted removal of the bearer-token whitespace regex, direct timing-safe
  comparison of bounded high-entropy API-key bytes (no password-hash primitive), and removal of
  environment-derived setup paths from console output. Malformed/long authorization headers are
  covered by the HTTP credential tests; no scanner alert is suppressed or dismissed.
- Final HTTP review reproduced an unauthenticated malformed request target rejecting the async
  listener before its error boundary. URL parsing now returns a generic HTTP 400; direct-listener
  and real HTTP regression tests prove the process still serves health checks afterwards.
  The regression was observed failing before the fix. Updated deployment/CI receipts are recorded
  on PR #756 so later status changes do not require documentation-only CI reruns.
