# COMPAT-06 - Outbound HTTP_PROXY / NO_PROXY support for SAP ADT traffic

## Overview

ARC-1 should honor standard proxy environment variables for outbound SAP ADT requests:

- `HTTP_PROXY` / `http_proxy`
- `HTTPS_PROXY` / `https_proxy`
- `NO_PROXY` / `no_proxy`

This is a transport compatibility item for enterprise networks. It is not reverse-proxy support for
ARC-1's MCP/OAuth/UI HTTP server, and it must not affect the BTP Destination Service / Cloud Connector
path.

Research: [docs/research/http-forward-proxy-env-support.md](../research/http-forward-proxy-env-support.md).

## Current state

- `docs_page/docker.md` already says ARC-1 respects standard proxy env vars.
- `src/adt/http.ts` does not currently create an env-proxy dispatcher for non-BTP outbound SAP calls.
- `src/adt/http.ts` already has a separate BTP proxy path using `undici.Client` with absolute target
  URLs and SAP-specific proxy headers.
- Current main handles null-body statuses (`204`, `205`, `304`) in the BTP proxy response
  reconstruction path. Any new proxy path must preserve that.

## Target state

- Non-BTP outbound SAP calls use standard proxy env vars when configured.
- BTP `btpProxy` keeps precedence and ignores generic env proxies.
- Plain `http://` SAP targets can use an HTTP forward proxy without forced `CONNECT` tunneling.
- `https://` SAP targets still use CONNECT tunneling, preserving end-to-end TLS to SAP.
- `NO_PROXY` follows undici semantics rather than an ARC-1-specific parser.
- Existing auth, cookie, CSRF, retry, audit, debug-redaction, and 304 behavior remains unchanged.

## Key files

| File | Role |
|------|------|
| `src/adt/http.ts` | Add outbound env-proxy dispatcher or shared forward-proxy helper |
| `tests/unit/adt/http.test.ts` | Add routing and response reconstruction tests |
| `docs_page/docker.md` | Clarify outbound-only proxy behavior |
| `docs_page/configuration-reference.md` | Mention standard proxy env vars in networking notes |
| `docs_page/security-guide.md` or deployment docs | Warn about proxy visibility for plain HTTP SAP traffic |

## Design constraints

1. **BTP proxy first.** If `config.btpProxy` is present, use the existing BTP connectivity-proxy path and
   ignore generic `HTTP_PROXY` / `HTTPS_PROXY`.
2. **Prefer undici primitives.** Use `EnvHttpProxyAgent` / `ProxyAgent` if they express the required
   behavior. Do not hand-roll env parsing unless required.
3. **Avoid CONNECT for plain HTTP where possible.** Use undici `proxyTunnel: false` for HTTP endpoints
   if supported by the installed undici version. HTTPS endpoints still tunnel.
4. **Preserve TLS behavior.** `SAP_INSECURE=true` must still disable SAP endpoint verification in direct
   and proxied HTTPS mode, without accidentally weakening unrelated proxy TLS unless explicitly needed.
5. **Share response reconstruction.** Do not duplicate the BTP proxy's `Response` construction logic.
   A helper should handle headers and null-body statuses for every `Client.request` based proxy path.
6. **No new MCP surface.** No tool schema or authz changes.

## Implementation approach

### Task 1: Spike undici dispatcher shape

Files:

- Read: `src/adt/http.ts`
- Read: installed undici types after `npm ci`

Checklist:

- [ ] Verify `undici@8.5.0` exports `EnvHttpProxyAgent`.
- [ ] Verify `EnvHttpProxyAgent` accepts `proxyTunnel: false` through its options.
- [ ] Verify the TypeScript type for endpoint TLS override (`requestTls`) and proxy TLS override
      (`proxyTls`) so `SAP_INSECURE=true` maps correctly.
- [ ] Decide whether implementation can be a dispatcher-only change. If yes, avoid any manual
      `Client.request` forward-proxy path.

