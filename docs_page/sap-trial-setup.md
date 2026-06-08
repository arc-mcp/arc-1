# SAP ABAP Platform Trial 2023 — Self-Hosted Setup Guide

This document describes how to run the SAP ABAP Platform Trial 2023 Docker
container on a Linux server (e.g. Hetzner Cloud), configure it for ADT access,
connect it to SAP BTP via Cloud Connector, and wire up the integration test
suite and GitHub Actions CI.

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
5. [HTTPS / Reverse Proxy Setup](#https--reverse-proxy-setup)
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

The default SAP profile only allocates **7 dialog work processes**. Running the
full integration test suite (34 tests) exhausts these quickly and causes 503
errors. Increase them:

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

ADT CRUD operations open stateful sessions (locks) that hold a dialog work
process in **PRIV** (private) mode. If the client disconnects without explicitly
ending the session, the WP stays occupied until the timeout expires.

The default timeout is 600 seconds (10 minutes), which means 30+ integration
tests can exhaust all work processes before the first sessions expire.

**Add these parameters to the instance profile:**

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

Without these settings, stale PRIV sessions from failed or disconnected tests
accumulate and cause 503 errors for subsequent requests.

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

After many failed login attempts, the `DEVELOPER` user gets locked
(`UFLAG = 128` in `USR02`). This manifests as HTTP 401 from ADT endpoints even
though `/sap/bc/ping` returns 403 (ping uses a lighter auth check).

**Unlock via HANA SQL (no HANA SYSTEM password required):**

The `a4hadm` OS user has a pre-configured HANA userstore key that connects as
the ABAP schema owner (`SAPA4H`):

```bash
docker exec -it a4h bash
su - a4hadm

# Connect to the HANA tenant DB as SAPA4H
hdbsql -U DEFAULT -d HDB

# Unlock DEVELOPER
UPDATE SAPA4H.USR02 SET UFLAG = 0 WHERE BNAME = 'DEVELOPER';

# Verify
SELECT BNAME, UFLAG, PWDSTATE FROM SAPA4H.USR02
  WHERE BNAME IN ('DEVELOPER', 'DDIC');
\q
```

`UFLAG = 0` means unlocked. `UFLAG = 128` means locked by too many failed
logon attempts. `PWDSTATE = 1` means the user must change password on next
login (leave as-is; ADT handles this transparently).

> **Alternative:** If you have access to SAP GUI or ABAP Developer Tools,
> use transaction `SU01` to unlock users without direct HANA access.

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

The integration tests are gated by the `integration` build tag and require four
environment variables:

```bash
export SAP_URL=https://<your-subdomain>   # or http://<ip>:50000
export SAP_USER=DEVELOPER
export SAP_PASSWORD='ABAPtr2023#00'
export SAP_CLIENT=001

npm run test:integration
```

The tests:
- Create temporary ABAP objects in the `$TMP` package
- Exercise the full ADT API surface (read, write, activate, unit tests, etc.)
- Clean up all created objects after each test via deferred cleanup functions
- Use the `DEVELOPER` user (not `DDIC` — see [User Access](#user-access))

### Test Categories

The integration test suite covers these areas:

| Category | Tests | Description |
|----------|-------|-------------|
| **Read operations** | SearchObject, GetProgram, GetClass, GetTable, GetTableContents, RunQuery, GetPackage | Basic ADT read APIs |
| **CDS / RAP** | GetCDSDependencies, GetDDLS, GetBDEF, GetSRVB, GetSource_RAP | CDS views, behavior definitions, service bindings |
| **CRUD** | CRUD_FullWorkflow, LockUnlock, WriteProgram, WriteClass, CreateAndActivateProgram, CreateClassWithTests, EditSource, CreatePackage | Create, lock, modify, activate, delete ABAP objects |
| **Dev tools** | SyntaxCheck, SyntaxCheckWithErrors, RunUnitTests, PrettyPrint, GetPrettyPrinterSettings | Syntax checker, unit test runner, pretty printer |
| **Code intelligence** | CodeCompletion, FindReferences, FindDefinition, GetTypeHierarchy | Code completion, where-used, navigation |
| **RAP E2E** | RAP_E2E_OData | End-to-end: DDLS → SRVD → SRVB → publish |
| **Debugger** | ExternalBreakpoints, DebuggerListener, DebugSessionAPIs | External breakpoints and debug sessions *(skipped in CI)* |
| **Namespaces** | Namespace_GetSource_Class, _Interface, _Program, _Function, _DDLS, _BDEF | Namespaced objects (`/DMO/`, `/UI5/`, `/AIF/`) |

### Skipped Tests

The following tests are automatically skipped in CI and must be run manually:

| Test | Reason | Manual Run Command |
|------|--------|--------------------|
| `TestIntegration_ExternalBreakpoints` | Requires interactive debug session; breakpoint API needs specific user authorization | `npm run test:integration -- --grep ExternalBreakpoints` |
| `TestIntegration_DebuggerListener` | Requires a debuggee (running ABAP program hitting a breakpoint) to catch | `npm run test:integration -- --grep DebuggerListener` |
| `TestIntegration_DebugSessionAPIs` | Tests debug attach/step/stack APIs that need an active debug session | `npm run test:integration -- --grep DebugSessionAPIs` |

These tests are skipped with `t.Skip()` because debugger operations require
interactive sessions that cannot be reliably automated. They still exist in the
test file and can be run manually for local development.

### Known Test Failures

| Test | Status | Reason |
|------|--------|--------|
| `TestIntegration_RAP_E2E_OData` | May FAIL on fresh systems | The test creates a DDLS, SRVD, and SRVB (`ZTEST_MCP_SB_FLIGHT`), then publishes the service binding. The `GetSRVB` verification step may return HTTP 500 immediately after publish due to SAP internal timing. The test retries once after a 3-second delay, but this may still fail on slow systems. On subsequent runs the SRVB already exists, so the test handles the "already exists" error gracefully. |

All other tests should pass on a correctly configured trial system with the
work process and session timeout tuning described above.

### Running a Specific Test

```bash
npm run test:integration -- --grep CRUD_FullWorkflow
```

### Running Tests Without Debugger Tests

To explicitly exclude debugger tests (they are already skipped, but for clarity):

```bash
npm run test:integration
```

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

**Node.js 24 opt-in:** The workflow sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`
at the top level to silence GitHub Actions deprecation warnings about Node.js 20.
The `actions/checkout@v4` and `actions/setup-go@v5` actions run on Node.js 20 by
default; this env var forces Node.js 24 ahead of GitHub's mandatory cutover.

**Go module cache disabled:** The workflow uses `cache: false` for
`actions/setup-go` because the Go toolchain download can cause tar extraction
warnings (`/usr/bin/tar: ... Cannot open: File exists`) when the cache is
restored. These warnings are harmless but noisy.

**Test timeout:** Integration tests use `-timeout 10m` to account for network
latency between GitHub Actions runners and the SAP system. Individual ADT calls
from a remote CI runner take longer than from a local machine.

**Debugger tests auto-skip:** The 3 debugger tests (`ExternalBreakpoints`,
`DebuggerListener`, `DebugSessionAPIs`) call `t.Skip()` unconditionally in CI.
They require interactive debug sessions that cannot be automated.

**Session exhaustion prevention:** The SAP system must have the session timeout
tuning from [Session Timeout Tuning](#session-timeout-tuning) applied. Without
it, the 30+ sequential integration tests accumulate stale PRIV sessions on the
SAP server, eventually exhausting all dialog work processes and causing 503
errors for the remaining tests. This is especially pronounced in CI where
network latency is higher and HTTP connections take longer to complete.

---

## Troubleshooting

### SAP returns 401 on ADT but 403 on `/sap/bc/ping`

The user is locked (`UFLAG=128`). ADT enforces strict auth and rejects locked
users immediately; the lightweight `/sap/bc/ping` service returns 403 (auth
succeeded but no authorisation) for the same locked user.

Fix: [Unlock the DEVELOPER user via HANA SQL](#unlocking-the-developer-user).

### Integration tests fail with 503 mid-run

This is caused by dialog work process exhaustion. Two things must be configured:

1. **Enough work processes:** Set `rdisp/wp_no_dia = 25` (see
   [Work Process Tuning](#work-process-tuning)).
2. **Session timeouts:** Add the session cleanup parameters (see
   [Session Timeout Tuning](#session-timeout-tuning)). Without them, stale
   PRIV sessions from CRUD tests hold work processes for up to 10 minutes.

To diagnose, check the work process table:

```bash
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function ABAPGetWPTable
```

Look for DIA work processes in `Stop, PRIV` status — these are held by stale
sessions. If most DIA WPs are PRIV, that explains the 503 errors.

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
are installed with `npm ci` and you're using Node.js 20+.

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

The SRVB was created by a previous test run and not cleaned up. The test now
handles this gracefully by catching the "already exists" error and continuing.
If it still fails, manually delete the object via ADT or SAP GUI (transaction
`SE80`).

### RAP E2E test fails with 500 on GetSRVB after publish

```
status 500 at /sap/bc/adt/businessservices/bindings/ZTEST_MCP_SB_FLIGHT
```

SAP may return HTTP 500 immediately after publishing a service binding. The test
includes a retry with a 3-second delay, but this can still fail on slow systems.
This is a known SAP timing issue and does not indicate a real problem — the SRVB
was created and published successfully.

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

---

## Certificate-Based SAP Setup (for Cloud Connector Principal Propagation)

ARC-1 supports principal propagation via BTP Destination Service and Cloud Connector. The following local flags do **not** exist:

- `--client-cert` / `--client-key` / `--ca-cert`
- `--pp-ca-key` / `--pp-ca-cert` / `--pp-cert-ttl`

If you use this trial system as the SAP backend for principal propagation testing:

1. Keep the SAP-side certificate trust and user mapping setup (STRUST + CERTRULE/VUSREXTID)
2. Configure Cloud Connector principal propagation
3. Configure ARC-1 with BTP destinations and `SAP_PP_ENABLED=true`

See:
- [Principal Propagation Setup](principal-propagation-setup.md)
- [BTP Destination Setup](btp-destination-setup.md)
