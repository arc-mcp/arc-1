# Startup feature-probe log noise + onboarding doc gaps (P0/P1/P2)

**Date:** 2026-06-15
**Source:** customer feedback (Manuel Fahrbach, TEAG deployment) — see chat thread.
**Scope:** one PR covering P0 (code), P1 + P2 (docs). P3 (mta logging-service hygiene / AMS) is a
separate follow-up.

---

## Problem

A perfectly healthy ARC-1 startup logs a wall of `WARN: [http_request]` lines for ADT endpoints that
are simply **not installed / not activated** on the target system. Admins (esp. non-devs deploying to
BTP CF) read these as errors and can't tell a benign "feature absent" from a real permission problem.

The infra to suppress this already exists — [`http.ts`](../../src/adt/http.ts) downgrades an expected
404 to `debug` when `suppressNotFoundLog` is set — but the **startup probes never pass it**, and it is
404-only (one probe legitimately returns **400**).

## Root cause (verified live)

`probeFeatures()` in [`src/adt/features.ts`](../../src/adt/features.ts) runs ~7 capability/discovery
GETs in parallel at startup. Every non-2xx is **expected data** captured by the classifier
(`classifyFeatureProbeStatus` / `classifyTextSearchError` / `classifyAuthProbeError`) and re-reported
cleanly at a higher layer (feature map; the `Authorization probe: …` INFO/WARN lines in
[`server.ts`](../../src/server/server.ts); the contextual `ADT discovery unavailable …` warn in
[`discovery.ts`](../../src/adt/discovery.ts)). But each GET throws `AdtApiError` on `>= 400`
([http.ts `handleResponse`](../../src/adt/http.ts)), and the single catch in `request()` logs
`http_request` at **WARN** unless `suppressNotFoundLog && status === 404`. So the raw WARN is pure,
duplicate noise for these calls.

Key subtlety: the **rap** probe hits `/sap/bc/adt/ddic/ddl/sources`, which **intentionally returns
400** without query params — the classifier treats that 400 as `available: true` (the probe's *success*
signal). Yet it logs at WARN. So a 404-only suppression is insufficient; a probe must suppress **any**
expected non-2xx.

## Live evidence

Captured by running `node dist/index.js --url … --user … --password … --client 001` (stdio) and reading
stderr. Identical noise pattern on both releases; the exact set varies by what's installed, which is why
hardcoding statuses is wrong and a per-call "this is a probe" flag is right.

**a4h — S/4HANA 2023, SAP_BASIS 758** (5 noise WARNs):
```
WARN [http_request] GET /sap/bc/adt/ddic/sysinfo/hanainfo            404
WARN [http_request] GET /sap/bc/adt/debugger/amdp                    404
WARN [http_request] GET /sap/bc/adt/ddic/ddl/sources                 400   ← rap probe SUCCESS, mislogged
WARN [http_request] GET /sap/bc/adt/filestore/ui5-bsp                404
WARN [http_request] GET /sap/bc/adt/repository/informationsystem/textSearch?…  404
INFO Authorization probe: object search access is available
INFO Authorization probe: transport access is available
```

**a4h-2025 — ABAP Platform 2025, SAP_BASIS 816** (6 noise WARNs — adds abapGit, matches Manuel's
screenshot exactly):
```
WARN [http_request] GET /sap/bc/adt/ddic/sysinfo/hanainfo            404
WARN [http_request] GET /sap/bc/adt/abapgit/repos                    404
WARN [http_request] GET /sap/bc/adt/ddic/ddl/sources                 400
WARN [http_request] GET /sap/bc/adt/filestore/ui5-bsp                404
WARN [http_request] GET /sap/bc/adt/debugger/amdp                    404
WARN [http_request] GET /sap/bc/adt/repository/informationsystem/textSearch?…  404
INFO Authorization probe: object search access is available
INFO Authorization probe: transport access is available
```

The two `Authorization probe: … is available` INFO lines are the green-light signal (P1 doc anchor).

## Startup probe call inventory (all in features.ts unless noted)

| line | endpoint | expected miss |
|------|----------|---------------|
| 111  | each `PROBES[]` endpoint (hana/abapGit/gcts/rap/amdp/ui5/transport/ui5repo/flp) | 404 absent; **400 = rap success**; 405 |
| 260  | `/sap/bc/adt/system/components` | 4xx → silently `{}` |
| 285  | `/sap/bc/adt/abapsource/syntax/configurations` | 4xx → silently `undefined` |
| 350  | `…/informationsystem/textSearch?…` (probeTextSearch) | 404 not activated; 501 < 7.51 |
| 405  | `…/informationsystem/search?…` (probeSearchAccess) | 403 → reported at server.ts:375 |
| 422  | `/sap/bc/adt/cts/transportrequests?user=__PROBE__` (probeTransportAccess) | 403 → server.ts:381 |
| discovery.ts:35 | `/sap/bc/adt/discovery` | error → contextual warn at discovery.ts:44 |

