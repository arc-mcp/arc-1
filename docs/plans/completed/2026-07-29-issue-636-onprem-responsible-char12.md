# Plan (DONE) — #636: omit `adtcore:responsible` when it cannot be an on-prem user name

**Evidence base:** [`docs/research/issues/636-onprem-pp-responsible-char12-overflow.md`](../research/issues/636-onprem-pp-responsible-char12-overflow.md)
— live-verified 2026-07-29 on NW 7.50, S/4HANA 2023 (758), ABAP Platform 2025 (816).

**Status:** delivered 2026-07-29. All tasks done, incl. live create+activate+delete on 7.50 / 758 /
816 with a PP-shaped identity. One extra guard added during review:
`tests/unit/adt/create-xml-wellformed.test.ts` (a glued-attribute bug in the BTP package body that
`toContain` could not see).

## Goal

Object create/update stops failing on on-prem systems reached via BTP Principal Propagation, where
the XSUAA principal is an email and `adtcore:responsible` maps to `XUBNAME` (`CHAR12`).

## Verified facts this plan rests on

| Fact | Evidence |
|---|---|
| Trigger is **length > 12**, not `@`, and the user need not exist | `A@B.DE`→200, `ABCDEFGHIJKLM`→400, `ABCDEFGHIJKL`(nonexistent)→200 on 758 |
| **11 distinct create STs** reject an over-long value | CLASS_TRANSFORMATION, SEDI_ADT_PROGRAM, SEDI_ADT_INCLUDE, INTF_TRANSFORMATION, SBD_DOMAIN, SBD_DATAELEMENT, SADT_BLUE_SOURCE, SDDIC_ADT_TTYP, SDDIC_ST_ADT_DDLS, SDDIC_ADT_SRVD_ST, SPAK_ST_PACKAGES |
| Omitting the attribute **succeeds and yields the correct owner** | 10/10 non-DEVC types 200/201; readback `adtcore:responsible="<logged-on user>"` |
| **`DEVC` is the exception** — omitting → 400, and it validates user *existence* | `""`→400, `ABCDEFGHIJKL`→400, `DDIC`→201 |
| No on-prem whoami endpoint | `core/systeminformation` 404, `security/users/current` 404, `system/users` = value-help list |
| Under PP the email arrives via **`config.username`** | `server.ts:344` → `server.ts:404` |
| Cloud path already strips the attribute | `cloudifyCreateBody`, `write-helpers.ts:358-374` |

## Design

**One predicate.** A value usable as an on-prem `adtcore:responsible` is: non-empty, ≤12 chars, no
`@`. Everything else normalizes to `''` and the attribute is **omitted**, letting ADT assign the
logged-on user — which under PP is the correctly propagated one.

Omitting is safe even when the value *would* have been valid (a real user named `A@B` still ends up
as the object owner, because they are the logged-on user). So the predicate can be strict without
risk on the omit path.

**`DEVC` opts out** of omission — it requires a real existing user. Its fix is the existing
`responsible` parameter, un-gated for on-prem, plus a directed error.

**Deliberate extra:** drop the `'DEVELOPER'` fallback. It is a demo-system-only literal that #379
was filed against, and it is the same defect class (a value that is not a valid user on this
system). Live-proven that omitting beats it. Called out explicitly in the PR — it is the one
behavior change beyond the reported symptom.

**Rejected:** adding a `cloud` parameter to `normalizeAdtResponsible` (the reporter's suggestion) —
`cloudifyCreateBody` already strips the attribute on the BTP path; a second cloud branch would
duplicate it. Also rejected: auto-learning the on-prem user via the `createdBy` cache — it costs a
GET per create while cold and is not load-bearing once `responsible` works on-prem.

## Tasks

### 1. `src/adt/ddic-xml.ts` — the predicate
- Rewrite `normalizeAdtResponsible` to return `''` for empty / `>12` / contains `@`; upper-case otherwise.
- Rewrite the docstring around the XUBNAME CHAR12 constraint and #636; drop the `DEVELOPER` narrative.
- The 5 builders (`buildDomainXml`, `buildTableTypeXml`, `buildDataElementXml`, `buildPackageXml`,
  `buildServiceBindingXml`) interpolate a prebuilt attribute snippet that is `''` when unusable —
  no empty `adtcore:responsible=""` in any output.

### 2. `src/handlers/write-helpers.ts` — conditional emission
- `buildCreateXmlBody`: derive `responsibleAttr` once from `responsibleUser`; replace all ~15
  template sites. No behavior change when the value is valid.
- Leave `cloudifyCreateBody` alone (its regex already tolerates a missing attribute).

### 3. `src/handlers/manage.ts` — the `DEVC` path
- On-prem: `responsibleArg || normalizeAdtResponsible(config.username)`.
- Guard: when the resolved value is unusable, return a directed error naming the `responsible`
  parameter and explaining the PP case — mirroring the existing BTP message shape.

### 4. `src/handlers/tools.ts` + `schemas.ts` — surface
- `responsible` description currently says *"BTP only"*; it now also applies to on-prem under PP.
  Three-file sync: `tools.ts` (JSON Schema), `schemas.ts` (Zod), handler.
- Regenerate `tests/fixtures/tool-definitions/*.json` (`vitest -u`) and review the diff.

### 5. Tests
- Flip `ddic-xml.test.ts:191-200` — it currently *asserts* the buggy email passthrough and the
  `DEVELOPER` default.
- Add: 13-char and email values omit the attribute; 12-char passes; lower-case still upper-cased.
- Add: `buildCreateXml` omits the attribute for a PP-shaped email across a source type and a DDIC type.
- Add: `manage.ts` on-prem package create returns the directed error when `config.username` is an email.
- Add: metadata **update** path (`update-delete.ts`) omits it too.

### 6. Live verification (mandatory)
- Create + **activate** a CLAS on 758 with the fixed builder; activation is the definitive check.
- Re-run the per-type matrix against the built `dist/` and confirm every type now emits no
  `adtcore:responsible` for an email-shaped user.
- Repeat the CLAS create on 7.50 and 816.

## Out of scope
- The PP auth path itself; `config.username` stays the display name (`SAPRead SYSTEM` depends on it).
- BTP/cloud create and BTP package create — already correct.
- `DCLS`/`BDEF`/`SRVB`/`DDLX` live coverage — each needs a prerequisite object; they share template
  families with tested types and are fixed by the same one-line predicate.
