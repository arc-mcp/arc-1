# BTP CI Communication APIs — ATC (`SAP_COM_0901`) and AUnit (`SAP_COM_0735`)

Stand: 2026-08-17  
Scope: contract for a **headless** ARC-1 client. No live calls in this dossier.  
Source of truth: open `SAP/jenkins-library` (`master` as of this date), steps
`abapEnvironmentRunATCCheck` and `abapEnvironmentRunAUnitTest`, plus
`pkg/abaputils/osl.go`. Piper is a **contract reference only** — do not vendor
the archived `SAP/project-piper-action`.

These APIs are **not** the existing IDE ADT surfaces:

| | IDE (already in ARC-1) | CI Communication API (this work) |
|---|---|---|
| ATC | `POST /sap/bc/adt/atc/worklists` → `POST /atc/runs?worklistId=` → `GET /atc/worklists/{id}` (`runAtcCheck`) | `POST /sap/bc/adt/api/atc/runs?clientWait=false` |
| AUnit | `POST /sap/bc/adt/abapunit/testruns` (`runUnitTests`) | `POST /sap/bc/adt/api/abapunit/runs` |
| Auth | developer / PP / OAuth | Communication Arrangement **Basic** service key |
| Object set | one ADT object URI | package / package tree / software component |

Do **not** extend `runAtcCheck` / `runUnitTests`. Put the CI client in a new
module. Product-neutral: no customer system names, packages, or brands in
ARC-1 code or this dossier's examples beyond SAP's own `/DMO/` fixtures.

Plan: [`docs/plans/2026-08-17-btp-ci-quality-integration.md`](../plans/2026-08-17-btp-ci-quality-integration.md).

## 1. Communication scenarios

| Scenario | Piper step | CSRF probe | Start | Result Accept |
|---|---|---|---|---|
| `SAP_COM_0901` — ABAP Test Cockpit Test Integration | `abapEnvironmentRunATCCheck` | `GET …/api/atc/runs/00000000000000000000000000000000` | `POST …/api/atc/runs?clientWait=false` | Checkstyle |
| `SAP_COM_0735` — Software Component Test Integration | `abapEnvironmentRunAUnitTest` | `GET …/api/abapunit/runs/00000000000000000000000000000000` | `POST …/api/abapunit/runs` | JUnit |

