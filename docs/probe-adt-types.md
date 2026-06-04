# Diagnostic probe: ADT type availability

A diagnostic tool that tells you, for any reachable SAP system, which ADT object types (TABL, DDLS, BDEF, SRVD, …) are actually available — **and how much you can trust that answer**. It is intentionally diagnostic-only: ARC-1's runtime behavior is not driven by probe output.

## Motivation

GitHub issue [#162](https://github.com/marianfoo/arc-1/issues/162) asks for a way to keep the LLM from speculating about types that don't exist on the connected system (e.g. `BDEF` on NW 7.50). The obvious fix is a hardcoded SAP_BASIS → type-list table. That is brittle: add-ons, backports, and feature toggles move the goalposts regularly, and a previous RAP-availability probe ([PR #93](https://github.com/marianfoo/arc-1/pull/93) → reverted by [PR #96](https://github.com/marianfoo/arc-1/pull/96)) burned us after a single-signal check blocked legitimate writes.

This probe takes the opposite approach:

- **Multi-signal.** Discovery map + collection GET + known-object GET + release floor. No single source can force a verdict.
- **Conservative classification.** Only HTTP `404` counts as a hard "not found". `400/403/405/500` mean "endpoint is there, the request just wasn't right" — the `#94/#95` regression lesson is baked into [`src/probe/runner.ts`](../src/probe/runner.ts).
- **Self-assessing.** In addition to per-type verdicts, the tool reports *quality metrics* (coverage per signal, discovery-vs-known-object agreement, catalog blind spots, ambiguous cases) so you can see how much the probe's answers should be trusted on your system.

## Running it

```bash
# Uses TEST_SAP_* if present, falls back to SAP_* from .env
npm run probe

# Save fixtures so others can replay your run
npm run probe -- --save-fixtures tests/fixtures/probe/my-system

# JSON for programmatic consumers
npm run probe -- --format json --output probe-report.json

# Limit to a subset of types
npm run probe -- --types BDEF,SRVD,DDLS
```

Env is read from `.env`. `TEST_SAP_URL`/`TEST_SAP_USER`/`TEST_SAP_PASSWORD` take precedence over `SAP_URL`/`SAP_USER`/`SAP_PASSWORD` so you can point the probe at a dedicated scratch system without touching your dev config.

### Cookie-based authentication

For systems that front ADT with SSO / SAML / MFA (where username + password won't authenticate directly), use a session cookie instead. Grab a live session cookie from the browser after you've logged in, then:

```bash
# Either: Netscape-format cookie file (exported via a browser extension)
SAP_COOKIE_FILE=/path/to/cookies.txt npm run probe

# Or: inline "k=v; k=v" header string
SAP_COOKIE_STRING='MYSAPSSO2=...; sap-contextid=...' npm run probe
```

When cookies are set, `TEST_SAP_USER` / `TEST_SAP_PASSWORD` are optional.

## Reading the output

```
TYPE   VERDICT               DISCO COLLECTION             KNOWN          RELEASE     REASON
-------------------------------------------------------------------------------------------
TABL   AVAILABLE (high)      Y     ok-400-bad-params 400  OK(T000)       758>=700    known-object read of "T000" returned 200; discovery confirms
BDEF   AVAILABLE (high)      Y     ok-400-bad-params 400  —              758>=754    discovered + collection HTTP 400
FEATURE_TOGGLE  AVAILABLE (medium) N  ok-400-bad-params 400  —              758>=752    collection HTTP 400 but not in discovery map
```

| Column | Meaning |
|---|---|
| `VERDICT` | One of: `available-high`, `available-medium`, `unavailable-high`, `unavailable-likely`, `auth-blocked`, `ambiguous` |
| `DISCO` | Does the ADT discovery document list this collection? `Y`/`N`/`—` (no discovery doc). Free, always present on real systems. |
| `COLLECTION` | Outcome of `GET <collection>`. `ok-400-bad-params` is the expected response for most "list without filters" calls and proves the endpoint *exists*. |
| `KNOWN` | Outcome of reading a known SAP-shipped object (e.g. `T000` for TABL). `OK(X)` beats everything else — the endpoint *works*. `—` means no fixture is seeded in the catalog (a blind spot). |
| `RELEASE` | Detected `SAP_BASIS` vs. the hand-curated floor for that type. Weak tie-breaker only. |
| `REASON` | One-line explanation of how the verdict was reached. |

### When to worry

- **`ambiguous`** — signals disagree. Treat as "don't rely on this type until you've verified manually".
- **Discovery vs known-object mismatch in quality block.** Example: the probe may report 90% agreement, meaning one type was absent from discovery but its known object still served a 200. That's a real-world discovery incompleteness, not a probe bug — the output flags it so the LLM can discount discovery as the sole signal.
- **`No known-object fixture (probe blind spot): …`** — the catalog has no SAP-shipped object seeded for those types, so one of the four signals is missing. Contributing fixture names for these types (see below) is the single highest-leverage improvement.

### Why verdicts are split into "high" and "medium"

- `available-high`: discovery and collection both agree, *or* a known-object read returned 200.
- `available-medium`: collection responded in an endpoint-exists way, but discovery didn't list it. Common on older systems where the discovery doc is incomplete. Type is almost certainly available; signal quality is just lower.
- `unavailable-high`: discovery miss + collection `404` + no known object + release below floor. Four-way unanimous negative.
- `unavailable-likely`: `404` with weaker corroboration.

## Fixtures: record once, replay forever

`--save-fixtures <dir>` persists every HTTP response to disk:

```
tests/fixtures/probe/<system-name>/
  meta.json                     # baseUrl, client, abapRelease, products[], discovery keys
  responses/
    GET__sap_bc_adt_ddic_tables.json
    GET__sap_bc_adt_ddic_tables_T000.json
    ...
```

`meta.json` captures the full installed-components list under `products[]` (e.g. `SAP_BASIS 758`, `S4FND 108`, `SAP_CLOUD ...`). This matters: SAP_BASIS alone does not distinguish plain NetWeaver 7.58 from S/4HANA 2023 on 7.58, but `S4FND 108` does. Name your fixture directory after the product line **and** edition (`s4hana-2023-onprem-abap-trial`, `abap-platform-2025-onprem-trial`, `nw-752-sp18-prod`, `btp-abap-2604`) rather than just the BASIS level — trial / developer-edition systems often behave differently from production-licensed ones at the same SP, so that distinction belongs in the directory name.

These fixtures are read back by [`tests/unit/probe/replay.test.ts`](../tests/unit/probe/replay.test.ts) via `createReplayFetcher(dir)`. No SAP connection needed; the unit tests guarantee the classifier keeps making the right decisions on the recorded bytes forever.

### Why there's a `synthetic-752` fixture next to the real ones

Real-system fixtures are rich but non-exhaustive — a given SAP system may never emit the HTTP 400 "valid endpoint, bad params" response or the uniform 401/403 "auth blocked" pattern. The hand-crafted `synthetic-752` fixture deterministically covers every decision branch in [`classifyVerdict`](../src/probe/runner.ts), most importantly the `ok-400-bad-params` path which is the [#94 / #95 regression guard](https://github.com/marianfoo/arc-1/pull/96) against classifying HTTP 400 as "unavailable". Keep it even as real fixtures accumulate — it's the branch-coverage fixture, not a redundant sample.

### How to contribute a fixture set from your own system

1. Run `npm run probe -- --save-fixtures tests/fixtures/probe/<name>` against your SAP. Use the product-line + edition naming convention introduced above — e.g. `s4hana-2023-onprem-abap-trial`, `ecc-ehp8-nw750-sp31-onprem-prod`, `btp-abap-2604`. Just `nw-750-sp18` is too coarse: it hides whether the system is trial / dev-edition / productive ERP, which often matters for the verdicts.
2. Eyeball the generated `meta.json` and `responses/*.json`. Make sure nothing sensitive leaked (bodies are truncated, but double-check — SAP error payloads sometimes echo URLs or user names).
3. Add a new test case in [`tests/unit/probe/replay.test.ts`](../tests/unit/probe/replay.test.ts) asserting the verdicts you expect for *your* system.
4. Open a PR. Each fixture set strengthens the regression guard around `classifyVerdict`.

## What the probe does *not* do

- It does **not** change product behavior. No SAPWrite is blocked based on probe output; no catalog filter is applied; no tool is hidden. The explicit design lesson from [PR #96](https://github.com/marianfoo/arc-1/pull/96) is *fail open, report only*.
- It does **not** enumerate actual objects on the system. The known-object reads are a handful of well-known SAP-shipped fixtures (T000, ABAP_BOOL, MANDT, …), not an inventory.
- It does **not** persist state between runs beyond fixture files you explicitly ask for.