Every one has higher-layer reporting, so the raw `http_request` WARN is always redundant for these.

---

## Plan

### P0 — code: mark startup probes so expected misses log at `debug`

1. **`src/adt/http.ts`** — add `probe?: boolean` to `AdtRequestOptions` (next to `suppressNotFoundLog`,
   with a doc comment: capability/discovery probe; any non-2xx is expected, log at debug). In the
   `request()` catch (the `AdtApiError` branch, ~line 755) compute:
   ```ts
   const isProbeMiss = options?.probe === true;                                  // any status
   const isSuppressedNotFound = options?.suppressNotFoundLog === true && err.statusCode === 404;
   const level = isProbeMiss || isSuppressedNotFound ? 'debug' : 'warn';
   ```
   Leave `suppressNotFoundLog` (404-only) untouched for its existing callers (crud.ts:294, client.ts:477).
2. **`src/adt/features.ts`** — pass `{ probe: true }` to the 6 startup GETs (lines 111, 260, 285, 350,
   405, 422). For 111 and 350 the call has no headers arg → `client.get(url, undefined, { probe: true })`.
3. **`src/adt/discovery.ts`** — pass `{ probe: true }` to the line-35 GET (keeps its contextual warn).

### P0 — tests

- **`tests/unit/adt/http.test.ts`** — mirror the existing "logs expected 404s at debug" test: assert a
  `{ probe: true }` GET logs the `http_request` event at `debug` for **both** a 404 and a **400**
  (the 400 is the case `suppressNotFoundLog` can't cover); and that a plain GET (no opts) still logs WARN.
- **`tests/unit/adt/features.test.ts`** — assert the probe loop / probeTextSearch pass `probe: true`
  (spy on `client.get` mock and check the 3rd arg), so a future refactor can't silently drop it. Match
  whatever mocking style features.test.ts already uses.

### P1 — docs: healthy-startup reference + scope/OAuth troubleshooting

- **`docs_page/log-analysis.md`** — new "What a healthy startup looks like" section: paste the real
  transcript above (post-fix: the probe misses are gone from default WARN; show the INFO green-light
  lines + `Authorization probe: … is available`). State plainly: those two probe lines = SAP perms OK;
  a `… denied —` / `… not available —` line, or a `403`, = check `S_DEVELOP` / `S_ADT_RES`. Add a short
  "OAuth scope troubleshooting" note: stale DCR/xsuaa cache → re-login / incognito; role collection must
  be assigned under the **correct IdP** (e.g. `--of-idp sap.custom`, not `sap.default`).
- **`docs_page/btp-cloud-foundry-deployment.md`** — link to the new section ("After deploy, confirm a
  healthy startup → see Log Analysis").

### P2 — docs: BAS-only deploy path + quickstart `--insecure`

- **`docs_page/btp-cloud-foundry-deployment.md`** — short "Deploy entirely from BAS (no local dev env)"
  subsection: clone/`git pull` the repo in a BAS dev space, `mbt build`, `cf deploy` — the path a non-dev
  admin can follow without a local toolchain.
- **`docs_page/quickstart.md:37`** — show `--insecure` as an actual flag in the verify command block,
  not only in prose. **Verified live:** a bare `--insecure` does NOT work — `getFlag()` in `config.ts`
  needs a following value, and `resolveBool` only enables on `'true'`/`'1'`, so `--insecure` alone (or
  followed by another `--flag`) resolves to *false* and a self-signed cert still fails with `fetch
  failed`. Tested against `https://a4h…:50001`: `--insecure true` → preflight succeeds; bare
  `--insecure` (last arg) → `fetch failed`. Doc must show `--insecure true`. (Manuel was right.)

### Out of scope (P3, separate PR)

`application-logs` service is deprecated; make it optional via `mta-overrides.mtaext` and/or plan
AMS / cloud-logging. Tracked separately.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- **Live re-capture** on a4h (758) and a4h-2025 (816): the 5–6 probe WARNs disappear from default log
  output; the `Authorization probe: … is available` INFO lines remain. This is the definitive check.

## Phase-1 exit gate

- [x] Exact endpoints + live response **content** (404/400 bodies) captured on 758 **and** 816
- [x] Behavior is ARC-1-internal logging (no ADT contract change); classifier semantics read in full
- [x] Per-release: verified identical pattern on 758 + 816; fix is release-invariant by construction
- [x] Every affected file listed (http.ts, features.ts, discovery.ts, 2 test files, 3 docs)
- [x] Findings written here with cited evidence
