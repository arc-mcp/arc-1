# SAP ABAP Platform Trial 2023 — Self-Hosted Setup Guide

This document describes how to run the SAP ABAP Platform Trial 2023 Docker
container on a Linux server (e.g. Hetzner Cloud), configure it for ADT access,
connect it to SAP BTP via Cloud Connector, wire up the integration test
suite and GitHub Actions CI, and use it as a principal propagation backend.

> **Security note:** This guide intentionally omits the server IP/hostname.
> Never commit connection URLs, credentials, or license keys to the repository.

---

## Architecture

```
Internet
    │
    │  HTTPS :443          HTTPS :8443
    ▼                      ▼
┌─────────────────────────────────────────────────────┐
│  Linux host (Hetzner Cloud)                         │
│                                                     │
│  nginx (reverse proxy + TLS termination)            │
│  ├── :443  → localhost:50000  (ABAP ICM HTTP)       │
│  └── :8443 → 172.17.0.2:8443 (CC admin, SSL pass)  │
│                                                     │
│  Docker container "a4h"  (172.17.0.2)              │
│  ├── SAP ABAP Platform Trial 2023                   │
│  │   └── ICM listening on :50000 (HTTP)             │
│  └── SAP Cloud Connector 2.18                       │
│      └── Tomcat listening on :8443 (HTTPS)          │
│          └── outbound tunnel → BTP Connectivity     │
└─────────────────────────────────────────────────────┘
    │
    │  Outbound HTTPS (tunnel to BTP)
    ▼
┌──────────────────────────────┐
│  SAP BTP (us10)              │
│  ├── Connectivity Service    │
│  ├── Destination Service     │
│  └── Subaccount "dev"        │
└──────────────────────────────┘
```

**Traffic flows:**

| Use case | Path |
|----------|------|
| ADT / integration tests | `https://<host>` → nginx:443 → ABAP:50000 |
| CC admin panel | `https://<host>:8443` → nginx:8443 → CC:8443 |
| BTP → on-premises ABAP | BTP Connectivity → CC tunnel → `localhost:50000` |

