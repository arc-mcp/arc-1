# Repository graph: internal → Docker → BTP validation

2026-09-07. Follow-up to PR #756 and the [initial validation](repository-graph-validation.md).
The standalone backend remains independently built in `arc-repository-index`, not inside ARC.
Existing deployed ARC applications and the older HANA source index were not redeployed.

## Internal-first core change

Connection configuration no longer implies MCP exposure. `ARC1_GRAPH_TOOLS=false` is the default.
An explicit private file/CF binding enables internal CLI diagnostics; MCP needs an additional `true`.
A healthy configured backend stays hidden, cannot be called directly or through hyperfocused wrappers,
and creates no MCP graph runtime/poll loop. Scope/deny/audit/rate checks still apply to attempted calls.
No database driver, collector, migration, source storage or generic plugin changes enter core.

Core wiring for this refinement is two config entries, one optional type field and one guarded
creation line in each of CLI listing, server startup and the graph bridge. The larger logic and
tests remain contained in the graph module/backend. Normal cache and live SAP behavior are unchanged.

| Check | Result |
| --- | --- |
| Full ARC unit suite | 5,834 tests / 201 files pass |
| Graph adapter subset | 63 tests, including healthy-but-hidden standard/hyperfocused and real authenticated HTTP |
| Gates | Build, typecheck, lint, policy and file/schema budgets pass |
| Default schemas | Existing fixtures unchanged; zero added default wire bytes |
| Backend tests | 91 tests / 22 files pass, plus Docker database/API checks |
| Fresh Docker | Separate new volume/project; no SAP secret; migrate, repeat seed, refresh-failure, retention, scoped API pass |
| Local native MCP | 58 calls, 5 concurrent, 50 measured queries; p50 8.85 ms / p95 15.80 ms; zero SAP requests |

The Docker API v2 suite ran 13 checks and collector failure suite seven checks. Default offline
scope now matches the golden fixture; live collection is a separately opted-in container.
Descriptor generation preserves existing keys/settings. Deployment artifacts are allowlisted and
reject symlinks; private folders/reports are excluded. A scan of the backend's 111 candidate files
found none of the 12 known local credential values (not a substitute for a full secret scanner).

## BTP resources and cost

Provisioned `arc-graph-pg` on the actual **postgresql-db / free** plan in the existing `abap-dev`
space. The BTP environment API confirms **cloudfoundry / free**, not merely a quota named "free".
No paid database/CF upgrade was made. One PostgreSQL free entitlement was assigned. Existing
Destination lite is reused only by the collector. HANA DBADMIN credentials were not used/stored.

- Query API: one 256 MiB CF process; database reader and API key bindings only.
- Collector: stopped task app; 512 MiB while explicitly collecting; writer + Destination bindings.
- Bootstrap: stopped 256 MiB task app; dedicated managed admin binding; creates/checks roles/migrations.
- Consumer: stopped 128 MiB task app; only the graph connection binding, no SAP/database credential.
- PostgreSQL 16.13; 79 maximum connections reported; API pool capped at three, writer at two.
- Database after collection/repeat: 12,090,391 bytes; node relations/indexes 1,286,144 bytes;
  edge relations/indexes 1,359,872 bytes. Fixed free-plan RAM/disk capacity was not exposed in the
  retrieved broker parameters; do not infer a hard storage ceiling from these usage figures.

