# Mail report — data-preview SQL bodies can be blocked by an upstream WAF

**Status:** Implemented and verified on 2026-08-12 — see
[the completed implementation plan](../../plans/completed/2026-08-12-gzip-datapreview-waf-compatibility.md).
The sender's specific gateway rule still cannot be identified without its audit log, but the
reported behavior is fully explained by pre-SAP request-body inspection. ARC-1 now has a durable,
default-off compatibility option and more accurate diagnostic guidance; a narrowly scoped WAF
exclusion remains the preferred operational fix.

## TL;DR

ARC-1 sends legitimate ABAP SQL as a plain `text/plain` POST body to
`/sap/bc/adt/datapreview/freestyle`. A gateway that treats that body as an injection payload can
return a bare `403 Forbidden` before SAP sees the request. The same credentials then work for
unfiltered `TABLE_CONTENTS`, because that `/datapreview/ddic` request has no SQL body.

The report's fingerprint was recreated with current HEAD through a controlled body-inspecting
reverse proxy: `TABLE_CONTENTS` succeeded, while `SAPQuery` and `TABLE_QUERY` failed with the same
misleading authorization hint. Gzip-encoding the exact request body made both the synthetic proxy
and SAP accept the request. Direct probes show SAP_BASIS 758 and 816 accept both plain and
`Content-Encoding: gzip` request bodies on the freestyle endpoint.

This does **not** make every bare data-preview 403 proof of a WAF, and it does not establish that
stock OWASP CRS blocks arbitrary `text/plain` SQL. The sender's actual WAF rule ID/audit event is
needed for that attribution. The safe ARC-1 fix is an explicit administrator opt-in, not an
automatic retry that silently turns a rejected request into opaque compressed traffic.

## Report and classification

The mail report concerns two public tool paths:

- `SAPQuery(sql=...)` sends the caller's ABAP SQL to the freestyle data-preview endpoint.
- `SAPRead(type="TABLE_QUERY", where=...)` builds a constrained `SELECT` and sends it to the same
  endpoint.

It contrasts those calls with `SAPRead(type="TABLE_CONTENTS")`, which uses the DDIC data-preview
endpoint and normally has no body when no filter was supplied. The claimed workaround is gzip
request content coding.

Classification:

- **Not an SAP authorization defect:** direct requests with the same identity succeed.
- **Not an ADT SQL parser defect:** SAP successfully parses the decompressed statement.
- **An upstream interoperability/security-policy problem:** a body-inspecting gateway can reject
  legitimate SQL-shaped content before it reaches SAP.
- **An ARC-1 product gap:** there is no durable opt-in for compressed data-preview bodies, and a
  bare 403 currently produces an authorization-only hint that sends operators in the wrong
  direction.

No matching open or closed ARC-1 GitHub issue, local research dossier, plan, or historical
`Content-Encoding` implementation was found using the terms `gzip`, `WAF`, `ModSecurity`,
`datapreview`, `freestyle`, and `403`. This dossier uses a descriptive mail-origin name because no
issue number was supplied.

## Current HEAD behavior

Validated at commit `9fba0b6910dabf23d29fd52e4a3dfd16a27df6c1` (package version `1.0.2`):

- `AdtClient.getTableContents()` in `src/adt/client.ts` POSTs the optional `sqlFilter` to
  `/sap/bc/adt/datapreview/ddic` with `Content-Type: text/plain`.
- `AdtClient.postFreestyleQuery()` and `AdtClient.runTableQuery()` POST a raw SQL string to
  `/sap/bc/adt/datapreview/freestyle` with `Content-Type: text/plain`.
- `AdtHttpClient.requestInner()` in `src/adt/http.ts` accepts only a string body and has no request
  content-coding support.
- Every POST is treated as modifying for CSRF handling. A 403 therefore already causes one token
  refresh and one identical retry before the error is returned.
- `src/handlers/dispatch.ts` classifies an otherwise unrecognized 403 as an SAP client,
  credentials, or permissions problem. HTTP deployments also default to minimal errors, so any new
  useful hint must be safe enough to survive that mode.

The configuration value must be threaded through `ServerConfig` -> `AdtClientConfig` ->
`AdtHttpConfig`. Multi-target runtimes construct a safe read-only configuration explicitly, so the
new compatibility value also has to be copied there rather than being inherited accidentally.