`SAP_COM_0510` is deprecated and must not be used for this client. Historical
Piper issue [#1833](https://github.com/SAP/jenkins-library/issues/1833) shows a
wrong base URL concatenating a git-pull path onto the ATC CSRF probe — treat
the Communication Arrangement URL as a **fixed origin**, never join it onto
another ADT collection.

Service-key shape (Basic): `{ "scenario_id": "SAP_COM_0901"|"SAP_COM_0735", "type": "basic" }`.
CI uses `SAP_URL` / `SAP_USER` / `SAP_PASSWORD` from that key. Browser OAuth
(`SAP_BTP_SERVICE_KEY_FILE`) is the interactive developer path and is **out of
scope** for these actions.

## 2. SAP_COM_0901 — ATC

Source: `cmd/abapEnvironmentRunATCCheck.go`.

### 2.1 CSRF

```
GET {origin}/sap/bc/adt/api/atc/runs/00000000000000000000000000000000
X-CSRF-Token: fetch
Accept: application/vnd.sap.atc.run.v1+xml
```

Read `X-Csrf-Token` from the response (Piper uses `Header.Get("X-Csrf-Token")`).
Keep the cookie jar from this GET for the POST.

**ARC-1 gotcha:** `AdtHttpClient.fetchCsrfToken()` uses `HEAD /sap/bc/adt/core/discovery`.
A Communication User for `SAP_COM_0901` typically has **no** discovery collection.
The CI client must fetch CSRF from the dummy-run URL above, not from discovery.
Do not fall back to the interactive user JWT if that probe fails.

### 2.2 Start

```
POST {origin}/sap/bc/adt/api/atc/runs?clientWait=false
X-Csrf-Token: <token>
Content-Type: application/vnd.sap.atc.run.parameters.v1+xml; charset=utf-8;
```

`clientWait=false` is mandatory — the client polls. Attribute name is
`checkVariant` (camelCase). `check_variant` 500s ([#2211](https://github.com/SAP/jenkins-library/issues/2211)).

Default variant when omitted: `ABAP_CLOUD_DEVELOPMENT_DEFAULT`.

Optional attribute: `configuration="…"`.

POST body (legacy `obj:` object set, still built by `getATCObjectSet`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<atc:runparameters xmlns:atc="http://www.sap.com/adt/atc"
                   xmlns:obj="http://www.sap.com/adt/objectset"
                   checkVariant="ABAP_CLOUD_DEVELOPMENT_DEFAULT">
  <obj:objectSet>
    <obj:softwarecomponents>
      <obj:softwarecomponent value="Z_TEST"/>
    </obj:softwarecomponents>
    <obj:packages>
      <obj:package value="Z_TEST" includeSubpackages="false"/>
      <obj:package value="Z_TEST_TREE" includeSubpackages="true"/>
    </obj:packages>
  </obj:objectSet>
</atc:runparameters>
```

POST body (OSL `multiPropertySet`, preferred; Piper `BuildOSLString`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<atc:runparameters xmlns:atc="http://www.sap.com/adt/atc"
                   xmlns:obj="http://www.sap.com/adt/objectset"
                   checkVariant="MY_TEST" configuration="MY_CONFIG">
  <osl:objectSet xsi:type="multiPropertySet"
                 xmlns:osl="http://www.sap.com/api/osl"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <osl:package name="Z_TEST"/>
    <osl:package name="Z_TEST_TREE" includeSubpackages="true"/>
    <osl:softwareComponent name="Z_TEST"/>
    <osl:softwareComponent name="/DMO/SWC"/>
  </osl:objectSet>
</atc:runparameters>
```

Expect `Location` on success. Piper treats HTTP 400 as a hard start failure.

### 2.3 Polling

Follow the **validated** `Location` (see §5) with:

```
GET {origin}{location}
Accept: application/vnd.sap.atc.run.v1+xml
```

Status document: root `<run status="…">` with `<link href="…">` children
(Piper `Run` / `Link`). Interval: **5s**. Piper loops **forever** — ARC-1 must
bound this (I5).

| Status | Action |
|---|---|
| `Running` | sleep, poll again |
| `Not Yet Started` | sleep, poll again |
| `Completed` | take `link[0].href` as the result path |
| `Aborted` | fail (`ATC run was aborted`; Piper #5793) |
| `Not Created` | fail |
| empty | fail (not an ABAP ATC run, or start never happened) |
| anything else | fail (`unexpected status`) |

On `Completed`, empty `link[]` must fail closed (Piper indexes `[0]` and would panic).

### 2.4 Checkstyle result

```
GET {origin}{resultHref}
x-csrf-token: <token>
Accept: application/vnd.sap.atc.checkstyle.v1+xml
```

Keep the XML **verbatim** as `reportXml`. Also parse:

```xml
<checkstyle>
  <file name="testFile">
    <error message="testMessage1" source="sourceTester" line="1" severity="error"/>
    <error message="testMessage2" source="sourceTester" line="2" severity="info"/>
  </file>
</checkstyle>
```

Piper severities: `error` | `warning` | `info`. `failOnSeverity` fails the step
when any finding is at least that level (`error` implies error-only; `warning`
implies error+warning; `info` implies all three). Empty `<checkstyle/>` is a
successful empty run, not an error.

Piper also special-cases a body that starts with a space as “software component
not cloned”. Surface that as a typed error; do not treat it as Checkstyle.

## 3. SAP_COM_0735 — AUnit

Source: `cmd/abapEnvironmentRunAUnitTest.go`.

### 3.1 CSRF

```
GET {origin}/sap/bc/adt/api/abapunit/runs/00000000000000000000000000000000
X-CSRF-Token: fetch
Accept: application/vnd.sap.adt.api.abapunit.run-status.v1+xml
```

Same cookie-jar rule as ATC. Same “do not use discovery CSRF” rule.

### 3.2 Start

```
POST {origin}/sap/bc/adt/api/abapunit/runs
X-CSRF-Token: <token>
Content-Type: application/vnd.sap.adt.api.abapunit.run.v1+xml; charset=utf-8;
```

No `clientWait` query in Piper. Body is OSL-only (no legacy `obj:` builder).

Piper requires a non-empty `title`. Default `context` is
`ABAP Environment Pipeline`. For ARC-1 use a generic title/context
(e.g. title `ARC-1 AUnit run`, context `ARC-1`) — not a customer pipeline name.

Options defaults (all `true` when omitted):

| Element | Attributes |
|---|---|
| `aunit:measurements` | `type="none"` unless configured |
| `aunit:scope` | `ownTests`, `foreignTests` |
| `aunit:riskLevel` | `harmless`, `dangerous`, `critical` |
| `aunit:duration` | `short`, `medium`, `long` |

Fixture from Piper tests:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<aunit:run title="AUnit Test Run" context="ABAP Environment Pipeline"
           xmlns:aunit="http://www.sap.com/adt/api/aunit">
  <aunit:options>
    <aunit:measurements type="none"/>
    <aunit:scope ownTests="true" foreignTests="true"/>
    <aunit:riskLevel harmless="true" dangerous="true" critical="true"/>
    <aunit:duration short="true" medium="true" long="true"/>
  </aunit:options>
  <osl:objectSet xsi:type="multiPropertySet"
                 xmlns:osl="http://www.sap.com/api/osl"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <osl:softwareComponent name="/DMO/REPO"/>
  </osl:objectSet>
</aunit:run>
```

### 3.3 Polling

Follow validated `Location` with:

```
GET {origin}{location}
Accept: application/vnd.sap.adt.api.abapunit.run-status.v1+xml
```

Status lives on `<aunit:progress status="…"/>` (Piper `Progress.Status`), not
on `<run status>`. Result href is the single `atom:link/@href`
(`AUnitLink.Href`). Interval: **10s**. Again unbounded in Piper — ARC-1 bounds it.

| Status | Action |
|---|---|
| `Completed` | take `link.href` |
| `FINISHED` | take `link.href` (Piper accepts both) |
| `Not Created` | fail |
| empty | fail |
| other (including implied `Running`) | sleep, poll again |

Piper does **not** treat AUnit `Aborted` as a terminal error (unlike ATC).
ARC-1 should treat `Aborted` as failure anyway (fail closed; I3). Missing href
on a completed run is also fail-closed.

### 3.4 JUnit result

```
GET {origin}{resultHref}
x-csrf-token: <token>
Accept: application/vnd.sap.adt.api.junit.run-result.v1+xml
```

Keep XML verbatim as `reportXml`. Parse `<testsuites>` attributes:
`title`, `system`, `client`, `executedBy`, `time`, `timestamp`, `failures`,
`errors`, `skipped`, `asserts`, `tests`, plus nested `testsuite` / `testcase` /
`failure` / `error` / `skipped`.

Piper `evaluateResults`: fail when `errors > 0` **or** `failures > 0`. Skipped
tests do not fail the step. Empty testcase list is success (XML still persisted).

## 4. Content-Types and Accept

| Step | Header | Value |
|---|---|---|
| ATC CSRF GET | Accept | `application/vnd.sap.atc.run.v1+xml` |
| ATC POST | Content-Type | `application/vnd.sap.atc.run.parameters.v1+xml; charset=utf-8;` |
| ATC poll GET | Accept | `application/vnd.sap.atc.run.v1+xml` |
| ATC result GET | Accept | `application/vnd.sap.atc.checkstyle.v1+xml` |
| AUnit CSRF GET | Accept | `application/vnd.sap.adt.api.abapunit.run-status.v1+xml` |
| AUnit POST | Content-Type | `application/vnd.sap.adt.api.abapunit.run.v1+xml; charset=utf-8;` |
| AUnit poll GET | Accept | `application/vnd.sap.adt.api.abapunit.run-status.v1+xml` |
| AUnit result GET | Accept | `application/vnd.sap.adt.api.junit.run-result.v1+xml` |

Do not let discovery MIME negotiation override these. Pass them as explicit
`extraHeaders` / `contentType` on `http.get`/`http.post`.

## 5. Location validation (I6 / SSRF)

Piper does `details.URL = abapEndpoint + location` with **no** checks. ARC-1
must not.

After POST (and after poll completion):

1. Require a non-empty `Location` / `href`.
2. Parse against the configured SAP origin (`new URL(value, origin)`).
3. Rebuild a canonical form (`protocol//host/pathname?search`) and require:
   - same origin as `SAP_URL` (scheme + host + port),
   - path starts with `/sap/bc/adt/api/atc/` (ATC) or `/sap/bc/adt/api/abapunit/` (AUnit),
   - no `..` segments, no backslashes, no userinfo.
4. Subsequent GETs use `pathname + search` only, never a caller-supplied host.

This is the R8 class of bug (string-match vs parsed host). Absolute
`https://evil.example/…` Locations must be refused.

## 6. Object sets — package, package tree, software component

Piper documents two layers. ARC-1 v1 implements the **documented OSL
multiPropertySet** for both APIs (packages, packagetrees, softwarecomponents).
Do not expose owners / object-type filters / MPS kitchen-sink in v1.

| Tool input | OSL XML |
|---|---|
| `packages: ["ZFOO"]` | `<osl:package name="ZFOO"/>` |
| `packageTrees: ["ZFOO"]` | `<osl:package name="ZFOO" includeSubpackages="true"/>` |
| `softwareComponents: ["/DMO/SWC"]` | `<osl:softwareComponent name="/DMO/SWC"/>` |

Piper warning (keep in tool description): specifying **both** packages and
software components is a logical **AND**. Prefer one dimension.

Require at least one of the three lists, non-empty after trim. Bound length
(I5): cap each list (recommend 50) and each name (recommend 40; allow `/` for
namespaces). Charset: ABAP object-name safe (`A-Z0-9_/` after uppercasing).
Escape every name with `escapeXmlAttr` at the XML sink (Piper concatenates raw
names — do not copy that).

Legacy ATC `obj:package includeSubpackages` is equivalent to package vs
package tree. OSL is enough; no need to emit `obj:` unless a live system
rejects OSL (then a follow-up, not v1).

## 7. Timeouts, abort, empty runs

| Knob | Piper | ARC-1 v1 |
|---|---|---|
| ATC poll interval | 5s | 5s |
| AUnit poll interval | 10s | 10s |
| Poll timeout | **none** | required; default 600s; clamp 30s–1800s |
| Abort | ATC: fail; AUnit: ignored | fail both |
| Empty Checkstyle / empty JUnit tests | success | success + `findingCount: 0` / `tests: 0` |
| HTTP 400 on start | fail | fail with SAP body (minimal-errors still applies) |

Sleep in a bounded loop (`maxAttempts = ceil(timeout/interval)`). Honour
`AbortSignal` so a cancelled MCP call stops polling. Do not hold an ADT lock
(these APIs are not lock/modify/unlock).

## 8. Credential and logging rules (I4)

Aligned with [`docs/security-model.md`](../security-model.md) I4/I6/I7 and the
plan's credential model.

- Credentials enter only via env / service-key file **outside** git
  (`SAP_URL`, `SAP_USER`, `SAP_PASSWORD`). Never inline JSON, never copy a
  service key into the repo, never log it.
- `redactSensitive` already covers `password`, `token`, `cookie`,
  `authorization`, `secret`, `csrf`. Do not log `X-Csrf-Token`,
  `Authorization`, or `Cookie` headers. Do not put them on `AdtApiError`.
- Do not log the CSRF dummy URL with a Basic userinfo prefix.
- Request XML may be logged at **debug** after redaction; it contains package
  names, not secrets. Result XML can contain source snippets — do not log the
  full `reportXml` at info; return it in the tool result and let the caller
  persist it to a gitignored path / CI artifact.
- JUnit `executedBy` is a technical Communication User; include it in the
  structured summary, not in stderr at info.
- These actions are workload-producing **reads** (POST that looks like a
  read). Map policy like the existing IDE actions: `SAPDiagnose.atc_ci` →
  `read` / `OperationType.Read`; `SAPDiagnose.unittest_ci` → `read` /
  `OperationType.Test`. They do **not** go through `allowedPackages` (I1 is
  for mutations). SAP-side authorizations on the Communication User remain
  the real ACL.
- Do not widen identity on CSRF/start failure (I3). No OAuth fallback.
- Admin ceiling: no new write flag. Optional later: a deny-action
  `SAPDiagnose.atc_ci` / `SAPDiagnose.unittest_ci` already falls out of
  `ACTION_POLICY` once the rows exist.

Piper logs the full ATC request body at **info** and the response body at
info/debug. Do not copy that.

## 9. Tool / CLI contract (for the next implementation step)

Actions: `SAPDiagnose.action = atc_ci | unittest_ci`.

Shared inputs: `packages`, `packageTrees`, `softwareComponents`, `timeoutSeconds`.

ATC-only: `variant` (default `ABAP_CLOUD_DEVELOPMENT_DEFAULT`), `configuration`,
`failOnSeverity` (`error` \| `warning` \| `info`).

AUnit-only: `title`, `context`, `ownTests` / `foreignTests`, risk/duration
booleans, `evaluateResults` (default true for CLI/CI, false unless set for
interactive MCP so a red suite is still inspectable).

Outputs (JSON text result):

```json
{
  "status": "completed",
  "durationMs": 0,
  "fail": false,
  "summary": {},
  "findings": [],
  "tests": [],
  "reportXml": "<?xml …>"
}
```

CLI: `arc1-cli call SAPDiagnose --json '{…}' --output json`. Non-zero exit when
`fail === true` or the run errors. Workflows run ATC and AUnit as **separate
processes** because the Communication Users differ.

## 10. Implementation file list

Prompt 4 (client + unit tests, no tool-schema change):

| File | Role |
|---|---|
| `src/adt/ci-quality.ts` | CSRF-on-dummy-UUID, start, Location check, bounded poll, result GET; `checkOperation` first |
| `src/adt/ci-quality-xml.ts` | OSL builder (`escapeXmlAttr`), Checkstyle + JUnit parsers, status XML |
| `tests/unit/adt/ci-quality.test.ts` | mocked `undici`; XML fixtures; Location/timeout/abort |
| `tests/fixtures/xml/atc-ci-run-status.xml` | poll documents |
| `tests/fixtures/xml/atc-ci-checkstyle.xml` | Checkstyle |
| `tests/fixtures/xml/aunit-ci-run-status.xml` | `FINISHED` + atom link |
| `tests/fixtures/xml/aunit-ci-junit.xml` | testsuites |

Prompt 5 (tool surface — separate commit):

| File | Role |
|---|---|
| `src/handlers/diagnose.ts` | `atc_ci` / `unittest_ci` cases |
| `src/handlers/schemas.ts` | Zod enum + inputs (`looseOptionalBoolean`) |
| `src/handlers/tools.ts` | JSON Schema + description lines |
| `src/authz/policy.ts` | `SAPDiagnose.atc_ci`, `SAPDiagnose.unittest_ci` |
| `src/cli.ts` / `src/cli-args.ts` | only if a shortcut or fail-exit helper is needed; prefer `call` |
| `tests/unit/handlers/lint-diagnose.test.ts` or `diagnose-ci.test.ts` | handler routing |
| `tests/unit/handlers/tool-definitions-snapshot.test.ts` + `tests/fixtures/tool-definitions/*.json` | freeze LLM surface (`vitest -u`) |
| `tests/unit/cli/cli.test.ts` | `call SAPDiagnose` JSON + exit code |
| `docs/dev-guide.md`, `AGENTS.md` | one routing row |
| `docs_page/` SAPDiagnose page | operator docs, generic |
| `scripts/ci/check-file-sizes.mjs` | only if a new file exceeds the default 1500-line src budget — **do not grow `devtools.ts`** |

Do **not** touch: `runAtcCheck`, `runUnitTests`, discovery MIME maps (except if
a probe is added later), GitHub workflows (pipeline repo), or any credential
files.

## 11. Test matrix

| # | Case | Layer | Expect |
|---|---|---|---|
| T1 | OSL XML: package / package tree / software component | unit | exact Piper fixture strings; names XML-escaped |
| T2 | Empty object set refused | unit | fail before HTTP |
| T3 | `checkVariant` attribute (not `check_variant`) | unit | body contains `checkVariant=` |
| T4 | ATC CSRF GET dummy UUID + Accept | unit | path + headers; token stored |
| T5 | ATC POST `clientWait=false` + Content-Type | unit | |
| T6 | Location relative `/sap/bc/adt/api/atc/…` | unit | origin-joined |
| T7 | Location absolute other host / `..` / `\` | unit | refuse |
| T8 | Poll `Running` → `Completed` + link href | unit | one result GET |
| T9 | Poll `Aborted` / empty / `Not Created` | unit | error, no result GET |
| T10 | Poll timeout / AbortSignal | unit | stops; no infinite loop |
| T11 | Checkstyle parse + `failOnSeverity` | unit | error/warning/info matrix; empty XML `fail=false` |
| T12 | AUnit CSRF dummy UUID + Accept | unit | |
| T13 | AUnit POST body options defaults | unit | Piper fixture |
| T14 | Poll `FINISHED` and `Completed` | unit | result href |
| T15 | AUnit `Aborted` | unit | error (stricter than Piper) |
| T16 | JUnit parse; `evaluateResults` on errors/failures | unit | skipped does not fail |
| T17 | Headers never logged (Authorization, csrf) | unit | spy logger |
| T18 | `checkOperation` precedes every POST | unit | safety deny |
| T19 | Handler `atc_ci` / `unittest_ci` (Prompt 5) | unit | schema + policy |
| T20 | Tool-definition snapshot (Prompt 5) | snapshot | reviewed fixture diff |
| T21 | CLI `--json` + exit 1 when `fail` | unit | |
| T22 | Live headless smoke (Prompt 7) | live | **done**: two processes, Basic keys only; CSRF dummy UUID; poll; Checkstyle/JUnit; CLI exit 0 when `fail===false`; reports in gitignored temp. No browser / no user JWT. |

Prompt 4 shipped T1–T18. Prompt 5 shipped T19–T21. Prompt 7 closed T22.

### Live regression (focused)

Keep these as the headless live gate whenever Communication Keys exist. Use
`SAP_URL` / `SAP_USER` / `SAP_PASSWORD` from the scenario service key in **two
separate processes**. Never `SAP_BTP_SERVICE_KEY` / browser OAuth / interactive
user JWT, including as a fallback after a Basic failure.

1. `SAPDiagnose action=atc_ci` on a **transportable** package (not `$TMP`),
   variant `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. Expect `status=completed`,
   Checkstyle `reportXml`, and `fail` from `failOnSeverity` (default `error`).
   Empty Checkstyle is success.
2. `SAPDiagnose action=unittest_ci` on the same package with the
   `SAP_COM_0735` key. Expect `status=completed`, JUnit `reportXml`, and `fail`
   when `errors>0` or `failures>0` (`evaluateResults` default true; skipped
   does not fail).
3. CLI: `arc1-cli call SAPDiagnose --json … --output json`. Exit 0 when the
   payload has `fail===false`; exit 1 when `fail===true` or the tool errors.
4. Auth/API/Parser triage on failure (401/403 = Auth; 404/406/415/5xx/timeout
   = API; unparseable Checkstyle/JUnit/CLI JSON = Parser). Do not paper over
   with a developer JWT.

## 12. Open items (do not block Prompt 4)

- Live Confirm: Communication User CSRF on the dummy UUID vs 401/403 without
  ATC business catalog — **closed in Prompt 6/7** (dummy-run CSRF 200; live
  `atc_ci` / `unittest_ci` completed with Basic).
- Whether a given landscape returns ATC poll root as `<run>` vs namespaced
  `<atc:run>` — parser must accept both local names.
- Whether `Location` is already origin-absolute. Validator must accept both
  relative and same-origin absolute.
- Checkstyle `severity` vs ATC priority (P1/P2) mapping is a **pipeline**
  concern; ARC-1 reports Piper severities verbatim.
- HTML report generation in Piper is out of scope (GitHub Summary lives in
  the pipeline repo).