The Cloud Connector is included in the `sapse/abap-cloud-developer-trial:2023`
image and runs as a separate Java process inside the same container.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Setup](#server-setup)
3. [SAP ABAP Trial Container](#sap-abap-trial-container)
   - [Pulling the Image](#pulling-the-image)
   - [Starting the Container](#starting-the-container)
   - [Disk Space Warning](#disk-space-warning)
4. [SAP System Configuration](#sap-system-configuration)
   - [License Installation](#license-installation)
   - [Work Process Tuning](#work-process-tuning)
   - [User Access](#user-access)
   - [Unlocking the DEVELOPER User](#unlocking-the-developer-user)
5. [HTTPS / Reverse Proxy Setup](#https-reverse-proxy-setup)
6. [Cloud Connector Setup](#cloud-connector-setup)
   - [Starting Cloud Connector](#starting-cloud-connector)
   - [Nginx HTTPS Proxy for CC Admin](#nginx-https-proxy-for-cc-admin)
   - [Initial CC Setup](#initial-cc-setup)
   - [Connecting CC to BTP](#connecting-cc-to-btp)
   - [Adding a System Mapping](#adding-a-system-mapping)
   - [Adding Resources](#adding-resources)
   - [Password Reset](#password-reset)
7. [Integration Tests](#integration-tests)
   - [Running Locally](#running-locally)
   - [Test Categories](#test-categories)
   - [Skipped Tests](#skipped-tests)
   - [Known Test Failures](#known-test-failures)
   - [Running a Specific Test](#running-a-specific-test)
8. [GitHub Actions CI](#github-actions-ci)
   - [Workflow Overview](#workflow-overview)
   - [GitHub Secrets Setup](#github-secrets-setup)
   - [CI-Specific Considerations](#ci-specific-considerations)
9. [Troubleshooting](#troubleshooting)
10. [Principal Propagation via Cloud Connector](#principal-propagation-via-cloud-connector)

---

## Prerequisites

- A Linux server with at least **16 GB RAM**, **4 CPU cores**, and **150 GB
  disk** (the SAP container image is ~80 GB compressed).
- Docker (or Podman) installed.
- Root or `sudo` access on the server.
- A DNS A record pointing a subdomain at the server IP (for HTTPS).
- A SAP license file for your hardware key (obtain from the SAP trial portal).

---

## Server Setup

### Install Docker

```bash
# Debian / Ubuntu
apt-get update
apt-get install -y docker.io
systemctl enable --now docker
```

### Verify disk space

The SAP image is large. Confirm there is sufficient space before pulling:

```bash
df -h /var/lib/docker
```

---

## SAP ABAP Trial Container

### Pulling the Image

The official SAP ABAP Cloud Developer Trial image is available from Docker Hub
under the `sapse` organisation:

```bash
docker pull sapse/abap-cloud-developer-trial:2023
```

> **Note:** `podman` can be used as a drop-in replacement. If you get a disk-
> full error from podman's `/var/tmp` overlay, ensure the underlying partition
> has enough space or reconfigure the podman storage driver.

### Starting the Container

```bash
docker run -d \
  --name a4h \
  --hostname vhcala4hci \
  -p 50000:50000 \
  -p 50001:50001 \
  -p 8443:8443 \
  -p 30213:30213 \
  --sysctl net.ipv4.ip_local_port_range="40000 60999" \
  --sysctl kernel.shmmax=21474836480 \
  --sysctl kernel.shmmni=32768 \
  --sysctl kernel.shmall=5242880 \
  -v /data/sap/sysvol:/sysvol \
  sapse/abap-cloud-developer-trial:2023
```

Key parameters:

| Parameter | Purpose |
|-----------|---------|
| `--hostname vhcala4hci` | SAP requires a specific hostname |
| `-p 50000:50000` | SAP ICM HTTP port (ADT, browser access) |
| `-p 50001:50001` | SAP ICM HTTPS port |
| `-p 8443:8443` | Alternative HTTPS |
| `-p 30213:30213` | HANA SQL port (multitenant tenant DB) |
| `--sysctl ...` | Required kernel parameters for SAP/HANA |
| `-v /data/sap/sysvol:/sysvol` | Persistent volume for SAP data |

### Disk Space Warning

If you see:
```
Error: copying file write /var/tmp/podman934593548: no space left on device
```
This means the partition hosting `/var/tmp` or the podman overlay is full.
Either free space or move Docker/Podman storage to a larger partition.

### Verifying the Container is Up

The SAP system takes 5-10 minutes to fully start. Check readiness:

```bash
# Watch SAP startup progress
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function GetProcessList

# Quick HTTP ping (expects 403 when SAP is up)
curl -s -o /dev/null -w "%{http_code}" http://localhost:50000/sap/bc/ping
```

SAP is ready when `sapcontrol GetProcessList` shows all processes as **Running**.

---

## SAP System Configuration

### License Installation

The trial image ships without a permanent license. Obtain a permanent license
from the SAP trial portal for your hardware key.

**Find your hardware key:**

```bash
docker exec a4h /usr/sap/A4H/SYS/exe/run/saplikey \
  pf=/usr/sap/A4H/SYS/profile/A4H_D00_vhcala4hci \
  -get
```

Note the `Hardware Key` from the output and request a license file from the
SAP trial portal.

**Install the license:**

```bash
# Copy license file into container
docker cp /path/to/A4H_license.txt a4h:/tmp/A4H_license.txt

# Install all keys from the file
docker exec a4h /usr/sap/A4H/SYS/exe/run/saplikey \
  pf=/usr/sap/A4H/SYS/profile/A4H_D00_vhcala4hci \
  -install /tmp/A4H_license.txt

# Verify installation
docker exec a4h /usr/sap/A4H/SYS/exe/run/saplikey \
  pf=/usr/sap/A4H/SYS/profile/A4H_D00_vhcala4hci \
  -get
```

The correct profile path inside the container is:
```
/usr/sap/A4H/SYS/profile/A4H_D00_vhcala4hci
```

> **Common mistake:** The profile is `A4H_D00_vhcala4hci`, not
> `A4H_DVEBMGS00_vhcala4hci`. List `ls /usr/sap/A4H/SYS/profile/` to confirm
> the correct filename if `saplikey` reports a missing profile error.

### Work Process Tuning

The trial profile used for this setup allocated **7 dialog work processes**. Check
your actual profile and available RAM before changing it. The integration suite now
runs files sequentially by default. If work-process monitoring shows sustained
exhaustion, reduce concurrency first; the following **lab-specific example** raises
the capacity to 25 dialog processes and requires sufficient memory:

**Edit the instance profile inside the container:**

```bash
docker exec -it a4h bash
vi /usr/sap/A4H/SYS/profile/A4H_D00_vhcala4hci
```

Change:
```
rdisp/wp_no_dia = 7
```
To:
```
rdisp/wp_no_dia = 25
rdisp/wp_no_btc = 5
rdisp/wp_no_vb  = 1
```

### Session Timeout Tuning

ADT lock/write operations use stateful sessions. Abandoned sessions can retain
backend resources, but a work process in **PRIV** mode is not by itself proof of a
leak. Current ARC-1 closes stateful sessions after operations; investigate persistent
session growth before changing SAP timeouts.

These are historical trial-lab tuning values, **not prerequisites for the current
test suite**. Review them with the SAP administrator before applying them:

```
# Aggressive session cleanup for CI / remote ADT clients
rdisp/plugin_auto_logout = 120
rdisp/max_wprun_time = 300
icm/keep_alive_timeout = 60
http/security_session_timeout = 120
```

| Parameter | Value | Effect |
|-----------|-------|--------|
| `rdisp/plugin_auto_logout` | 120 | Auto-logout idle HTTP plugin sessions after 2 min |
| `rdisp/max_wprun_time` | 300 | Max runtime for a single dialog step (5 min) |
| `icm/keep_alive_timeout` | 60 | Close idle HTTP keep-alive connections after 1 min |
| `http/security_session_timeout` | 120 | HTTP security session timeout (2 min) |

These parameters control different things: HTTP connection keep-alive and dialog
step runtime do not replace stateful-session cleanup. Short timeouts can interrupt
legitimate operations. Change only a setting tied to the observed problem.

**Restart the ABAP application server (not the whole container):**

```bash
# Stop ABAP only
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function Stop
# Wait ~60s for full stop
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function Start
```

> **Note:** `RestartInstance` did not work reliably; use explicit `Stop` then
> `Start`.

### Writes fail with 423 "invalid lock handle" (NW < 7.51)

**Symptom:** reads work, but every `SAPWrite` / `edit_method` / delete / activate-after-edit
fails with:

```
status 423 ... Resource ... is not locked (invalid lock handle: ...)
type id="ExceptionResourceInvalidLockHandle"
```

The LOCK appears to succeed (it returns a handle), but the very next PUT is rejected.
SM12 shows no lock, because the lock was released the instant the PUT failed.

**Root cause:** ADT writes require a *stateful* HTTP session so the ENQUEUE lock from
LOCK survives until the PUT. ARC-1 sends the `X-sap-adt-sessiontype: stateful` header
correctly — but on **SAP_BASIS < 7.51** the ADT REST handler `CL_REST_HTTP_HANDLER`
silently ignores it (the mechanism that honors it, `CONFIGURE_SESSION_STATE` in
`CL_ADT_WB_RES_APP`, only exists from 7.51). So the session reverts to stateless and the
lock handle is invalid on the PUT. Eclipse is unaffected because it talks ADT over RFC,
which is stateful by default. S/4HANA (≥ 7.51) works natively.

> **SAP Note 2727890 is NOT the fix.** It addresses a separate, narrow bug (lock handles
> containing `+` characters). Systems with the note applied on 7.40/7.50 still fail here.

**Fix — install the `abapfs_extensions` enhancement** on the SAP system. It back-ports the
7.51 stateful-session handling to `CL_REST_HTTP_HANDLER`. It's a single implicit
enhancement, needs no ICM restart, and is a safe no-op on ≥ 7.51.

**Option A — abapGit (preferred, if abapGit is installed):**
Import [`marcellourbani/abapfs_extensions`](https://github.com/marcellourbani/abapfs_extensions)
into the dev system (online clone, or offline ZIP upload via `ZABAPGIT_STANDALONE`), then
activate the imported objects.

**Option B — manual (no abapGit, e.g. the NPL trial), via SE24:**
1. `SE24` → class `CL_REST_HTTP_HANDLER` → Display.
2. Double-click method `IF_HTTP_EXTENSION~HANDLE_REQUEST`.
3. Click **Enhance** (the spanner), then **Edit → Enhancement Operations → Show Implicit
   Enhancement Options** so the method-begin marker appears.
4. Position the cursor on the marker at the **start of the method body** (right after
   `METHOD ...`), then **Create** an enhancement implementation named
   `ZABAPFILESYSTEM_SESSION`.
5. Paste this into the `ENHANCEMENT ... ENDENHANCEMENT` block:

   ```abap
   "Stateful mode support (compatible with implementation in 7.51)
   "required for write support over HTTP (ADT clients)
   DATA: __abapfs_stateful TYPE string.
   __abapfs_stateful = server->request->get_header_field( 'X-sap-adt-sessiontype' ).
   IF __abapfs_stateful = 'stateful'.
     gv_stateful = abap_true.
   ELSEIF __abapfs_stateful = 'stateless'.
     gv_stateful = abap_false.
   ENDIF.
   ```
6. Assign to package `$TMP` (or a transportable package) and **activate** (Ctrl+F3).

After activation, retry the write — the next ADT request picks up the enhanced handler.

> ARC-1 also detects this at startup: when writes are enabled on a < 7.51 system it logs a
> warning pointing here, and the `423` error hint names `abapfs_extensions` directly.

### User Access

The trial system ships with these pre-configured users:

| User | Default Password | Role |
|------|-----------------|------|
| `DEVELOPER` | `ABAPtr2023#00` | ABAP developer (S_DEVELOP auth) |
| `DDIC` | `ABAPtr2023#00` | Data dictionary admin |
| `BWDEVELOPER` | `ABAPtr2023#00` | BW developer |

**Use `DEVELOPER` for ADT and integration tests.** `DDIC` does not have the
`S_DEVELOP` authorization object required to create/edit ABAP objects via ADT.

### Unlocking the DEVELOPER User

Repeated failed logins can lock `DEVELOPER`, but an HTTP 401 alone does not prove
that this is the cause. Have an administrator check the user in **SU01 in client
001** and unlock it there. If a password change is required, complete it through
SAP's interactive logon before configuring ARC-1 with the new password.

Do not update `USR02` directly in HANA to unlock a user. Use SAP user administration
so client selection, lock state, and password rules are handled together.

---

## HTTPS / Reverse Proxy Setup

Expose the SAP system over HTTPS via Nginx and Let's Encrypt.

### Install Nginx and Certbot

```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

### Configure Nginx Reverse Proxy

Create `/etc/nginx/sites-available/<your-subdomain>`:

```nginx
server {
    listen 80;
    server_name <your-subdomain>;

    location / {
        proxy_pass         http://localhost:50000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 50m;
    }
}
```

Enable the site:

```bash
ln -s /etc/nginx/sites-available/<your-subdomain> /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### Obtain Let's Encrypt Certificate

```bash
certbot --nginx -d <your-subdomain>
```

Certbot will automatically update the Nginx config with SSL settings and set
up auto-renewal via a systemd timer.

> **DNS propagation:** Run certbot only after the DNS A record has propagated
> (verify with `dig <your-subdomain>`). Let's Encrypt will fail with a challenge
> error if the record hasn't propagated yet.

---

## Cloud Connector Setup

SAP Cloud Connector (CC) is bundled with the `sapse/abap-cloud-developer-trial:2023`
image. It allows BTP services (Connectivity, Destination) to reach the
on-premises ABAP system through an outbound tunnel — no inbound firewall rules
needed.

### Starting Cloud Connector

CC is not started automatically when the Docker container boots. Start it once
after the container is up:

```bash
docker exec a4h bash -c "rcscc_daemon start"
```

CC logs to `/opt/sap/scc/scc_daemon.log` inside the container and listens on
`https://vhcala4hci:8443` (the container's hostname). To verify it started:

```bash
docker exec a4h curl -sk https://localhost:8443/index.jsp | grep -i "title"
```

> **Note:** CC does not automatically restart when the container restarts.
> Add the `rcscc_daemon start` call to your container startup script or
> run it manually after each container restart.

### Nginx HTTPS Proxy for CC Admin

The CC admin UI is served over HTTPS with a self-signed certificate. Browsers
block XHR calls to self-signed certificates even after clicking "proceed", which
breaks the CC admin panel's JavaScript entirely.

The fix is an nginx HTTPS-to-HTTPS reverse proxy: nginx terminates TLS with the
trusted Let's Encrypt certificate and forwards requests to CC's self-signed
backend with `proxy_ssl_verify off`. The browser sees the trusted cert; CC
still handles authentication internally.

Add this server block to your nginx site config
(`/etc/nginx/sites-enabled/<your-subdomain>`):

```nginx
server {
    listen 8443 ssl;
    server_name <your-subdomain>;

    ssl_certificate     /etc/letsencrypt/live/<your-subdomain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-subdomain>/privkey.pem;

    location / {
        proxy_pass          https://172.17.0.2:8443;
        proxy_ssl_verify    off;
        proxy_set_header    Host              $http_host;
        proxy_set_header    X-Real-IP         $remote_addr;
        proxy_set_header    X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto https;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade           $http_upgrade;
        proxy_set_header    Connection        "";
        proxy_read_timeout  300s;
        proxy_connect_timeout 75s;
        proxy_buffer_size   128k;
        proxy_buffers       4 256k;
        proxy_busy_buffers_size 256k;
    }
}
```

Open port 8443 in the firewall:

```bash
ufw allow 8443/tcp
nginx -t && systemctl reload nginx
```

The CC admin panel is then accessible at `https://<your-subdomain>:8443`.

> **Why not TCP stream pass-through?** A plain TCP proxy (`stream` module)
> forwards CC's self-signed certificate directly to the browser.
> The browser accepts the initial page load after a manual "proceed" click,
> but blocks all subsequent XHR/fetch calls with `ERR_CERT_AUTHORITY_INVALID`.
> The HTTPS reverse proxy solves this completely.

### Initial CC Setup

On first access, CC shows an **Initial Setup** wizard.

1. Navigate to `https://<your-subdomain>:8443` and log in:
   - Username: `Administrator`
   - Password: `manage`
2. You will be prompted to change the password. Set a strong password and save it.
3. On the **Installation Type** screen, select **Master (Primary Installation)**.
4. Complete the wizard. CC saves `<haRole>master</haRole>` in its config.

> **If the wizard does not appear** (CC jumps directly to the dashboard), the
> initial setup was already completed in a previous session.

### Connecting CC to BTP

In the CC admin panel, go to **Define Subaccount → On-Premises to Cloud** and
click **+ Add Subaccount**.

**Step 1 — HTTPS Proxy:** Leave all fields empty (no proxy needed) and click
**Next**.

**Step 2 — BTP Subaccount details:**

| Field | Value |
|-------|-------|
| Region | `cf.us10-001.hana.ondemand.com` |
| Subaccount | Your BTP subaccount GUID (find it in the BTP Cockpit URL or via `btp list accounts/subaccount`) |
| Display Name | Any label, e.g. `dev` |
| Login | Your BTP user (e.g. S-User or email) |
| Password | Your BTP password |

Click **Next**, then **Finish**. CC will establish the outbound tunnel to BTP.
The status dot next to the subaccount turns green when the tunnel is active.

> **BTP Prerequisites:** The BTP subaccount must have the **Connectivity**
> entitlement assigned. The `connectivity/lite` service instance must exist
> in the subaccount before the tunnel can be established. Create it manually
> in the BTP Cockpit (Service Marketplace → Connectivity → Create with plan
> `lite`).

### Adding a System Mapping

Once the subaccount tunnel is active, map the on-premises ABAP system so BTP
can route requests to it.

In the CC admin panel, go to **Cloud to On-Premises** and click **+ Add**.
Walk through the wizard:

| Step | Field | Value |
|------|-------|-------|
| Protocol | Protocol | `HTTP` |
| Back-end Type | Back-end Type | `ABAP System` |
| Internal Host | Internal Host | `localhost` |
| Internal Host | Internal Port | `50000` |
| Virtual Host | Virtual Host | `a4h-abap` |
| Virtual Host | Virtual Port | `50000` |
| Host Header | Host in Request Header | `Use Internal Host` |

> **Virtual Host** is the name BTP uses to refer to this system in
> Destinations. **Internal Host** is the real address as seen from CC inside
> the container. Use `Use Internal Host` for the request header so the ABAP
> system sees `localhost:50000` in the `Host` header, which matches its ICM
> configuration.

Click **Finish**.

### Adding Resources

After saving the system mapping, CC shows it in the list with a warning that no
resources are accessible yet. Click the system mapping row, then click
**+ Add** under **Resources**.

| Field | Value |
|-------|-------|
| URL Path | `/` |
| Access Policy | `Path and all sub-paths` |
| Description | `All ADT/OData paths` |

Click **Save**. The system mapping is now fully configured.

> The `/` wildcard already includes FLP and UI5 OData routes used by ARC-1, including:
> - `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` (FLP launchpad management)
> - `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` (UI5 ABAP Repository)
>
> For production setups, prefer explicit path allowlists instead of `/` for tighter control.

### Password Reset

If the CC admin password is lost or the account is locked, reset it directly
in `users.xml` inside the container:

```bash
# Stop CC
docker exec a4h bash -c "rcscc_daemon stop"

# Compute SHA-256 of new password (replace "manage" with your desired password)
NEW_PASS=$(echo -n 'manage' | sha256sum | awk '{print $1}' | tr '[:lower:]' '[:upper:]')
echo "Hash: $NEW_PASS"

# Write users.xml with the new password
docker exec a4h bash -c "cat > /opt/sap/scc/config/users.xml << 'EOF'
<?xml version='1.0' encoding='utf-8'?>
<tomcat-users xmlns=\"http://tomcat.apache.org/xml\"
              xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"
              xsi:schemaLocation=\"http://tomcat.apache.org/xml tomcat-users.xsd\"
              version=\"1.0\">
  <role rolename=\"admin\"/>
  <group groupname=\"initial\" roles=\"\"/>
  <user username=\"Administrator\" password=\"$NEW_PASS\" groups=\"\" roles=\"admin\"/>
</tomcat-users>
EOF"

# Start CC again
docker exec a4h bash -c "rcscc_daemon start"
```

> **Important:** The `roles="admin"` attribute on the `<user>` element is
> required. If it is missing or set to `roles=""`, Tomcat returns HTTP 408
> on every login attempt. The `groups=""` attribute must also be empty
> (not `groups="initial"`) to avoid inheriting the group's empty role set.

If the CC initial setup needs to be reset as well (not just the password):

```bash
docker exec a4h bash -c "rcscc_daemon stop"
docker exec a4h rm -f /opt/sap/scc/scc_config/scc_config.ini \
                       /opt/sap/scc/scc_config/scc_config.stamp
docker exec a4h bash -c "rcscc_daemon start"
```

This forces the Initial Setup wizard to appear again on next login.

---

## Integration Tests

### Running Locally

The TypeScript/Vitest integration suite requires an authorized, disposable test
system. It performs writes and creates test objects; do not point it at production.
Set the credentials read by `tests/integration/helpers.ts`:

```bash
npm ci
export TEST_SAP_URL=https://your-sap-host
export TEST_SAP_USER=DEVELOPER
export TEST_SAP_PASSWORD='YOUR_CURRENT_PASSWORD'
export TEST_SAP_CLIENT=001

npm run test:integration
```

The tests create temporary objects, exercise supported ADT operations, and attempt
cleanup in test hooks. Check cleanup failures and remaining objects after an
interrupted run. Some suites need additional fixtures or explicit opt-ins.

### Test Categories

| Category | Source / command | Coverage |
|----------|------------------|----------|
| Read operations and diagnostics | `tests/integration/adt.integration.test.ts` | Discovery, source, metadata, search, diagnostics, and backend capability checks |
| CRUD lifecycle | `npm run test:integration:crud` | Create, read, update, activate, and delete supported object types |
| Context and cache | `tests/integration/context.integration.test.ts`, `cache.integration.test.ts` | Dependency context and source freshness |
| MCP end-to-end | `npm run test:e2e` | Tool calls through a running ARC-1 server; see [Local Development](local-development.md) for setup |
| Slow operations | `npm run test:integration:slow` | Explicit slow profile, separate from the default integration run |

### Skipped Tests

Skips depend on the target's release, fixtures, authorization, and opt-in settings.
Read each reason; a skipped test is not evidence that an operation works. Missing
required SAP credentials fail the main suite's setup.

See the [skip taxonomy](https://github.com/arc-mcp/arc-1/blob/main/docs/integration-test-skips.md)
and run `npm run test:integration:skip-summary` for a grouped report.

### Known Test Failures

Investigate failures against the current source and SAP response. A trial system's
missing feature can justify a classified skip; an unexpected 401, 403, 5xx, or
cleanup failure still needs diagnosis. Increasing work processes does not make
all tests valid on every SAP release.

### Running a Specific Test

Use Vitest's `-t` option with a current test name:

```bash
npm run test:integration -- tests/integration/adt.integration.test.ts -t 'gets installed components'
```

### Running the Default Test Profile

```bash
npm run test:integration
```

The default profile excludes `*.slow.integration.test.ts`. File execution is
sequential unless `TEST_FILE_PARALLELISM=true` opts into the capped parallel run.

---

## GitHub Actions CI

### Workflow Overview

The workflow is defined in `.github/workflows/test.yml`:

```
pull_request / workflow_dispatch
      │
      ├── mta-validate (Node 22)
      │     └── npm run btp:validate
      │
      ├── test (Node 22 + 24)
      │     ├── npm run lint
      │     ├── npm run typecheck
      │     ├── npm test
      │     └── npm run test:coverage            ← informational
      │
      ├── integration (Node 22, internal PR/manual dispatch)
      │     ├── authenticated ADT preflight using TEST_SAP_* secrets
      │     └── npm run test:integration
      │
      ├── e2e (Node 22, after integration)
      │     ├── authenticated ADT preflight using TEST_SAP_* secrets
      │     └── npm run test:e2e through a local ARC-1 server
      │
      └── reliability-summary
            └── npm run test:assert-execution
```

The live SAP jobs only run when:
- An internal pull request is opened/updated and the PR title is not gated off as `docs:` or `chore:`
- The workflow is manually dispatched

External fork PRs skip live SAP jobs because GitHub does not pass repository secrets to them.

### GitHub Secrets Setup

Integration and E2E tests read credentials from repository secrets named `TEST_SAP_*`.

**Set the required secrets:**

```bash
gh secret set TEST_SAP_URL      --repo <owner>/<repo> --body "https://<your-sap-host>"
gh secret set TEST_SAP_USER     --repo <owner>/<repo> --body "<sap-user>"
gh secret set TEST_SAP_PASSWORD --repo <owner>/<repo> --body "<sap-password>"
gh secret set TEST_SAP_CLIENT   --repo <owner>/<repo> --body "001"
```

Set `TEST_SAP_INSECURE=true` as a repository secret only when the trial system uses a self-signed certificate.

**Verify:**

```bash
gh secret list --repo <owner>/<repo>
```

**Trigger a manual run:**

```bash
gh workflow run test.yml --repo <owner>/<repo>
```

### CI-Specific Considerations

**Runtime and dependency cache:** This is a Node.js/TypeScript project. The workflow
uses `actions/setup-node` and `npm ci`; there is no Go toolchain or Go module cache.

**Test timeouts:** The default integration config allows 30 seconds per test and
60 seconds per hook. Individual suites can override these. Slow tests have a
separate profile and manually triggered `sap-slow-tests.yml` workflow.

**SAP capacity:** Live CI jobs coordinate access to the shared target. Local runs
still compete for SAP resources, so avoid overlapping them with CI on a small trial
system. Investigate session growth and 503 responses before increasing capacity or
shortening timeouts.

---

## Troubleshooting

### SAP returns 401 on ADT but 403 on `/sap/bc/ping`

Check the password, client, user lock state, and ADT authorizations. These two
HTTP status codes do not establish that the password is correct or the user is
locked. Check [user access in SU01](#unlocking-the-developer-user).

### Integration tests fail with 503 mid-run

A 503 can originate in SAP or an upstream proxy. Check the failing response and
server logs, then inspect work-process and session usage. If capacity is exhausted,
stop overlapping runs and reduce concurrency before considering
[Work Process Tuning](#work-process-tuning).

To diagnose, check the work process table:

```bash
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function ABAPGetWPTable
```

If most DIA work processes are occupied, check their users, running tasks, and
sessions in SAP. `PRIV` alone does not establish that a session is stale.

### `saplikey: profile not found`

List the actual profile files:

```bash
ls /usr/sap/A4H/SYS/profile/
```

Use the `A4H_D00_vhcala4hci` file, not `A4H_DVEBMGS00_vhcala4hci`.

### HANA SYSTEM password unknown

Use the `a4hadm` userstore key instead. It connects as `SAPA4H` (the ABAP
schema owner) without needing the SYSTEM password:

```bash
su - a4hadm
hdbsql -U DEFAULT -d HDB
```

### Build fails: TypeScript compilation errors

If you see TypeScript errors during `npm run build`, ensure all dependencies
are installed with `npm ci` and you're using Node.js 22.19 or newer.

### DDIC user returns 403 on CRUD operations

```
ExceptionResourceNoAuthorization: DDIC is currently editing ZMCP_XXXXX
```

The `DDIC` user does not have the `S_DEVELOP` authorization object. Use the
`DEVELOPER` user for all ADT and integration test operations. See
[User Access](#user-access).

### RAP E2E test fails with "does already exist"

```
Resource Service Binding ZTEST_MCP_SB_FLIGHT does already exist
```

A previous run may have left the SRVB behind. Confirm it belongs to the disposable
test run before removing it through ADT or the test cleanup tooling. Do not assume
that every current suite adopts an existing object automatically.

### RAP E2E test fails with 500 on GetSRVB after publish

```
status 500 at /sap/bc/adt/businessservices/bindings/ZTEST_MCP_SB_FLIGHT
```

SAP can return HTTP 500 after a publish request, including after the backend has
persisted a change. Inspect the binding and publication state before retrying. An
error response is not proof of either successful publication or rollback; preserve
the response and check backend diagnostics if the state remains unclear.

### Container starts but SAP is not ready after 10 minutes

Check the container logs:

```bash
docker logs a4h --tail 100
```

Look for HANA startup errors. Common causes:
- Insufficient shared memory (`kernel.shmmax` sysctl not set)
- Disk full during HANA startup

### HTTPS certificate errors in integration tests

If using a self-signed cert or testing against HTTP, set:

```bash
export SAP_INSECURE=true
```

or use the plain HTTP URL (`http://server-ip:50000`). Let's Encrypt certificates
do not require `SAP_INSECURE`.

### Container fails to start after saving a profile in RZ10

Saving in RZ10 regenerates `DEFAULT.PFL` from the profile copy in the database, which still names
the image's build hosts. The dispatcher then stops with:

```
DpTriggerMsAttach: hostname 'vhcala4hcs' of parameter 'rdisp/mshost' unknown
```

Fix the file inside the container while it retries the start (`docker start a4h` first if it has
exited, then `docker exec -it a4h bash`):

```bash
P=/usr/sap/A4H/SYS/profile/DEFAULT.PFL
cp -p $P $P.bak-$(date +%Y%m%d%H%M%S)
sed -i -e 's/vhcala4hcs/vhcala4hci/g' -e 's/^SAPDBHOST = vhcalhdbdb/SAPDBHOST = vhcala4hci/' \
  -e '/^SAPFQDN = dummy.nodomain/d' -e '/^SAPLOCALHOSTFULL = /d' $P
```

Then restart the container (`docker stop -t 7200 a4h && docker start a4h`). With principal
propagation, repeat the [certificate install](#3-https-certificate-and-trust) afterwards.

Change profiles by editing the files directly, as in [Work Process Tuning](#work-process-tuning), or
use RZ11 for dynamic parameters (RZ11 changes last until the next restart).

---

<a id="certificate-based-sap-setup-for-cloud-connector-principal-propagation"></a>

## Principal Propagation via Cloud Connector

Use this trial as a principal propagation (PP) backend: each MCP user reaches SAP as their own SAP
user through BTP and the bundled Cloud Connector. The generic
[Principal Propagation Setup](principal-propagation-setup.md) explains every layer; this section
covers only the values and pitfalls specific to this container. It adds an HTTPS mapping next to
the HTTP mapping from [Adding a System Mapping](#adding-a-system-mapping).

### 1. Cloud Connector

Follow [Step 2 of the generic guide](principal-propagation-setup.md#step-2-configure-cloud-connector):
trust the subaccount identity provider, create the system and CA certificates, and set the subject
pattern `CN=${email}`. Then add a mapping under **Cloud to On-Premises**:

| Field | Value |
|-------|-------|
| Back-end Type / Protocol | `ABAP System` / `HTTPS` |
| Internal Host / Port | `localhost` / `50001` (Cloud Connector runs inside the container) |
| Virtual Host / Port | `a4h-abap` / `50001` |
| Principal Type | `X.509 Certificate`; leave **System Certificate for Logon** unchecked (`X509_RESTRICTED` in the Cloud Connector API) |
| Resource | `/sap/bc/adt`, **Path and all sub-paths** |

Download the system certificate and the CA certificate (**Configuration > On Premises**), convert
DER downloads with `openssl x509 -inform der -in scc-ca.der -out scc-ca.pem`, and combine both on
the host: `cat scc-system.pem scc-ca.pem > trust.pem`.

### 2. Profile parameters

Edit the profile files directly, as in [Work Process Tuning](#work-process-tuning). Do not save
profiles in RZ10 on this image: see
[Container fails to start after saving a profile in RZ10](#container-fails-to-start-after-saving-a-profile-in-rz10).

```ini
# /usr/sap/A4H/SYS/profile/A4H_D00_vhcala4hci: append VCLIENT=1 to the existing HTTPS entry
icm/server_port_1 = PROT=HTTPS, PORT=50001, ..., VCLIENT=1

# /usr/sap/A4H/SYS/profile/DEFAULT.PFL
login/certificate_mapping_rulebased = 1
icm/trusted_reverse_proxy_0 = SUBJECT="CN=scc-system, OU=IT, O=Example, C=XX", ISSUER="CN=scc-system, OU=IT, O=Example, C=XX"
```

`icm/trusted_reverse_proxy_0` takes the subject and issuer of the Cloud Connector **system**
certificate in SAP's DN form ([ICM parameters](principal-propagation-setup.md#icm-parameters)). A
self-signed system certificate has the same subject and issuer, as above. Restart the instance as
in [Session Timeout Tuning](#session-timeout-tuning).

### 3. HTTPS certificate and trust

The image's SSL server PSE holds a placeholder certificate for `*.dummy.nodomain`. Cloud Connector
checks the backend host name, so the mapping to `localhost` fails with HTTP 502
`Invalid server certificate` until ICM presents a certificate for `localhost`. Create it once on
the host and add `server.crt` to the Cloud Connector **Backend Trust Store**
(**Configuration > On Premises**):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost" -keyout server.key -out server.crt
openssl pkcs12 -export -inkey server.key -in server.crt -out server.p12 -passout 'pass:<p12-password>'
```

Install it, together with the Cloud Connector certificates, into the PSE:

```bash
docker cp server.p12 a4h:/tmp/server.p12
docker cp trust.pem a4h:/tmp/trust.pem
docker exec a4h chown a4hadm:sapsys /tmp/server.p12 /tmp/trust.pem

# As a4hadm: build the new PSE, back up the active one, replace it
docker exec -u a4hadm -e USER=a4hadm -e SECUDIR=/usr/sap/A4H/D00/sec a4h bash -c '
  set -e
  G=/usr/sap/A4H/D00/exe/sapgenpse
  rm -f /tmp/SAPSSLS.new.pse
  $G import_p12 -x "<pse-pin>" -z "<p12-password>" -p /tmp/SAPSSLS.new.pse /tmp/server.p12
  $G maintain_pk -m /tmp/trust.pem -y -x "<pse-pin>" -p /tmp/SAPSSLS.new.pse
  cp -p $SECUDIR/SAPSSLS.pse $SECUDIR/SAPSSLS.pse.bak-$(date +%Y%m%d%H%M%S)
  cp /tmp/SAPSSLS.new.pse $SECUDIR/SAPSSLS.pse
  $G seclogin -p $SECUDIR/SAPSSLS.pse -x "<pse-pin>" -O a4hadm'

# Restart only ICM so it loads the new PSE; the dispatcher starts it again within seconds
docker exec a4h bash -c 'kill $(pgrep -f "[i]cman" | head -1)'
```

Check what ICM serves and what the PSE trusts:

```bash
docker exec a4h bash -c 'echo | openssl s_client -connect localhost:50001 -servername localhost 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName'
docker exec -u a4hadm -e USER=a4hadm -e SECUDIR=/usr/sap/A4H/D00/sec a4h \
  /usr/sap/A4H/D00/exe/sapgenpse maintain_pk -l -p /usr/sap/A4H/D00/sec/SAPSSLS.pse
```

Expect `localhost` as subject and DNS SAN, and both Cloud Connector certificates in the list.

**Repeat the install after every SAP or container restart.** The container recreates the SSL
server PSE on restart, so ICM falls back to the placeholder and Cloud Connector fails again. Keep
`server.p12` and `trust.pem` on the host and re-run only the install block once SAP is up
([Verifying the Container is Up](#verifying-the-container-is-up)), for example from the script that
[starts Cloud Connector](#starting-cloud-connector); skip it when the check already shows
`localhost`. Do not re-run the `openssl` commands: a new certificate is not in the Backend Trust
Store. Avoid maintaining this PSE in STRUST afterwards: STRUST keeps its own database copy of the
PSE and can write it back over the file.

### 4. User mapping

In client `001`, create the CERTRULE rule and the SU01 e-mail addresses as in
[Certificate mapping](principal-propagation-setup.md#certificate-mapping-certrule-or-vusrextid).
If CERTRULE dumps with `STRING_OFFSET_TOO_LARGE`, table `USRCERTRULE` holds a corrupt rule. On a
disposable trial, delete the client's rules as `a4hadm` (`hdbsql -U DEFAULT -d HDB`):

```sql
DELETE FROM SAPA4H.USRCERTRULE WHERE CLIENT = '001';
```

Then restart the container (`docker stop -t 7200 a4h && docker start a4h`), repeat the
[certificate install](#3-https-certificate-and-trust), and create the rule again.

### 5. Destination and ARC-1

Create the destination as in
[Step 1 of the generic guide](principal-propagation-setup.md#step-1-create-the-btp-destination)
with URL `http://a4h-abap:50001`, proxy type `OnPremise`, authentication `PrincipalPropagation` and
`sap-client` `001`. For single-target `/mcp`, point the least-privileged Basic startup destination
at the HTTP mapping `http://a4h-abap:50000`. Then
[configure ARC-1](principal-propagation-setup.md#step-4-configure-arc-1) and
[test](principal-propagation-setup.md#step-5-test) one boundary at a time.