## ADT contract and reference implementations

The local Eclipse ADT endpoint inventory confirms the two POST resources but does not document
request content coding:

- `~/DEV/arc-1-eclipse-adt/api/21-data-preview-and-query.md`
- `/sap/bc/adt/datapreview/ddic`
- `/sap/bc/adt/datapreview/freestyle`

A4H's live ADT discovery document advertises the freestyle endpoint. The local reference clients
`mcp-abap-adt-fr0ster` and `vibing-steampunk` also send the SQL as a normal plain-text body; no
reference implementation with request gzip support was found. `arc-1-lsp` does not implement free
SQL/data preview and therefore supplies no competing wire contract.

HTTP permits content codings such as gzip on request messages; RFC 7694 discusses request content
coding explicitly, while RFC 9110 defines `Content-Encoding` as representation metadata. SAP's ICM
documentation for `icm/HTTP/max_request_size_KB` says that compressed requests are measured after
uncompressing, independently corroborating server-side request decompression:

- [RFC 7694 — Client-Initiated Content-Encoding](https://www.rfc-editor.org/rfc/rfc7694)
- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [SAP Help — icm/HTTP/max_request_size_KB](https://help.sap.com/docs/ABAP_PLATFORM_NEW/683d6a1797a34730a6e005d1e8de6f22/483e87b3ca6b72d0e10000000a42189c.html?version=202210.latest)

No public SAP Note specific to gzip on the data-preview endpoint or to this WAF false-positive was
found. The live contract is therefore the load-bearing evidence for this change.

## Live validation

All SAP calls used the canonical HTTPS test-system routes and existing local test credentials. The
queries were read-only, and no credential or response containing sensitive business data is
recorded here.

Representative statement:

```sql
SELECT MANDT FROM T000 WHERE MANDT = '001'
```

| Target/path | Plain request | Gzip request | Interpretation |
|---|---:|---:|---|
| A4H, SAP_BASIS 758, freestyle | 200, one row | 200, one row | SAP accepts both representations |
| A4H-2025, SAP_BASIS 816, freestyle | 200 | 200 | Same contract on the newer release |
| A4H, SAP_BASIS 758, unfiltered DDIC | 200 | N/A (empty body) | Control request succeeds without SQL text |
| Current ARC-1 CLI -> A4H, `SAPQuery` | success | not yet configurable | Current behavior is healthy without the synthetic WAF |
| Current ARC-1 CLI -> A4H, `TABLE_QUERY` | success | not yet configurable | Same identity and endpoint work directly |

The legacy NPL 7.50 system was subsequently re-probed with a working identity. Discovery returns
200 and advertises both collections, but real CSRF-authenticated POSTs to
`/datapreview/freestyle` and `/datapreview/ddic` return `404 No suitable resource found`. The result
is identical for plain and gzip freestyle SQL, and for bodyless and filtered DDIC requests with the
flag off or on. The advertised data-preview ABAP handler is therefore unbound on this support
package: data preview itself is unusable, so this host cannot validate 7.50 request decompression.
This is not evidence that every 7.50 support package lacks the endpoint, and no general 7.50
gzip-support claim is made.

### Controlled WAF reproduction

An ephemeral local reverse proxy was placed between ARC-1 and A4H. It returned the deliberately
generic body `Forbidden` with status 403 when the raw request body contained `SELECT` or `WHERE`,
and otherwise forwarded the original method, headers, and bytes to SAP. This models the reported
failure without changing the test system or committing a fixture server.

| ARC-1 operation through proxy | Result |
|---|---|
| `SAPRead TABLE_CONTENTS`, no filter | success |
| `SAPQuery`, plain SQL body | bare 403; ARC-1 suggests SAP credentials/permissions |
| `SAPRead TABLE_QUERY`, generated SQL body | bare 403; same misleading suggestion |
| Raw freestyle request, plain body | bare 403 generated by proxy |
| Raw freestyle request, gzip body | 200 from SAP |

This reproduces the report's three-part fingerprint exactly: a bodyless data-preview control works,
SQL-bearing operations fail before SAP, and changing only the content coding restores success.

## Root cause

The root cause is a policy/parser mismatch at an upstream HTTP security layer. ADT intentionally
accepts an authenticated SQL representation at a fixed data-preview route. A gateway that scans
the decoded or raw `text/plain` body using generic injection signatures can instead interpret the
legitimate statement as an attack and terminate the request with its own generic 403. SAP never has
an opportunity to authorize or parse it.

Gzip works against a gateway that examines only the received compressed octets, because the SQL
tokens are no longer directly visible. SAP ICM then decodes the representation and passes the
original text to ADT. This result also identifies the security trade-off: compression can make the
request opaque to a body-inspection control and must not be enabled silently.

The report describes a “ModSecurity-style OWASP CRS setup,” but that is not precise enough to name
the blocking rule. ModSecurity can expose request bodies through `REQUEST_BODY`, and its recommended
configuration enables body access. However, the current stock CRS 942 SQL-injection rules primarily
target parsed arguments, cookies, and XML variables rather than an unconditional raw
`text/plain` body variable. A custom rule, connector behavior, additional ruleset, or different WAF
can produce the observed result. Gateway audit logs and the matched rule ID remain necessary for a
definitive appliance-level diagnosis:

- [ModSecurity recommended configuration](https://github.com/owasp-modsecurity/ModSecurity/blob/v3/master/modsecurity.conf-recommended)
- [ModSecurity v3 reference manual](https://github.com/owasp-modsecurity/ModSecurity/wiki/Reference-Manual-%28v3.x%29)
- [OWASP CRS SQL-injection rules](https://github.com/coreruleset/coreruleset/blob/main/rules/REQUEST-942-APPLICATION-ATTACK-SQLI.conf)

A bare 403 by itself is consequently only a **possible WAF fingerprint**. Expired credentials,
ICF authorization, CSRF enforcement, and other gateways can also return 403. ARC-1 must keep that
uncertainty in its hint.

## Recommended fix

### Preferred infrastructure correction

Have the security owner inspect the gateway audit event and create the narrowest viable exception
for the exact authenticated ADT data-preview POST route and matched variable/rule. OWASP CRS itself
recommends granular rule exclusions for known false positives. This preserves inspection elsewhere
and makes the exception visible in security configuration:

- [OWASP CRS documentation — false positives and exclusions](https://coreruleset.org/docs/index.print)
- [OWASP CRS paranoia levels and rule exclusions](https://coreruleset.org/docs/2-how-crs-works/2-2-paranoia_levels/)

### ARC-1 compatibility correction

Ship a durable administrator-controlled fallback for environments where the gateway cannot be
changed immediately:

1. Add `SAP_GZIP_DATAPREVIEW_BODY` / `--gzip-datapreview-body`, default `false`.
2. When enabled, gzip only a non-empty string body on an exact POST to
   `/sap/bc/adt/datapreview/freestyle` or `/sap/bc/adt/datapreview/ddic`, and set
   `Content-Encoding: gzip`.
3. Preserve the compressed bytes and header through direct and BTP proxy transports and through the
   existing CSRF retry. Keep debug logging based on the original string, not compressed bytes.
4. Add a conservative hint only for a bare/generic 403 on those exact endpoints. It should say
   “possible upstream WAF/body inspection,” recommend comparing a bodyless control and checking
   gateway logs, prefer a scoped rule exclusion, and mention the flag only when approved.
5. Document that enabling the option can prevent a naive WAF from inspecting those request bodies;
   it does not relax ARC-1 data/SQL scopes or SAP authorization.

Do **not** automatically retry a 403 with gzip. The status is ambiguous, current POST handling
already performs a CSRF-refresh retry, and transparently changing content coding would both obscure
the original failure and risk evading a deliberate security control.

## Affected files

- Configuration: `src/server/types.ts`, `src/server/config.ts`, `src/server/server.ts`,
  `src/server/multi-target-runtime.ts`, `src/adt/config.ts`, `src/adt/client.ts`
- Wire transport: `src/adt/http.ts`
- Diagnostic guidance: `src/handlers/dispatch.ts`
- Focused tests: `tests/unit/server/config.test.ts`, `tests/unit/server/server.test.ts`,
  `tests/unit/server/multi-target-runtime.test.ts`, `tests/unit/adt/http.test.ts`,
  `tests/unit/handlers/dispatch-misc.test.ts`
- Operator docs: `.env.example`, `AGENTS.md`, `docs_page/configuration-reference.md`,
  `docs_page/authorization.md`

No MCP tool schema, safety-scope, data-preview authorization gate, cache key, or SAP SQL-building
behavior needs to change.

## Implementation and final verification

Implemented in the source tree (never by editing `dist/`):

- `SAP_GZIP_DATAPREVIEW_BODY` / `--gzip-datapreview-body`, default false, is threaded through
  single-target, per-user, and immutable multi-target client construction.
- The HTTP transport gzip-encodes only non-empty string POST bodies on the exact freestyle/DDIC
  collection paths. It preserves the logical string for debug handling and preserves one binary
  wire body through direct fetch, BTP proxying, and every retry path.
- A bare/generic 403 on the freestyle path, or on a DDIC request that actually carries an
  `sqlFilter`, now produces cautious possible-WAF guidance in detailed and minimal-error modes. A
  bodyless, unfiltered DDIC request, structured SAP XML authorization faults, and other
  paths/statuses retain their existing classification. The hint preserves request-correlation
  guidance and names a rejected CSRF/session pair as another possible source of a generic 403.
- Startup policy logs expose the resolved gzip state and its configuration source, and warn when
  both data-preview gates make the enabled option unreachable.
- Operator documentation puts gateway audit evidence and a scoped rule exclusion before the gzip
  compatibility fallback and calls out the inspection trade-off.

Final automated checks:

| Check | Result |
|---|---:|
| Focused config/runtime tests | pass |
| Focused HTTP transport tests | pass |
| Focused dispatch/error tests | pass |
| Full `npm test` | 171 files, 5,016 tests passed |
| `npm run typecheck` | pass |
| `npm run lint` | pass (two pre-existing Biome config migration notices only) |
| `npm run build` | pass |
| `git diff --check` | pass |

Final live regression using the built CLI:

| Route/target | Flag | Result |
|---|---:|---|
| Controlled body-inspecting proxy, `SAPQuery` | off | bare 403 plus possible-WAF hint |
| Controlled body-inspecting proxy, `SAPQuery` | on | success, expected T000 row |
| Controlled body-inspecting proxy, `TABLE_QUERY` | off | bare 403 plus possible-WAF hint |
| Controlled body-inspecting proxy, `TABLE_QUERY` | on | success, expected T000 row |
| Controlled proxy, unfiltered `TABLE_CONTENTS` | off | success (unchanged control) |
| Direct SAP_BASIS 758, `SAPQuery` | off / on | both succeed with expected row |
| Direct SAP_BASIS 816, `SAPQuery` | on | succeeds with expected row |
| Direct SAP_BASIS 750, freestyle + DDIC | off / on | both handlers return `404 No suitable resource found`; gzip compatibility is not testable on this host |

No automatic gzip retry, data/SQL gate relaxation, generated tool-schema change, credential,
throwaway proxy, or built artifact is part of the patch.

## Paste-able reply

```markdown
Confirmed as an interoperability issue, with one important qualification: a bare 403 is consistent
with an upstream WAF false-positive, but the gateway audit log/rule ID is needed to prove the exact
appliance rule. I reproduced the complete fingerprint on current ARC-1 through a controlled
body-inspecting proxy: unfiltered TABLE_CONTENTS succeeded, while SAPQuery and TABLE_QUERY received
the same bare 403 and misleading authorization hint. Gzip changed only the representation and made
the request succeed.

I also verified directly that SAP_BASIS 758 and 816 accept both plain and `Content-Encoding: gzip`
bodies on `/sap/bc/adt/datapreview/freestyle`. The durable product fix should be a default-off
`SAP_GZIP_DATAPREVIEW_BODY` option scoped to non-empty data-preview POST bodies, plus a cautious WAF
diagnostic hint. It should not auto-retry 403s with gzip: 403 is ambiguous, ARC-1 already performs a
CSRF retry, and silently compressing after a rejection could bypass a deliberate inspection policy.

The preferred operational fix is still a narrowly scoped WAF rule exclusion approved by the
security owner. The ARC-1 flag is the compatibility fallback for environments where that cannot be
changed promptly.
```

**Recommendation:** implement the opt-in compatibility path and hint, then open a focused patch PR.
The report is real and actionable, while default behavior can remain byte-for-byte compatible.
