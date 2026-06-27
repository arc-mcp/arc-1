# HTTP_PROXY / NO_PROXY support for outbound SAP ADT traffic

**Date:** 2026-06-27
**Status:** Research complete, implementation deferred
**Related branch reviewed:** `kalelkim/feature/kalelkim`
**Roadmap item:** [COMPAT-06](../../docs_page/roadmap.md#compat-06)
**Plan:** [docs/plans/http-forward-proxy-env-support.md](../plans/http-forward-proxy-env-support.md)

## Summary

ARC-1 should support standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables for
outbound SAP ADT requests made by `src/adt/http.ts`, but the fork patch should not be merged as-is.

The use case is not browser-to-ARC-1 traffic. It is the ARC-1 server process reaching SAP from an
enterprise network that requires an outbound proxy. This is most relevant for local laptops, Docker
containers, CI runners, or self-hosted ARC-1 servers inside locked-down corporate networks. BTP Cloud
Foundry deployments that use Destination Service and Cloud Connector should continue to use ARC-1's
existing BTP connectivity-proxy path instead.

The right implementation is a small transport-layer compatibility item:

- Keep `btpProxy` precedence exactly as-is.
- Use undici's own proxy primitives where possible, not a custom environment parser.
- For plain `http://` SAP targets behind a corporate proxy, avoid `CONNECT` when possible.
- Preserve current response reconstruction behavior, especially null-body statuses `204`, `205`, and
  `304`.
- Add explicit unit tests before enabling this path.

## Who would use it

### Likely users

1. **Local developer laptop behind a corporate proxy**
   - A developer runs `npx arc-1` or a git checkout locally.
   - Direct access to `http://sap-host:5xx00/sap/bc/adt/...` is blocked.
   - Company tooling already exposes `HTTP_PROXY` and `NO_PROXY`.

2. **Docker container in a corporate network**
   - ARC-1 runs as `docker run ghcr.io/arc-mcp/arc-1`.
   - The container cannot route directly to SAP, but can route through a proxy.
   - `docs_page/docker.md` already tells operators to pass proxy env vars.

3. **CI or integration test runners**
   - Test infrastructure runs outside the SAP network segment.
   - The runner can reach SAP only through an internal forward proxy.

4. **Self-hosted VM/server**
   - ARC-1 is installed on a company VM.
   - Egress is governed by an HTTP proxy or inspection gateway.

### Unlikely or wrong users

1. **BTP Cloud Foundry with Destination Service + Cloud Connector**
   - ARC-1 already has a separate BTP connectivity-proxy implementation (`btpProxy`) with
     `Proxy-Authorization`, `SAP-Connectivity-Authentication`, and optional Location ID handling.
   - Environment proxy support must not override that path.

2. **Browser or MCP clients calling ARC-1**
   - `HTTP_PROXY` here is not reverse-proxy support for `/mcp`, OAuth, or the web UI.
   - It only affects ARC-1's outbound SAP ADT HTTP client.

3. **Public internet deployments**
   - If `SAP_URL` is public and HTTPS, a corporate forward proxy may still be useful.
   - If `SAP_URL` is plain HTTP over the internet, that is a separate and higher-severity TLS problem.

## Current ARC-1 behavior

`src/adt/http.ts` currently has three transport modes:

1. **BTP connectivity proxy**
   - Configured through `config.btpProxy`.
   - Uses `undici.Client` directly against the proxy origin and sends the full target URL as the
     request path.
   - This is intentionally not undici `ProxyAgent`, because the BTP connectivity proxy path relies on
     standard HTTP proxying plus SAP-specific headers.

2. **Direct fetch with optional TLS-insecure dispatcher**
   - For non-BTP connections, ARC-1 calls npm `undici.fetch()`.
   - If `SAP_INSECURE=true`, ARC-1 installs an `Agent({ connect: { rejectUnauthorized: false } })`
     dispatcher.

3. **No explicit env-proxy dispatcher**
   - Despite `docs_page/docker.md` saying proxy environment variables are respected, `src/adt/http.ts`
     does not currently create an `EnvHttpProxyAgent` or parse proxy env vars.
   - Depending on Node version and runtime flags, Node's global `fetch()` may support env proxies, but
     ARC-1 imports and calls npm `undici.fetch()` with its own dispatcher path. Relying on Node global
     behavior is therefore too implicit.

## External source findings

### Node.js

Node's enterprise-network guide says proxy settings are commonly supplied as `HTTP_PROXY`,
`HTTPS_PROXY`, and `NO_PROXY`, and Node supports them when `NODE_USE_ENV_PROXY=1` or
`--use-env-proxy` is enabled. It also states support applies to `fetch()` only on sufficiently recent
Node releases. Source:

- https://nodejs.org/learn/http/enterprise-network-configuration

Important consequence for ARC-1:

- ARC-1's `package.json` currently allows Node `>=22.19`.
- Node's documented env-proxy support for `fetch()` starts later than that minimum.
- ARC-1 should not require users to set `NODE_USE_ENV_PROXY=1` or rely on Node global behavior when it
  already owns the undici dispatcher path.

### undici `EnvHttpProxyAgent`

undici documents `EnvHttpProxyAgent` as stable. It reads lowercase and uppercase proxy variables,
supports `no_proxy` / `NO_PROXY`, and can be used as a per-request dispatcher. It also documents the
important precedence rule that lowercase env vars take precedence over uppercase when both are set.
Source:

- https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md

Important consequence for ARC-1:

- Prefer `EnvHttpProxyAgent` over hand-written env parsing.
- Do not implement a weaker `NO_PROXY` parser unless undici cannot support the needed mode.
- Tests should cover lowercase-over-uppercase precedence indirectly or document that this is delegated
  to undici.

### undici `ProxyAgent`

undici documents `ProxyAgent` as stable. It states that secure `https:` endpoints use an HTTP
`CONNECT` tunnel. It also exposes `proxyTunnel: false`; for plain `http:` endpoints behind an HTTP
proxy, this sends the absolute request URI to the proxy instead of tunneling, matching curl behavior.
Secure connections always use a tunnel even when this option is false. Source:

- https://github.com/nodejs/undici/blob/main/docs/docs/api/ProxyAgent.md

Important consequence for ARC-1:

- The fork's core insight is valid: some corporate proxies block `CONNECT` to plain SAP ICM HTTP ports.
- The implementation should probably use undici's `proxyTunnel: false` rather than duplicating the BTP
  proxy request implementation.
- `https://` SAP endpoints still require tunneling. That is correct because TLS must terminate at SAP,
  not at the proxy.

## Benefits

1. **Makes existing Docker documentation true**
   - `docs_page/docker.md` already tells operators that ARC-1 respects proxy env vars.
   - Implementing the transport path removes a documentation/code mismatch.

2. **Works in enterprise network topologies**
   - Many corporate networks block direct outbound connections from developer machines, CI, and
     containers.
   - Standard env vars are the operator-friendly interface.

3. **Avoids a known CONNECT failure mode**
   - Some forward proxies allow normal HTTP proxy requests but block `CONNECT` to non-443 ports.
   - SAP ICM commonly uses ports such as `50000`, `54000`, or `8000`.
   - For plain `http://` SAP targets, absolute-URI proxying can work where tunneling fails.

4. **Low product-surface impact**
   - No MCP schema changes.
   - No new user-facing tool permissions.
   - No SAP ADT behavior changes.

5. **Improves local and CI reproducibility**
   - Operators can pass the same env vars used by curl, npm, Docker, or corporate shell profiles.

## Risks

### Security risks

1. **Plain HTTP SAP traffic through a proxy exposes credentials and content**
   - If `SAP_URL` is `http://`, the proxy can see Basic auth headers, cookies, CSRF tokens, paths,
     request bodies, and response bodies.
   - This is already true for direct plain HTTP traffic on the network, but proxy support can make it
     easier to route sensitive traffic through a managed inspection point.
   - Production guidance should prefer HTTPS SAP endpoints where possible.

2. **Proxy env var injection can redirect SAP traffic**
   - A malicious `HTTP_PROXY` value in the ARC-1 process environment can route all outbound SAP traffic
     through an attacker-controlled host.
   - This is an operator/runtime hardening issue, not an LLM user-controlled input path.

3. **Proxy credentials in env vars are sensitive**
   - `HTTP_PROXY=http://user:pass@proxy:3128` stores credentials in process environment.
   - Environments can leak through process inspection, crash reports, CI logs, or poor support dumps.
   - ARC-1 debug logging already redacts `Proxy-Authorization`, but it should not log proxy URIs with
     embedded credentials.

4. **`NO_PROXY` mistakes change data path**
   - A missing SAP hostname in `NO_PROXY` may send internal traffic through a proxy.
   - An overly broad `NO_PROXY=*` may bypass a required security control.

### Reliability risks

1. **Transport-mode interactions**
   - Direct fetch, BTP connectivity proxy, TLS-insecure mode, bearer tokens, CSRF, cookie jars, retries,
     and conditional GETs all meet in `src/adt/http.ts`.
   - A proxy implementation must preserve the existing behavior across all modes.

2. **Null-body response handling**
   - Main currently handles `204`, `205`, and `304` specially in the BTP proxy path because the Fetch
     `Response` constructor rejects a non-null body for null-body statuses.
   - A forward-proxy path must share that same reconstruction helper.

3. **Connection pooling and lifecycle**
   - The fork opens a new `undici.Client` for every proxied request.
   - That is simple but less efficient than an agent/dispatcher and increases moving parts.
   - Prefer an agent/dispatcher if it can express the needed behavior.

4. **Lowercase/uppercase env precedence**
   - Hand-rolled parsers often get proxy env precedence and `NO_PROXY` matching wrong.
   - undici already documents these rules.

## Evaluation of the fork patch

The fork patch in `kalelkim/feature/kalelkim` is useful as evidence of the need, but not as mergeable
code.

### Good ideas

- It keeps BTP `btpProxy` first.
- It targets only plain `http://` SAP targets for absolute-URI proxying.
- It recognizes `HTTP_PROXY` and `NO_PROXY`.
- It supports Basic proxy auth from `user:pass@proxy`.

### Problems

- It duplicates `undici.Client` response reconstruction instead of sharing a helper.
- It does not inherit current main's 204/205/304 null-body handling.
- Its `NO_PROXY` parser is narrower than undici's documented behavior:
  - no space-separated entries,
  - no `*.example.com` wildcard,
  - no optional `:port` matching,
  - no lowercase-over-uppercase precedence.
- It creates a new proxy client for every request.
- It adds Korean fork-local comments to production code.
- It has no tests.

## Recommended implementation direction

Use undici dispatcher primitives first:

1. In `AdtHttpClient` construction, when `config.btpProxy` is absent, configure a non-BTP outbound
   dispatcher if proxy env vars are present.
2. Prefer `EnvHttpProxyAgent` with options forwarded to `ProxyAgent`, including `proxyTunnel: false`,
   if supported by the installed undici version.
3. If `SAP_INSECURE=true`, preserve current TLS behavior:
   - direct mode: keep `Agent({ connect: { rejectUnauthorized: false } })`;
   - proxied HTTPS SAP target: set the equivalent endpoint TLS option for the proxy agent
     (`requestTls` in undici terminology), and verify with unit tests/types.
4. If undici's agent cannot express one necessary case, add a small shared helper for `Client.request`
   response reconstruction and use it in both BTP and forward-proxy code paths.

Non-goal:

- Do not create a new ARC-1-specific config surface unless standard env vars prove insufficient.

## Acceptance criteria

1. BTP connectivity proxy remains unchanged and wins over env proxies.
2. Non-BTP direct connections without proxy env vars behave exactly as today.
3. `HTTP_PROXY` / `http_proxy` routes plain `http://` SAP targets through the proxy.
4. `NO_PROXY` / `no_proxy` bypasses the proxy using undici semantics.
5. HTTPS SAP targets continue to tunnel, preserving end-to-end TLS to SAP.
6. `SAP_INSECURE=true` still works for direct and proxied HTTPS SAP targets.
7. `204`, `205`, and `304` responses work through proxy paths.
8. Proxy auth is supported without logging credentials.
9. Unit tests cover the routing matrix.

## Test matrix

Minimum unit tests in `tests/unit/adt/http.test.ts`:

| Scenario | Expected behavior |
|----------|-------------------|
| No proxy env | Uses `undici.fetch`, not `Client`/proxy dispatcher |
| `btpProxy` + `HTTP_PROXY` | Uses BTP proxy path, ignores env proxy |
| `HTTP_PROXY` + HTTP SAP URL | Routes through proxy |
| `HTTP_PROXY` + `NO_PROXY` matching SAP host | Bypasses proxy |
| lowercase and uppercase env set | Lowercase wins, or test delegates to undici |
| `HTTP_PROXY` with credentials | Sends proxy auth through agent option, not leaked in audit |
| Proxied response status 304 | Returns status 304 and empty body without Response constructor error |
| `SAP_INSECURE=true` + HTTPS SAP URL | TLS verification disabled only for the SAP endpoint as today |

Optional integration test:

- A local fake proxy server that asserts absolute-form request target for plain `http://` SAP URL.
- Keep it unit-level unless the fake proxy adds too much test flake.

## Documentation updates needed if implemented

- `docs_page/docker.md`: clarify that proxy env vars affect ARC-1 outbound SAP traffic, not inbound
  MCP/OAuth/UI traffic.
- `docs_page/configuration-reference.md`: add a networking note for `HTTP_PROXY`, `HTTPS_PROXY`, and
  `NO_PROXY` even though they are standard env vars, not ARC-1-specific config.
- `docs_page/security-guide.md` or deployment docs: warn that plain HTTP SAP traffic through a proxy
  exposes credentials and source payloads to that proxy.

## Decision

Implement later as `COMPAT-06`, with a fresh patch rather than a cherry-pick from the fork. The feature
is worth doing because it unblocks enterprise networks and aligns docs with behavior, but it sits below
core SAP feature work because it affects only deployments that require outbound proxies.