Expected incremental service-plan charge is zero within the selected free offerings/quota; this
does not assert the account's whole bill is zero. SAP documents [90 active days and 30 backup/migration
days](https://help.sap.com/docs/PostgreSQL/b3fe3621fa4a4ed28d7bbe3d6d88f036/715c7b8c813c4e24ba49f758e468846e.html),
followed by possible permanent deletion. Export/upgrade decision is needed **before 2026-12-06**.
No scheduler, paid upgrade or production availability promise was introduced.

## Important plan correction: network topology

An `apps.internal` route could be created but did not provide working app-to-app connectivity.
Network-policy operations were denied. SAP's [supported-feature list](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/f8a351c8d81544a2942c911dccaba3c7.html)
explicitly says container-to-container networking is unsupported on BTP CF. Generic upstream CF
documentation alone was insufficient. Application XSUAA roles must not be invented to obtain
platform network authority.

The tested alternative is a **standard internet-reachable HTTPS route with service-key
authentication**, exact system/audience checks and no anonymous metadata. Only minimal health is
public. The obsolete internal route was removed. This is not network-private access; if that
becomes mandatory, redesign the deployment instead of calling it private because it is in one space.
ARC's client-visible graph tool remains off regardless of this backend route.

## Live collection and retrieval

First bounded `$TMP` discovery illustrates a realistic gap: SAP's first 50 repository results
yielded only two supported programs, including a 5 MB standalone abapGit object. Three SAP requests
produced 1,781 observations in about 44 seconds; saturated discovery and 59 dynamic targets were
correctly reported as **partial**, not "system indexed".

The targeted `ZSSI_*` run discovered and parsed **75 objects**, downloaded 380,456 bytes, used 80
SAP requests and produced **505 observations in 12.73 seconds**, with no saturated search, read or
parse failure. Repeat collection preserved 505 observations for that scope. Combined database:
1,661 nodes / 2,286 observations; **1,579 nodes are unresolved references**, not collected sources.
The latest coverage refers only to `Z*:ZSSI_*`, not the earlier partial scope or the whole SAP system.

| Retrieval check | Result |
| --- | --- |
| Local ARC → BTP HTTPS | 58 MCP calls, 50 measured queries / 5 concurrent; p50 166.87 ms / p95 501.09 ms; zero SAP requests |
| Actual named CF binding → native ARC | VCAP consumed only in process memory; 58 calls, p50 172.37 ms / p95 512.66 ms; zero SAP requests |
| Known sample | `ZCL_SSI_ENGINE`: two-hop impact 7 nodes / 12 observations; neighbors response 6,046 bytes |
| CF consumer → CF API via HTTPS | 27 checks/calls; 15 timed / 3 concurrent; p50 18.70 ms / p95 55.22 ms |
| Non-vacuous CF sample | One-hop impact 3 nodes / 2 edges, no SAP or DB binding on consumer |
| Auth/scope | Missing/wrong key 401; wrong system/audience 403; scoped v1 disabled; invalid bounds rejected |
| Retention | No source-body columns or persisted source/error canaries |
| Roles | API SELECT allowed, INSERT/DDL denied by privileges; writer DML allowed, DDL denied |
| Bootstrap | Successful repeat with verified TLS 1.3; no password rotation/privilege expansion |

These small-sample timings are not production sizing or a system-wide accuracy benchmark. The prior
Docker 100k-node / 1m-observation results remain separate synthetic sizing evidence.

## Issues corrected and remaining gates

Fixed: offline SAP-secret dependency, connected-but-exposed MCP defaults, ambiguous CF database
selection, artifact secret inclusion risk, private-route BTP assumption, a hidden `pg_stat_ssl` row
misread as missing TLS, unnecessary privileged `ALTER ROLE` on bootstrap rerun, and a vacuous cloud
impact sample. The actual certificate-verified client socket is used for the TLS diagnostic.

Existing HANA capacity task failed with an HTTP 400 connection response; capacity was **not** measured
and HANA was left unchanged. SAP Docs MCP search/fetch worked; Discovery Center search still returned
an upstream 404. Entitlements and selected plans were verified through logged-in BTP/CF APIs.

Still before production: restricted-audience authorization, durable incremental jobs/deletion,
scope-wide completeness, unresolved metadata enrichment, precision/recall oracle, backup/restore on
the managed service, key rotation/rate policy, automatic lifecycle handling, packaged installer,
HANA contract parity and cflinuxfs5 migration before SAP's announced 2027 stack retirement.