### Task 2: Add proxy dispatcher selection

Files:

- Modify: `src/adt/http.ts`

Checklist:

- [ ] Add a small helper such as `hasProxyEnv()` or `createForwardProxyDispatcher(config)`.
- [ ] In the constructor, keep current behavior:
      - if `config.btpProxy`, do not set a generic dispatcher;
      - else if env proxy vars exist, use `EnvHttpProxyAgent`;
      - else if `config.insecure`, use current direct `Agent`;
      - else leave dispatcher undefined.
- [ ] Pass `proxyTunnel: false` for the env proxy dispatcher if type-supported.
- [ ] Preserve `AbortSignal.timeout(120_000)` at the request call site.
- [ ] Ensure debug/audit redaction still covers `Proxy-Authorization`.

### Task 3: Add shared response reconstruction only if needed

Files:

- Modify: `src/adt/http.ts`
- Modify: `tests/unit/adt/http.test.ts`

Checklist:

- [ ] If dispatcher-only implementation is enough, do not add this task's code.
- [ ] If a manual `Client.request` path is required, extract a helper used by both BTP proxy and the
      new forward-proxy path:
      - copy all response headers;
      - call `resp.body.text()`;
      - pass `null` to `new Response()` for `204`, `205`, and `304`;
      - preserve status code and headers.
- [ ] Keep client close / dispatcher lifecycle explicit and covered by tests.

### Task 4: Unit tests

Files:

- Modify: `tests/unit/adt/http.test.ts`

Minimum tests:

- [ ] No proxy env uses normal `undici.fetch`.
- [ ] `btpProxy` plus `HTTP_PROXY` uses the BTP proxy path.
- [ ] `HTTP_PROXY` with HTTP SAP URL uses the env proxy dispatcher or proxy request path.
- [ ] `NO_PROXY` matching the SAP host bypasses the proxy.
- [ ] Proxy credentials are configured through undici options or headers without appearing in audit
      debug fields.
- [ ] `SAP_INSECURE=true` still creates an appropriate dispatcher when proxy env vars are absent.
- [ ] Proxied `304` response does not crash and preserves `etag`.

Optional tests if easy:

- [ ] Lowercase env var precedence over uppercase, unless delegated entirely to undici and documented.
- [ ] `NO_PROXY` port-specific match, unless delegated entirely to undici and documented.

### Task 5: Documentation

Files:

- Modify: `docs_page/docker.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/security-guide.md` or `docs_page/deployment.md`

Checklist:

- [ ] State that proxy env vars affect outbound SAP ADT traffic from the ARC-1 process.
- [ ] State that they do not configure inbound reverse-proxy behavior for `/mcp`, OAuth, or the UI.
- [ ] State that BTP Destination Service / Cloud Connector deployments should use the BTP destination
      path, not generic env proxies.
- [ ] Warn that plain HTTP SAP traffic through a proxy exposes credentials and ABAP source payloads to
      that proxy.
- [ ] Recommend HTTPS SAP endpoints for production where available.

### Task 6: Verification

Commands:

- `npx vitest run tests/unit/adt/http.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Optional manual verification:

- Run ARC-1 against a local fake HTTP proxy and a local fake SAP endpoint.
- Confirm plain HTTP uses absolute-form proxying when `proxyTunnel: false` is active.
- Confirm `NO_PROXY` bypasses the fake proxy.

## Out of scope

- New ARC-1-specific config names for proxy settings.
- SOCKS proxy support beyond what undici provides.
- Proxy support for plugin raw HTTP calls unless those calls already go through the same ADT HTTP
  layer. Review separately if needed.
- Any change to BTP Destination Service / Cloud Connector behavior.
- Creating a PR as part of this research task.

## Exit criteria

- Research document exists and is linked from the roadmap.
- Roadmap item exists as open `COMPAT-06`.
- Implementation plan is present in `docs/plans/`.
- No code changes are made until this plan is explicitly picked up.
