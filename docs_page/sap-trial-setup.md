# Set up a SAP test system

Prepare a self-hosted SAP ABAP trial system for ARC-1 development and integration tests.
You need administrator access to a dedicated test host. If you already have a reachable ADT system,
start at [Verify ADT access](#verify-adt-access).

## Prerequisites

Follow the current [SAP trial image instructions](https://hub.docker.com/r/sapse/abap-cloud-developer-trial)
for available tags, license terms, supported hosts, and sizing. SAP lists a Linux minimum of 4 CPUs,
16 GB RAM, and 150 GB disk, and recommends 32 GB RAM. Check the selected image before provisioning.

For remote access, also prepare a DNS name, a trusted HTTPS certificate, and a reverse proxy.
Use your own host and credentials in the examples below.

<a id="server-setup"></a>
<a id="sap-abap-trial-container"></a>

## 1. Start the trial system

1. Install Docker on the host and sign in to Docker Hub.
2. Choose a tag from [SAP's image tags](https://hub.docker.com/r/sapse/abap-cloud-developer-trial/tags).
3. Follow the image's startup command, including hostname `vhcala4hci`, resource checks, and graceful
   shutdown timeout. Name the container `a4h` for the commands below.
4. Complete the SAP license setup and change the supplied initial passwords.

When using a host reverse proxy, bind the container's ICM HTTP port to loopback, for example
`-p 127.0.0.1:50000:50000`. Publish only the ports needed by your chosen access method.
Keep the container and its data when restarting; verify your backup before recreating it.

Check SAP startup:

```bash
docker logs --tail 100 a4h
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function GetProcessList
```

Wait for the required SAP processes to report running before checking ADT.
A running container alone does not prove SAP is ready.

<a id="sap-system-configuration"></a>
<a id="license-installation"></a>

## 2. Configure SAP access

Use the image's license instructions to obtain and install a valid trial license.
For the 2023 image, the instance profile used by `saplikey` is
`/usr/sap/A4H/SYS/profile/A4H_D00_vhcala4hci`; list the profile directory before reusing that path
on another image.

<a id="user-access"></a>
<a id="unlocking-the-developer-user"></a>

Create or configure an ADT developer user in the intended client, commonly `001` for the trial.
The 2023 image includes `DEVELOPER`; confirm the supplied users for your selected tag.
Use `SU01` to maintain or unlock the user. Test writes need the relevant development authorizations;
a successful `DDIC` login is not evidence of those permissions.

## 3. Configure trusted HTTPS

<a id="https-reverse-proxy-setup"></a>

On a Linux host using Nginx, proxy your public DNS name to the loopback ICM port.
For example, create a site configuration with your real DNS name in place of `sap.example.com`:

```nginx
server {
    listen 80;
    server_name sap.example.com;

    location / {
        proxy_pass http://127.0.0.1:50000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 50m;
    }
}
```

Enable the site using your distribution's Nginx layout. Check DNS and Nginx configuration, then
obtain the certificate with the Certbot Nginx plugin:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d sap.example.com
```

Choose HTTPS redirection when prompted. Before sending credentials, confirm HTTPS works with normal
certificate validation. Clients use `https://sap.example.com` on port 443; the proxy alone uses
port 50000. Verify your certificate renewal job is enabled.

## Verify ADT access

Use your actual URL, client, and username. `curl` prompts for the password:

```bash
curl --fail --user YOUR_USER \
  'https://sap.example.com/sap/bc/adt/discovery?sap-client=001'
```

Expect an ADT XML document. An HTML login page indicates an SSO flow; HTTP 401 or 403 requires
checking the user, client, service activation, or ADT authorization. A response from `/sap/bc/ping`
does not establish ADT access.

Then use the [ARC-1 quickstart](quickstart.md) to verify an object search.

## Cloud Connector setup

Add Cloud Connector only when testing a [BTP deployment](btp-overview.md).
The [principal-propagation guide](principal-propagation-setup.md) owns the network, trust, resource,
and identity steps; the [destination reference](btp-destination-setup.md) owns the destination fields.

If your trial image includes Cloud Connector, check its startup instructions. The 2023 image uses:

```bash
docker exec a4h /usr/local/sbin/rcscc_daemon start
```

Keep its administration interface reachable only through your administrative access path.
Use explicit required resources such as `/sap/bc/adt` rather than exposing `/` by default.

## Integration tests

From an ARC-1 checkout with `npm ci` completed, set these variables through your local secret handling:

```dotenv
TEST_SAP_URL=https://sap.example.com
TEST_SAP_USER=YOUR_TEST_USER
TEST_SAP_PASSWORD=YOUR_TEST_PASSWORD
TEST_SAP_CLIENT=001
TEST_SAP_INSECURE=false
```

For a self-signed development endpoint only, `TEST_SAP_INSECURE=true` disables TLS verification;
keep it `false` for the trusted reverse-proxy endpoint above.

These suites use a real SAP system; some create, activate, and delete test objects.
Use a dedicated development system and select the suite you need:

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests; no SAP connection required |
| `npm run test:integration` | Default live ADT integration coverage |
| `npm run test:integration:crud` | Object lifecycle tests |
| `npm run test:integration:slow` | Broader, longer-running SAP checks |
| `npm run test:e2e` | Fixture synchronization and MCP E2E tests; requires a running test MCP server |

For a single integration file, use Vitest's file filter:

```bash
npm run test:integration -- tests/integration/crud.lifecycle.integration.test.ts
```

See the [E2E instructions](https://github.com/arc-mcp/arc-1/blob/main/tests/e2e/README.md) for server setup
and [skip policy](https://github.com/arc-mcp/arc-1/blob/main/docs/integration-test-skips.md) for supported
skip reasons. A skipped or incomplete test is not a pass. Inspect leftover fixtures after an interrupted run.

## GitHub Actions CI

Store `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, and `TEST_SAP_CLIENT` as repository secrets
for the dedicated test system. Confirm names with `gh secret list --repo <owner>/<repo>`.

The [test workflow](https://github.com/arc-mcp/arc-1/blob/main/.github/workflows/test.yml) defines when
live SAP jobs run. External fork PRs do not receive those secrets; documentation and chore PRs skip
the live SAP lanes. Use manual dispatch when a live run is needed.

## Troubleshooting

| Symptom | Next check |
| --- | --- |
| HTTP 401 | Client, credentials, password state, and user lock in `SU01` |
| HTTP 403 on ADT | ADT service activation and the user's SAP authorization |
| HTTP 503 during tests | SAP dialog work-process availability, abandoned sessions, and [test-load tuning](#work-process-tuning) |
| Invalid or expired license | Trial image's license-renewal procedure |
| TLS error | Public hostname, certificate chain, and CA trust |
| Test object already exists | Prior interrupted run and fixture cleanup; inspect the object before deleting it |
| Disk full while pulling | Free space in Docker's storage filesystem |

<a id="work-process-tuning"></a>
<a id="session-timeout-tuning"></a>

### Tune test load and idle sessions

Integration test files run serially by default. If you enabled `TEST_FILE_PARALLELISM=true`, unset
it before retrying an overloaded system. Also check `ARC1_MAX_CONCURRENT` on the test server and
other clients using SAP. Serial test files can still perform concurrent requests.

Use `SM50` to inspect work-process use and `RZ11` to read the current values and documentation:

| Parameter | What to check |
| --- | --- |
| `rdisp/wp_no_dia` | Dialog work-process count. Leave capacity for interactive users; increase only when CPU and memory can support the additional processes. |
| `rdisp/plugin_auto_logout` | Idle HTTP application-session lifetime. Shortening it can release abandoned stateful sessions, but can also expire an editor's locks. |
| `http/security_session_timeout` | Security-session lifetime. Coordinate it with application-session timeouts; a shorter value can force reauthentication first. |
| `icm/keep_alive_timeout` | Idle network-connection lifetime. This does **not** release the ABAP user context. |

SAP explains the distinction in its [ICM timeout reference](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/0c333adb55cd4dbf8e92a5175703224c/15f6c60fdc8642bfbfeecb1c211c89df.html)
and [session-timeout diagnosis](https://userapps.support.sap.com/sap/support/knowledge/en/1914112).
The earlier trial's fixed values are not a sizing recommendation for a different image or workload.

For a persistent change, back up and edit the instance profile (`RZ10`, or the profile file in this
self-hosted trial). Check its path first:

```bash
docker exec a4h ls /usr/sap/A4H/SYS/profile
```

If the parameter requires a restart, stop the ABAP instance during a test window. Wait for it to
stop before starting it; check readiness with `GetProcessList` again afterward:

```bash
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function Stop
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function GetProcessList
# After the instance has stopped:
docker exec a4h /usr/sap/hostctrl/exe/sapcontrol -nr 00 -function Start
```

Rerun the failing test and inspect `SM50` before raising concurrency again.

<a id="writes-fail-with-423-invalid-lock-handle-nw-751"></a>

### Writes fail with an invalid lock handle on older NetWeaver

On SAP_BASIS releases below 7.51, the HTTP ADT handler can ignore the requested stateful session.
The lock then fails to survive until the source update, causing HTTP 423 even though the lock call
returned a handle.

Have the SAP owner evaluate the
[`abapfs_extensions` stateful-session enhancement](https://github.com/marcellourbani/abapfs_extensions)
for that system. Review and activate it through the normal development process, then retry a small
write in a test package. The [earlier trial notes](https://github.com/arc-mcp/arc-1/blob/f23765f0/docs_page/sap-trial-setup.md#writes-fail-with-423-invalid-lock-handle-nw--751)
record the manual implementation and observed release behavior.

For certificate-based BTP access, continue with
[Principal propagation](principal-propagation-setup.md).
