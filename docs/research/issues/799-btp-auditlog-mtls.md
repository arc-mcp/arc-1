# Issue #799 — BTP Audit Log accepts an unusable binding and never performs mTLS

**Status:** Fixed and validated against SAP BTP on 2026-09-17.
**Issue:** [arc-mcp/arc-1#799](https://github.com/arc-mcp/arc-1/issues/799)

## TL;DR

The reporter is right that ARC-1 accepts a non-X.509 `auditlog/premium` binding and announces the
sink as enabled. The first request then targets `undefined/oauth/token`, so no audit event reaches
SAP.

The proposed missing-field validation is necessary but not sufficient. ARC-1's token request uses
ordinary `fetch` and never attaches the binding's certificate or private key. A correctly created
X.509 binding therefore also cannot work. `NODE_EXTRA_CA_CERTS` adds trusted certificate
authorities; it does not present a client certificate.

Live PR validation exposed one more masked defect: after mTLS succeeds, SAP rejects ordinary
`data-accesses` records because the payload omits the required `data_subject`. The same field belongs
on `data-modifications`; it does not belong on security or configuration records.

Current HEAD does write one raw stderr line for every failed event, so the failure is not completely
silent in the implementation. The observable defects are still serious: startup reports a dark
sink as enabled, the failure is not emitted through ARC-1's structured logger, and repeated tool
calls can flood stderr.

The narrow fix is to validate the selected binding, obtain tokens through ARC-1's existing
`@sap/xssec` dependency (which implements X.509 client authentication and token caching), emit a
rate-limited structured warning on delivery failure, add the SAP-system data subject to the two data
categories, and ship an optional inactive MTA resource whose instance and binding parameters are
correct by construction.

## Reported behavior

The reporter deployed ARC-1 v1.2.0 on Cloud Foundry with a plain `auditlog/premium` instance and
binding. The binding contained `uaa.clientid` and `uaa.clientsecret`, but no `uaa.certurl`,
`uaa.certificate`, or `uaa.key`. ARC-1 logged `BTP Audit Log sink enabled`; the retrieval API later
contained no ARC-1 events.

In a [follow-up comment](https://github.com/arc-mcp/arc-1/issues/799#issuecomment-5709650418), the
reporter independently recreated a documented X.509 binding and reached the same second root cause:
the certificate endpoint reset the TLS connection because ARC-1 never presented the client
certificate. The comment also records that one `cf bind-service ... -c` invocation returned `OK`
but materialized `credential-type: binding-secret`; repeating it produced the requested X.509
binding. Deployment verification must therefore inspect the resulting credential type and field
presence rather than trust the CLI success message.

This is a BTP service-binding and outbound OAuth problem. It does not involve an SAP ADT endpoint or
vary by SAP_BASIS release, so the Eclipse ADT, language-server, and ABAP reference repositories have
no applicable contract to validate. Searches of both reference MCP implementations found no BTP
Audit Log sink.

## What HEAD actually does

The issue was tested at commit
[`5bc5310`](https://github.com/arc-mcp/arc-1/commit/5bc5310bbd74cb43b962d4317e7f1a468ce4d472),
which was also `origin/main` on 2026-09-17.

- [`parseBTPAuditLogConfig()`](https://github.com/arc-mcp/arc-1/blob/5bc5310bbd74cb43b962d4317e7f1a468ce4d472/src/server/sinks/btp-auditlog.ts#L92-L119)
  copies possibly absent values into a statically non-nullable config.
- [`createAndStartServer()`](https://github.com/arc-mcp/arc-1/blob/5bc5310bbd74cb43b962d4317e7f1a468ce4d472/src/server/server.ts#L1123-L1134)
  registers that config and logs `enabled` without checking it.
- [`getToken()`](https://github.com/arc-mcp/arc-1/blob/5bc5310bbd74cb43b962d4317e7f1a468ce4d472/src/server/sinks/btp-auditlog.ts#L336-L366)
  posts to `certurl`, but its `fetch` options contain neither the certificate nor the key.
- [`write()`](https://github.com/arc-mcp/arc-1/blob/5bc5310bbd74cb43b962d4317e7f1a468ce4d472/src/server/sinks/btp-auditlog.ts#L129-L149)
  catches each failure and writes it directly to stderr. Its attempted promise cleanup is also
  ineffective because the synchronous filter runs before the attached `then` callbacks.

## SAP contract and independent implementation evidence

SAP's
[Audit Log Write API for Customers](https://help.sap.com/docs/btp/sap-business-technology-platform/audit-log-write-api-for-customers?locale=en-US)
specifies both halves of the setup:

1. create the premium instance with
   `xs-security.oauth2-configuration.credential-types: [x509]` and the
   `client_credentials` grant; and
2. create the application binding with `xsuaa.credential-type: x509` plus certificate validity.

The same page states that the binding certificate expires and must be rotated by rebinding.

SAP's existing `@sap/xssec` package documents X.509 token fetching and implements it by selecting
`certurl` and attaching an HTTPS agent containing the binding `certificate` and `key`. ARC-1 already
depends on `@sap/xssec`; no dependency or custom TLS implementation is needed. SAP's
`@sap/audit-logging` package independently delegates client-credential token acquisition to the
same `XsuaaService` mechanism.

The Write API's data-access schema also requires either `data_subject` or `data_subjects`. ARC-1
uses one `data_subject` whose type is `sap-system`, role is `data-owner`, and system identifier is
the resolved public target or a stable single-target fallback. It includes the
same attribution on data modifications, although the author's live probe accepted that category
without a subject.

## Reproduction and live validation

### Current parser and sink, locally

Using the exact field shape reported in the issue:

```text
parsed: {"url":"https://api.auditlog.example/premium","uaa":{"url":"https://tenant.authentication.example","clientid":"reported-client"}}
fetch URL: undefined/oauth/token
[BTPAuditLogSink] Failed to write audit event: Error: synthetic network stop
```

This proves both that the invalid binding is accepted and that current HEAD does emit a raw stderr
line after an event is attempted.

### mTLS transport proof, locally

An ephemeral HTTPS server required a CA-signed client certificate. With the server CA trusted in
both cases:

| Client path | Result |
|---|---|
| Current plain-fetch shape, no client certificate | `UND_ERR_SOCKET` during the TLS handshake |
| `@sap/xssec` `XsuaaService` with the same certificate/key fields | Token response `mtls-token` |

This isolates the second root cause: trust-store injection cannot substitute for client-certificate
authentication.

### SAP BTP Cloud Foundry, us10

A temporary `auditlog/premium` service was created in the connected development space with the
documented X.509 instance parameters. Two temporary service keys were compared; only field names
were printed.

| Key/binding parameters | Observed `uaa.credential-type` | Relevant fields |
|---|---|---|
| No parameters | `binding-secret` | `clientid`, `clientsecret`, `url`; no certificate fields |
| `xsuaa.credential-type=x509` | `x509` | `clientid`, `certurl`, `certificate`, `key`, `url` |

`XsuaaService` obtained a real token from the X.509 key and a synthetic, non-production security
event posted to `/audit-log/oauth2/v2/security-events` returned **HTTP 201**. The temporary keys and
service instance were deleted after the probe, and their credentials were never printed or saved in
the repository.

The [reporter's eu10 rerun on `8f41a670`](https://github.com/arc-mcp/arc-1/pull/802#issuecomment-5710239435)
returned HTTP 201 for all four categories. Two records were already visible in the Retrieval API;
the other two were still ingesting when the comment was posted.

This behavior is BTP service-contract behavior and is independent of the target ABAP release.

## Root cause

There are five related defects:

1. Runtime JSON is assigned to `BTPAuditLogConfig` without checking the required strings, defeating
   the interface's compile-time guarantee.
2. The token request does not use the certificate or key at all. The source comment incorrectly
   treats `NODE_EXTRA_CA_CERTS`/the CF buildpack as outbound client identity.
3. Tool-call payloads omit the subject required by SAP's data-access endpoint.
4. Startup logs `enabled` before the first usable authentication path has even been established.
5. Delivery failures bypass the configured logger and occur once per event without rate limiting;
   the pending-promise cleanup does not actually remove settled promises.

## Shutdown follow-up

The existing SIGTERM/SIGINT handlers called `process.exit(0)` without `logger.flush()`, abandoning
in-flight Audit Log posts and buffered file records. The shared shutdown handler now stops incoming
requests, waits for audit sinks, closes the cache, and exits; a five-second deadline prevents an
unreachable sink or unfinished request from hanging a restart. Repeated signals do not bypass the
flush. Logger flush waits for healthy sinks even if another fails, and FileSink waits for appends
already started by its periodic timer. Forced termination can still lose pending records.

Real-process SIGTERM/SIGINT tests hold a BTP sink post across the signal, then allow it to complete
before exit. Removing the shutdown flush makes these regressions fail by exiting before delivery.

## Out of scope

- No `SAP_AUDIT_REQUIRED`/strict-startup configuration flag. A new policy surface is unnecessary to
  correct the broken optional sink and would need a separate operational design.
- No switch to `@sap/audit-logging`. ARC-1 keeps its existing payload mapping and adds only the
  required data subject; the token transport alone needs SAP's supported XSUAA client.
- No default premium-service creation. The MTA resource remains inactive so deployments without the
  entitlement or desire for the paid/optional service do not change.
- No Audit Log Retrieval API client or startup write probe. Binding validation is deterministic;
  runtime authorization, expiry, and network failures are surfaced by the rate-limited warning.
