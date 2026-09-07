# Graph backend setup (experimental)

This installs the optional backend from `services/repository-graph/` in the **same ARC-1
repository**, with an independent lockfile/build/deployment. Use the same reviewed Git revision for
ARC and the backend. There is no hosted service or published one-command installer yet.
The tested contract is API **v2**, schema **1**, package **0.0.1**; versions do not imply a
released ARC npm package. [Start with the audience decision](repository-graph.md#audience-and-safety).

| Where | Database | Verified path |
|---|---|---|
| Local Docker | PostgreSQL 17 | Offline fixtures, repeated refresh, permissions, API, large synthetic graph, restore |
| SAP BTP CF | PostgreSQL `free` | TLS, separate runtime roles, live HTTPS SAP collection, ARC MCP |
| SAP BTP CF | HANA Cloud `hana-free` | TLS, separate runtime users, transaction/lock tests, live HTTPS collection, ARC MCP |

**Stop before provisioning** if the metadata audience is restricted, private-only CF routing is
required, the free plan is absent, or your only SAP connection is Cloud Connector/principal
propagation. The current collector rejects those SAP transports. Do not open an on-premise SAP
system to the Internet as a workaround. Local collection from an already authorized HTTPS
endpoint is an alternative; graph retrieval itself does not need a SAP connection.

## 1. Local Docker: first useful result

Needs Node >=22.19, Docker with Compose v2, approximately 4 GiB available RAM and several GiB
free disk for build images, graph data, WAL and restore scratch space. No SAP/BTP account is
needed for this step. From a checked-out ARC revision:

```sh
cd services/repository-graph
npm ci
# Optional, but choose these BEFORE setup if another graph already uses port 8091:
export COMPOSE_PROJECT_NAME=arc1-graph-test
export ARC_GRAPH_HOST_PORT=8093
export ARC_GRAPH_SECRET_DIR=.secrets/local-test
npm run graph:setup
npm run graph:test:offline
```

Use a private directory excluded from Git (`.secrets/` and its children are already excluded).
For other custom directories, add a local Git exclude rule first. The ARC connection file is
`<ARC_GRAPH_SECRET_DIR>/arc1-graph-connection.json`; resolve it to an absolute path for ARC.
Setup prints no environment-derived private path or key. Keep these environment values for subsequent commands.
The test seeds an offline system `TRIAL-2023-001`; it must not be confused with a live SAP system.
Expected output includes passing v2 API, extraction/retention, snapshot and lease checks.

The API is bound to loopback only. PostgreSQL has no host port. API, collector and migration
containers receive reader, writer and admin secrets respectively. Querying does not call SAP.
Setup keeps original ARC credentials at `0600`. For Linux Compose it prepares separate `0444`
mount files inside `.secrets/.../docker-mounts/`, whose host directory is `0700`; other host users
cannot traverse that directory. Only explicitly granted files are mounted into each container.
Do not move these mount copies outside their private directory or mount the whole directory into
ARC. Re-run `graph:setup` with the original settings when upgrading an older local installation;
it preserves credentials and refuses mismatched copies. File-backed Compose secrets do not
support UID/mode remapping. [Docker secret mount behavior](https://docs.docker.com/reference/compose-file/services/#secrets).
For local ARC, set `ARC1_GRAPH_CONNECTION_FILE` to the generated absolute path, keep
`ARC1_GRAPH_TOOLS=false`, and follow [acceptance checks](repository-graph.md#verify-before-client-exposure).
Docker-host ARC containers need an adjusted descriptor using service DNS and read-only mounts;
the generated loopback descriptor is intended for ARC running on the host.

```sh
npm run graph:test:large             # Optional: 100,000 nodes / 1,000,000 observations
sh scripts/graph/test-restore.sh     # Temporary scratch DB, verifies counts + reader permissions
npm run graph:down                  # Preserves the database volume and private credentials
```

Do not use `down -v`, remove secrets, or rerun setup with different settings against the same
volume as troubleshooting. PostgreSQL initialization secrets only apply to a new volume.
The restore rehearsal deletes its own temporary dump/database, not your graph. It is a local
logical-restore test, **not** proof of BTP managed-service disaster recovery.

## 2. BTP: prerequisites and resource budget

Needs logged-in `cf` and `btp` CLIs, the intended org/space and subaccount UUID, permission to
manage apps/bindings/tasks, and one selected free database. No extra end-user SAP role is needed.
The collector uses an administrator-approved, read-only technical SAP identity; this is distinct
from end-user principal propagation in ARC. Do not put database or collector credentials in ARC.

Before any command that changes CF, inspect `cf target`, `cf apps`, `cf services`, and `cf routes`.
Choose a unique prefix and HTTPS route; do not adopt another app/service merely because its name
matches an example. Reuse a database only when its owner approves the dedicated graph schema.
The current bootstrap uses fixed graph schema/user names: one installation per selected database.

| Process | Running memory | Disk | Route / permissions |
|---|---|---|---|
| Query API | 256 MiB | 1 GiB | One authenticated HTTPS route; DB reader + graph API key |
| Collector task | 512 MiB | 1 GiB | No route; DB writer + selected Destination binding |
| Bootstrap task | 256 MiB | 1 GiB | No route; temporary admin/owner credentials |
| Existing ARC | Unchanged | Unchanged | Only graph connection binding; no DB driver |

Allow **1,024 MiB additional staging memory** and 4 GiB staging disk; this CF foundation clamps
smaller staging requests upward. Stage one app at a time. A stopped task app has no running web
process; its tasks still consume quota. In the tested org the ceiling was 4,096 MiB and ten routes.
If the check fails, wait for tasks/builds or stop only operator-owned test apps; never upgrade or
stop unrelated apps automatically. Snapshot checks cannot reserve quota against other admins.
The tested classic buildpack selected Node 24.18.0 on `cflinuxfs4`. CF now warns that this stack
is deprecated (new pushes end April 2027); plan and test a stack migration before that deadline.

From `services/repository-graph/`, prepare non-secret operator settings by copying/editing
`btp-settings.example.json` and `deployment.vars.example.yaml` outside the tracked examples.
The URL, system key, audience and prefix must match; include the SAP client in the system key.
Set these shell variables to your reviewed values/absolute file paths:

```sh
export SUBACCOUNT=YOUR_SUBACCOUNT_UUID
export DATABASE=YOUR_SELECTED_DATABASE
export PREFIX=YOUR_UNIQUE_PREFIX
export SETTINGS=/absolute/private/btp-settings.json
export VARS=/absolute/private/deployment.vars.yaml
npm ci
npm run graph:package:cf
```

The generated `.graph-cf/` is an allowlisted artifact: no `.env`, service keys, source downloads
or private directories. Never `cf push` the whole ARC checkout for a backend deployment.

## 3A. PostgreSQL free

Choose this section **or HANA**, not both for a normal installation. Confirm `free` exists in
`cf marketplace -e postgresql-db`; if absent, stop. Only for an explicitly approved new database:

```sh
cf create-service postgresql-db free "$DATABASE"
cf service "$DATABASE"             # Wait for create succeeded
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 0 0
```

For an existing selected database start at preflight. The helper verifies the targeted CF
environment is free and the selected database is `postgresql-db/free`, not a similarly named
paid plan. It never provisions or upgrades anything. Create a dedicated bootstrap service key
only if it does not exist; use that exact name as `databaseKey` in your settings:

```sh
cf create-service-key "$DATABASE" YOUR_BOOTSTRAP_KEY_NAME
node scripts/graph/prepare-btp-postgres.mjs "$SETTINGS" /absolute/private/new-pg-credentials
export CREDS=/absolute/private/new-pg-credentials
export MANIFEST=deployment.cf.example.yaml
```

The output directory must be new, with an existing canonical parent. Files are owner-only;
runtime files contain dedicated passwords, never the broker's admin password. Preserve them for
reruns; generating different passwords against existing roles deliberately fails verification.

Create the following UPS instances **once**, after checking names/ownership:

```sh
cf create-user-provided-service "$PREFIX-bootstrap-auth" -p "$CREDS/bootstrap-auth.json"
cf create-user-provided-service "$PREFIX-reader" -p "$CREDS/reader.json"
cf create-user-provided-service "$PREFIX-writer" -p "$CREDS/writer.json"
cf create-user-provided-service "$PREFIX-api-auth" -p "$CREDS/api-auth.json"
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 1024 0
cf push "$PREFIX-bootstrap" --task -f "$MANIFEST" --vars-file "$VARS"
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 256 0
cf run-task "$PREFIX-bootstrap" --name graph-bootstrap --command 'node dist/graph/cloud-bootstrap.js' -m 256M -k 1G
cf tasks "$PREFIX-bootstrap"
```

Wait for **SUCCEEDED**, not merely task creation. The bootstrap verifies TLS and reader/writer
privileges. On failure inspect its sanitized stage/code, retain credentials, and correct the
cause; do not replace the database. Then remove privileged bindings from the stopped task app:

```sh
cf unbind-service "$PREFIX-bootstrap" "$DATABASE"
cf unbind-service "$PREFIX-bootstrap" "$PREFIX-bootstrap-auth"
```

Remove those bindings from any retained bootstrap deployment configuration before a routine
redeploy. Bootstrap is a deliberate maintenance step, never part of normal API startup.
Continue at [deploy and collect](#4-deploy-the-api-and-collect).

## 3B. HANA Cloud free

Confirm `hana-free` in `cf marketplace -e hana-cloud`. A service entry or old HDI container
does not prove the database exists: verify the actual instance in HANA Cloud Central and SQL
readiness. Keep stale unrelated records untouched. The following is only for a **new approved**
free database; it generates a new admin password without displaying it:

```sh
export HANA_CREDS=/absolute/private/new-hana-credentials
node scripts/graph/prepare-hana-free.mjs "$HANA_CREDS"
cf create-service hana-cloud hana-free "$DATABASE" -c "$HANA_CREDS/parameters.json"
cf service "$DATABASE"             # Wait for create succeeded; provisioning takes minutes
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 0 0
```

Read the SQL hostname from HANA Cloud Central (not the Central browser hostname). Do not infer it
from a stale binding. The new instance uses 16 GiB memory; the tested broker reported 80 GiB
storage. `whitelistIPs: []` permits regional BTP CF access, not arbitrary Internet SQL access.
Keep certificate verification enabled. [SAP HANA allowlist semantics](https://help.sap.com/docs/HANA_CLOUD/9ae9104a46f74a6583ce5182e7fb20cb/e91fabd91d384af99faa7f54c3041ca0.html).

```sh
node scripts/graph/prepare-hana-bootstrap.mjs "$HANA_CREDS" YOUR_ACTUAL_SQL_HOSTNAME
node scripts/graph/prepare-hana-users.mjs "$HANA_CREDS"
node scripts/graph/prepare-graph-auth.mjs "$SETTINGS" /absolute/private/new-graph-auth
export CREDS=/absolute/private/new-graph-auth
export MANIFEST=deployment.hana.cf.example.yaml
cf create-user-provided-service "$PREFIX-bootstrap-auth" -p "$HANA_CREDS/provision-binding.json"
cf create-user-provided-service "$PREFIX-reader" -p "$HANA_CREDS/reader-binding.json"
cf create-user-provided-service "$PREFIX-writer" -p "$HANA_CREDS/writer-binding.json"
cf create-user-provided-service "$PREFIX-api-auth" -p "$CREDS/api-auth.json"
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 1024 0
cf push "$PREFIX-bootstrap" --task -f "$MANIFEST" --vars-file "$VARS"
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 256 0
cf run-task "$PREFIX-bootstrap" --name graph-bootstrap --command 'node dist/graph/hana-bootstrap.js' -m 256M -k 1G
cf tasks "$PREFIX-bootstrap"
```

The task creates `ARC_GRAPH` with owner, reader and writer users. Wait for **SUCCEEDED**, then:

```sh
cf unbind-service "$PREFIX-bootstrap" "$PREFIX-bootstrap-auth"
cf unset-env "$PREFIX-bootstrap" ARC_GRAPH_HANA_BOOTSTRAP
```

Keep the admin/owner credentials in your approved private secret store, never bound to API,
collector or ARC. A later bootstrap push restores manifest bindings, so treat it as privileged
maintenance. Existing HANA users/schema are never silently adopted or password-reset. For an
existing database use an admin-reviewed binding matching `bootstrap-binding.json`'s shape;
do not run the new-instance password generator and assume it changes an existing database.
Partial DDL creation requires owner review; do not drop the schema as a retry.

The API uses HANA SQL with bounded traversal. A native property-graph workspace was also proven
possible, but native graph acceleration and vectors are **not** part of this installation.

## 4. Deploy the API and collect

After either database bootstrap, the API and collector use only their runtime roles. Recheck
free capacity before **each** push/task; use route reservation `0` if reusing your existing route,
`1` for a new route. Choose and verify the route in `VARS` before exposing the service.

```sh
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 1024 1
cf push "$PREFIX-api" -f "$MANIFEST" --vars-file "$VARS"
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 1024 0
cf push "$PREFIX-collector" --task -f "$MANIFEST" --vars-file "$VARS"
node scripts/graph/preflight-btp.mjs "$SUBACCOUNT" "$DATABASE" 512 0
cf run-task "$PREFIX-collector" --name graph-collect --command 'node dist/graph/cli.js collect-live-source' -m 512M -k 1G
cf tasks "$PREFIX-collector"
```

Collector requirements: an explicitly selected Destination service binding, HTTPS Internet
destination with an approved technical identity, TLS verification, an explicit system/client,
and a narrow package/query scope. Start with 150 objects/concurrency 1 as in the manifest.
`collect-live-metadata` avoids source reads but yields primarily object/package membership.
`collect-live-source` transiently parses active CLAS/INTF/PROG/DDLS; no source body is stored.
No SAP mutation, free SQL query or AI Core is used by the collector.

This is **manual refresh**, not an automatic scheduler. Maximum 500 objects/run, 1–5 SAP
concurrency, 1 MiB/source and 5 seconds/parser. Supported-type fallback searches reduce starvation,
but capped discovery remains partial. Empty/failed sources and macros can lower coverage; retain
those warnings. Missing objects are not automatically deleted. No durable resume or unchanged-source
ETag skip is claimed. Do not describe a successful job as complete whole-system coverage.

The public `/healthz` checks only the process. Database `/readyz` and all queries require the graph
key. An empty index is not useful readiness: inspect a known non-empty relationship after collection.
API and collector are separate apps because CF tasks inherit their parent app's bindings.

## 5. Connect ARC, without exposing tools yet

The generated `connection.json` contains only API origin/key and declared identity. Create one
UPS instance from that private file, bind it to your observed ARC app, and persist the binding
and settings in ARC's existing deployment configuration:

```sh
cf create-user-provided-service "$PREFIX-connection" -p "$CREDS/connection.json"
cf bind-service "$ARC1_APP" "$PREFIX-connection"
```

Set `ARC1_GRAPH_SERVICE_BINDING` to that exact connection service and `ARC1_GRAPH_TOOLS=false`.
For MTA-managed ARC, add an **existing-service** resource and a module requirement in the
operator-owned MTA descriptor, retaining all existing requirements/properties:

```yaml
# Merge these entries into the operator-owned descriptor; this is not a replacement MTA.
resources:
  - name: repository-graph-connection
    type: org.cloudfoundry.existing-service
    parameters:
      service-name: YOUR_PREFIX-connection
modules:
  - name: arc1-mcp-server
    requires:
      - name: repository-graph-connection
    properties:
      ARC1_GRAPH_SERVICE_BINDING: YOUR_PREFIX-connection
      ARC1_GRAPH_TOOLS: "false"
```

A `.mtaext` property alone does not bind a service. Validate the composed descriptor using the
existing ARC BTP workflow; the example must not erase XSUAA/Destination/Connectivity requirements.
Do not add graph requirements to the shared default `mta.yaml` for installations that opt out.
For plain CF deployments keep the same entries in your owned manifest. Restart ARC according to
its deployment workflow, then complete [CLI/MCP acceptance](repository-graph.md#verify-before-client-exposure).

## 6. Operations, rotation and recovery

- **API-key rotation:** prepare a new private key; change the query app's auth UPS to
  `{"apiKeys":["OLD_KEY_FROM_PRIVATE_STORE","NEW_KEY_FROM_PRIVATE_STORE"]}` using a private JSON
  file (`cf update-user-provided-service ... -p FILE`), then restart the query app. Update ARC's
  connection UPS to the new `apiKey` and restart ARC. Verify a known query, then remove the old
  key from the API auth UPS and restart again. Keep overlap until verification; rollback ARC to
  the old key while overlap exists. Never put literal real keys in argv, docs or tickets.
  At most two keys are allowed. Binding credentials are read at process start.
- **Database credentials:** separate lifecycle from API keys. Rotate using the database's user
  administration and matching private reader/writer bindings; verify each role before removing
  the old account. Automatic DB-password rotation is not implemented. Never use DBADMIN to
  restore service while a reader credential is wrong.
- **PG export/restore:** use provider-approved `pg_dump`/`pg_restore` access with private password
  files/secret injection and encrypted durable backup storage. Stop the collector for a stable
  comparison. Restore to a separate database; verify schema version, counts, reader/writer
  permissions, scope, coverage and known paths before switching any binding. Preserve the old
  database until validation. The local rehearsal is tested; managed BTP restore remains an
  operator exercise and cannot be promised by these scripts.
- **HANA free:** nightly stops require starting the existing instance in HANA Cloud Central.
  Verify SQL readiness before restarting apps. Do not create a replacement for a stopped
  instance. Free-instance backup/restore is not a production recovery promise; retain configuration
  and rebuild the bounded metadata scope if needed, accounting for SAP load.
- **Rollback:** retain the previous compatible app artifact and private bindings. Schema 1 is
  supported; future schema changes need forward migration/compatibility testing. Do not apply
  destructive down-migrations automatically. Stop collection first if publication fails.
- **Disable:** `ARC1_GRAPH=off` plus ARC restart disables only ARC integration. Stop the separate
  collector/API explicitly if desired; preserve databases/volumes/credentials. No cleanup command
  here deletes managed services or unrelated resources.

PostgreSQL free is time-limited (90 active days, then a 30-day backup/migration period); record
an owner and export deadline at creation. HANA free can be deleted after 30 inactive days and
stops nightly. No paid fallback, scheduled upgrade or automatic reminder is configured.
[SAP PostgreSQL free lifecycle](https://help.sap.com/docs/PostgreSQL/b3fe3621fa4a4ed28d7bbe3d6d88f036/715c7b8c813c4e24ba49f758e468846e.html),
[SAP HANA free restrictions](https://help.sap.com/docs/hana-cloud/sap-hana-cloud-administration-guide/sap-hana-database-license).

## 7. What the results do not prove

The recorded tests establish experimental PostgreSQL/HANA API parity and real bounded collection,
not production readiness, complete SAP dependency accuracy, cloud backup guarantees, full-system
search performance, native graph acceleration or embedding/vector usefulness. See the
[evidence and remaining gates](repository-graph-specification.md#2-evidence-baseline-and-limits).
