# Issue #636 — on-prem create fails under Principal Propagation: `adtcore:responsible` overflows XUBNAME (CHAR12)

**Status:** ✅ **Fixed** (see [Resolution](#resolution-shipped)). Root cause validated live
2026-07-29 on **all three** on-prem releases (NW 7.50, S/4HANA 2023 / 758, ABAP Platform 2025 / 816);
fix verified the same way. Reporter's diagnosis is
correct in substance; two mechanism details need correcting, and the blast radius is larger
than reported.

**Issue:** <https://github.com/arc-mcp/arc-1/issues/636> — reporter `@Antseburov` (external).
**Ancestor:** #379 / PR #380 (`fix(write): thread logon user into adtcore:responsible`, commit
`3f8dc126`) — this issue is the mirror-image regression of that fix. Not a duplicate.

---

## TL;DR

ARC-1 emits `adtcore:responsible="<value>"` in every on-prem create body. On-prem that attribute
deserializes into `XUBNAME`, a **CHAR12** field. Under BTP Principal Propagation to an on-prem
system, ARC-1 puts the **XSUAA principal (an email, typically 20–40 chars)** into it, so the
create body fails in the object's simple transformation before anything is created — HTTP 400.

The trigger is **length > 12 only**. It is *not* the `@`, and the user does *not* have to exist.

Fixing it is not a one-liner: for **13 SAPWrite types plus DDIC** the attribute can simply be
omitted (SAP then assigns the logged-on — i.e. correctly propagated — user), but
**`SAPManage create_package` rejects an omitted value too**, so it needs a real short user name.

---

## Live validation

All commands issued as raw ADT POSTs (`curl`, basic auth), so the only variable is the
`adtcore:responsible` attribute. Bodies are byte-identical to what `buildCreateXmlBody`
produces. Test objects were created in `$TMP` and deleted afterwards.

### 1. Isolating the attribute — `POST /sap/bc/adt/oo/classes`, a4h (S/4HANA 2023, 758)

| # | `adtcore:responsible` | len | Result |
|---|---|---|---|
| A | `firstname.lastname@example.com` | 30 | **HTTP 400** `ExceptionInvalidData` — *"An error occurred when deserializing in the simple transformation program CLASS_TRANSFORMATION"*, `XML_OFFSET=466` |
| B | `MARIAN` (valid user) | 6 | HTTP 200 |
| C | *attribute omitted entirely* | – | **HTTP 200** |
| D | `A@B.DE` — has `@`, short | 6 | **HTTP 200** ← the `@` is **not** the trigger |
| E | `ABCDEFGHIJKLM` — no `@`, long | 13 | **HTTP 400** ← **length is the trigger** |
| F | `ABCDEFGHIJKL` — no `@`, nonexistent user | 12 | **HTTP 200** ← the user need not exist |

D/E/F are the decisive rows: the boundary is exactly **12 characters**, matching `XUBNAME`
(`CHAR12`). Row F also shows ADT does not validate user existence for `CLAS` on create.

### 2. Same test across releases — `POST /sap/bc/adt/oo/classes`

| Release | responsible = 30-char email | short user | omitted |
|---|---|---|---|
| **NW 7.50** (`npl`) | **400** — *"Data loss occurred when converting firstname.lastname@example.com"* | 200 | **200** |
| **S/4HANA 2023 / 758** (`a4h`) | **400** — CLASS_TRANSFORMATION | 200 | **200** |
| **ABAP Platform 2025 / 816** (`a4h-2025`) | **400** — CLASS_TRANSFORMATION | 200 | **200** |

7.50's message is the clearest statement of the root cause: **"Data loss occurred when
converting …"** — the classic ST field-truncation error. Not release-specific; every on-prem
release ARC-1 supports is affected.

### 3. Blast radius — other object types, a4h 758

| Type | endpoint | 30-char email | short user | **omitted** |
|---|---|---|---|---|
| CLAS | `/oo/classes` | 400 `CLASS_TRANSFORMATION` | 200 | **200** ✅ |
| PROG | `/programs/programs` | 400 `SEDI_ADT_PROGRAM` | 200 | *(n/t)* |
| INTF | `/oo/interfaces` | 400 `INTF_TRANSFORMATION` | 200 | *(n/t)* |
| DOMA | `/ddic/domains` | 400 `SBD_DOMAIN` | 201 | **201** ✅ |
| **DEVC** | `/packages` | 400 `SPAK_ST_PACKAGES` | 201 | **400** ❌ *"Enter a valid user, not , as the person responsible"* |

**`DEVC` is the exception that shapes the fix.** Package create is the one type that genuinely
validates `responsible` — omitting it reproduces the exact `[?/049]` error family that #379/PR #380
was written to fix, just with an empty value. So "always omit" is **not** a safe blanket fix.

### 3b. Per-type omission spike (a4h 758) — decides the fix shape

Run with ARC-1's **own** `buildCreateXml` / `buildPackageXml` (via `dist/`), so each body is
byte-identical to what ships. Two variants per type: the 30-char email, and the same body with the
attribute stripped.

| type | simple transformation | email (30) | **omitted** |
|---|---|---|---|
| PROG | `SEDI_ADT_PROGRAM` | 400 | **200** ✅ |
| CLAS | `CLASS_TRANSFORMATION` | 400 | **200** ✅ |
| INTF | `INTF_TRANSFORMATION` | 400 | **200** ✅ |
| INCL | `SEDI_ADT_INCLUDE` | 400 | **200** ✅ |
| DOMA | `SBD_DOMAIN` | 400 | **201** ✅ |
| DTEL | `SBD_DATAELEMENT` | 400 | **201** ✅ |
| TABL | `SADT_BLUE_SOURCE` | 400 | **201** ✅ |
| TTYP | `SDDIC_ADT_TTYP` | 400 | **201** ✅ |
| DDLS | `SDDIC_ST_ADT_DDLS` | 400 | **201** ✅ |
| SRVD | `SDDIC_ADT_SRVD_ST` | 400 | **201** ✅ |
| **DEVC** | `SPAK_ST_PACKAGES` | 400 | **400** ❌ |

**Eleven distinct simple transformations** reject the over-long value — this is a systemic
attribute-level constraint, not a quirk of one handler. Omission is safe for every type **except
`DEVC`**.

> Method note: the first spike run reported OMIT failures for INTF/INCL/TABL. Those were artifacts
> of the spike itself — name collisions with the PROG/CLAS objects created moments earlier, and a
> DDIC rule (*"Underscore not permitted at 2nd or 3rd position"*) rejecting the generated table
> name. Re-run with unique, type-legal names: INTF `ZIF_I636B` → 200, INCL `Z_I636BINC` → 200,
> TABL `ZI636BTAB` → 201. Recorded because a `400`/`422` here reads like a product defect and isn't.

**Not covered:** `DCLS`, `BDEF`, `SRVB`, `DDLX` — each needs a prerequisite object (a CDS entity /
root view / service definition) to create at all. Each shares a template family with a tested type
(DCLS/DDLX/BDEF use the same generic source-object template as DDLS; SRVB uses
`buildServiceBindingXml`, the same builder family as SRVD), and all eleven tested STs behave
identically, so the fix is uniform by construction. Flagged rather than assumed.

### 3c. `DEVC` validates that the user *exists*

| `responsible` | result |
|---|---|
| `ABCDEFGHIJKL` — CHAR12-legal, **nonexistent** | **400** *"Enter a valid user, not ABCDEFGHIJKL, as the person responsible"* |
| `DDIC` — exists, not the caller | **201** |
| `MARIAN` — the caller | **201** |

So package create needs a **real, existing** ≤12-char user. It cannot be satisfied by a synthetic
placeholder, and there is no on-prem whoami to derive it from (§5) — which is why the `responsible`
parameter has to become usable on-prem.

### 4. What the attribute actually does on-prem (CLAS)

Reading back `ZCL_I636_F_LEN12` (created with `responsible="ABCDEFGHIJKL"`):

```
<class:abapClass … adtcore:responsible="MARIAN" … adtcore:createdBy="ABCDEFGHIJKL" …>
  <class:include class:includeType="main" … adtcore:createdBy="ABCDEFGHIJKL"/>
```

SAP sets the object's real `responsible` from the **logged-on user** regardless of what we send;
the transmitted value only lands in the class's `createdBy`. And with the attribute **omitted**
(`ZCL_I636_C_OMITTED`), the object came back `adtcore:responsible="MARIAN"` — the logged-on user.
Under PP the logged-on user *is* the correctly propagated principal, so omission is not merely
tolerated, it produces the **right** owner.

### 5. No on-prem "whoami" endpoint

Probed on 758/7.50: `/sap/bc/adt/core/systeminformation` → 404, `/sap/bc/adt/security/users/current`
→ 404. `/sap/bc/adt/system/users` → 200 but returns a **value-help list of all developers**, not
the session's identity; `core/discovery` carries no user attribute. So the propagated short user
cannot be looked up directly — see the fix notes for the proven alternative.

### 6. SAP Notes

No applicable Note. This is a client-side defect (ARC-1 sending an over-long value), not a SAP
regression. Note **2093502** documents the same generic ST-overflow signature in an unrelated
context and is useful only as corroboration of the mechanism.

---

## Root cause

Confirmed at HEAD (`c60da36`).

`normalizeAdtResponsible` passes any email through verbatim and has no length bound:

```ts
// src/adt/ddic-xml.ts:169-174
export function normalizeAdtResponsible(responsible?: string): string {
  const r = (responsible ?? '').trim();
  if (!r) return 'DEVELOPER';
  // Cloud (BTP) users are email-style and case-sensitive; classic SAP users are upper-case.
  return r.includes('@') ? r : r.toUpperCase();
}
```

The `@`-branch was written for **BTP**, where email-style names are correct. But on the BTP path
the attribute is stripped from the body anyway (`cloudifyCreateBody`,
[write-helpers.ts:358-374](../../../src/handlers/write-helpers.ts#L358)), so that branch's only
live effect today is on **on-prem-reached-via-PP**, exactly where it is wrong.

### Correction 1 — the email arrives via `config.username`, not the `getEffectiveUser()` fallback

The issue states that under PP `config.username` is unset, so
`create.ts:469 config.username || (await client.getEffectiveUser())` falls through to
`getEffectiveUser()`. **It does not.** `createPerUserClient` decodes the JWT and assigns it:

```ts
// src/server/server.ts:344
displayUsername = payload.user_name ?? payload.email ?? undefined;
// src/server/server.ts:404 (in applyPerUserAuthTokens)
adtConfig.username = displayUsername;
```

So under PP `config.username` **is** set — to the email — and the `||` takes its *first* branch.
Same outcome, but a fix aimed only at `getEffectiveUser()` would miss the issue entirely.

### Correction 2 — length, not `@`, is the trigger

Rows D/E/F above. The reporter's proposed guard `r.includes('@') || r.length > 12` is *sufficient*
(every failing value is long), but the `@` half never fires independently on-prem. Keep the length
check as the load-bearing condition; do not document `@` as the cause.

### Correction 3 — metadata **updates** are affected too, not only creates

The issue says `action="update"` works. That holds for **source** updates only. Metadata updates
are full-XML-replace and rebuild the same body:

```ts
// src/handlers/write/update-delete.ts:142
const responsible = config.username || (await client.getEffectiveUser());
const body = buildCreateXml(type, name, pkg, description, mergedProps, config.language, responsible, …);
```

So `SAPWrite(action="update")` on a DDIC/metadata type (DOMA, DTEL, TABL, SRVB, TTYP, …) fails the
same way under PP.

---

## Affected files

| File | What |
|---|---|
| [src/adt/ddic-xml.ts:169](../../../src/adt/ddic-xml.ts#L169) | `normalizeAdtResponsible` — the defect |
| [src/adt/ddic-xml.ts](../../../src/adt/ddic-xml.ts) | 5 builders emit the attribute: `buildDomainXml`, `buildTableTypeXml`, `buildDataElementXml`, `buildPackageXml`, `buildServiceBindingXml` |
| [src/handlers/write-helpers.ts:395](../../../src/handlers/write-helpers.ts#L395) + templates | `buildCreateXmlBody` — **13 types** emit it: PROG, CLAS, INTF, INCL, DDLS, DCLS, TABL(/DT,/DS), BDEF, SRVD, SRVB, DDLX, DOMA, TTYP, DTEL (`MSAG`, `FUGR` never did) |
| [src/handlers/write/create.ts:469](../../../src/handlers/write/create.ts#L469) | single create — call site |
| [src/handlers/write/create.ts:757](../../../src/handlers/write/create.ts#L757) | `batch_create` — call site |
| [src/handlers/write/update-delete.ts:142](../../../src/handlers/write/update-delete.ts#L142) | metadata UPDATE — call site (Correction 3) |
| [src/handlers/manage.ts:134](../../../src/handlers/manage.ts#L134) | `create_package` on-prem uses `config.username` directly — the `DEVC` special case |
| [src/handlers/tools.ts:1418](../../../src/handlers/tools.ts#L1418) / [schemas.ts:984](../../../src/handlers/schemas.ts#L984) | `responsible` param — currently documented **"BTP only"**; the on-prem PP fix likely needs it on-prem too |
| tests | `tests/unit/adt/ddic-xml.test.ts:191-200` asserts today's email-passthrough — must be updated, not just extended |

---

## Recommended fix shape

Two parts. The reporter's patch covers part 1 only.

**1. Types where omission is correct (everything except `DEVC`).** Return `''` when the value
cannot be a valid on-prem user name (`length > 12`) and emit the attribute conditionally. Live-proven
on 7.50/758/816 to succeed *and* yield the correct owner. Note the reporter's proposed `cloud`
parameter is **not needed** — `cloudifyCreateBody` already strips the attribute on the BTP path;
adding a second cloud branch would duplicate that logic. Consider dropping the `'DEVELOPER'`
fallback in the same change: omitting beats a literal that only exists on SAP demo systems, and it
retires the #379 bug class permanently rather than relocating it.

**2. `SAPManage create_package` on-prem under PP.** Needs a real ≤12-char XUBNAME; there is no
whoami endpoint. The proven pattern already exists in this codebase for BTP: create an object, read
`adtcore:createdBy` back, cache it (`client.noteInternalUser` / `getInternalUser`,
[create.ts:505-509](../../../src/handlers/write/create.ts#L505), [client.ts:1497](../../../src/adt/client.ts#L1497)).
On-prem the same trick works because object create **succeeds** with the attribute omitted. Failing
that, un-gate the existing `responsible` param for on-prem and return a directed error, mirroring
the current BTP message.

**Regression guard:** the unit test at `ddic-xml.test.ts:197-200` currently *asserts* the buggy
behavior (`normalizeAdtResponsible('marian@zeis.de')` → passthrough). Any fix must flip it, and
should add a `DEVC`-omission test so part 2 cannot silently regress into the `[?/049]` error.

## Out of scope

- BTP / ABAP Cloud object create — already correct (`cloudifyCreateBody` strips the attribute).
- BTP package create — separately solved, see `docs/research/2026-06-27-btp-package-create-solved.md`.
- The PP auth path itself. The reporter's Cloud Connector X.509 evidence is consistent with
  everything observed; nothing here indicates an auth defect.

---

## Draft GitHub reply (do not post automatically)

```markdown
Confirmed — and thank you for an unusually well-researched report. The ICM-trace body and the
A/B isolation made this fast to validate. Reproduced live on **all three** on-prem releases,
not just 758.

**Repro (raw ADT POSTs, only `adtcore:responsible` varies), `POST /sap/bc/adt/oo/classes`:**

| `adtcore:responsible` | len | 7.50 | 758 | 816 |
|---|---|---|---|---|
| `firstname.lastname@example.com` | 30 | 400 | 400 | 400 |
| short user | 6 | 200 | 200 | 200 |
| *omitted* | – | **200** | **200** | **200** |

On 7.50 the message names the mechanism outright: *"Data loss occurred when converting
firstname.lastname@example.com"* — the ST truncation error. Your CHAR12 diagnosis is right.

**Three refinements from the live runs:**

1. **The trigger is length, not `@`.** `A@B.DE` (6 chars, has `@`) → **200**; `ABCDEFGHIJKLM`
   (13 chars, no `@`) → **400**; `ABCDEFGHIJKL` (12 chars, not even a real user) → **200**. The
   boundary is exactly 12. Your guard `includes('@') || length > 12` works, but only the length
   half ever fires on-prem.

2. **The email arrives via `config.username`, not the `getEffectiveUser()` fallback.** Under PP,
   `createPerUserClient` decodes the JWT and assigns it as a display name
   (`server.ts:344` → `server.ts:404 adtConfig.username = displayUsername`), so
   `create.ts:469` takes its *first* branch. Same outcome — worth flagging because a fix aimed
   only at `getEffectiveUser()` wouldn't help.

3. **Metadata `update` is affected too.** `update-delete.ts:142` rebuilds the same body for
   full-XML-replace, so `SAPWrite(action="update")` on DOMA/DTEL/TABL/SRVB/TTYP fails the same
   way. Source updates are fine, which is what you observed.

**One thing that changes the fix**, and the reason this isn't a one-liner: **`create_package`
rejects an omitted `responsible` as well.**

| type | 30-char email | short user | omitted |
|---|---|---|---|
| CLAS / PROG / INTF / DOMA | 400 | 200 | **200** ✅ |
| **DEVC** (`/sap/bc/adt/packages`) | 400 `SPAK_ST_PACKAGES` | 201 | **400** — *"Enter a valid user, not , as the person responsible"* |

That's the same `[?/049]` family that #379 was filed for, so blanket-omitting would just move the
bug. Package create needs a real ≤12-char XUBNAME, and there's no on-prem whoami endpoint
(`core/systeminformation` and `security/users/current` are both 404; `system/users` returns a
value-help list of *all* developers). The likely resolution reuses the pattern ARC-1 already has
for BTP — create an object with the attribute omitted, read `adtcore:createdBy` back, cache it
(`noteInternalUser`) — which works on-prem precisely because object create succeeds without the
attribute.

Also worth noting your proposed `cloud` parameter isn't needed: `cloudifyCreateBody`
(`write-helpers.ts:358-374`) already strips `adtcore:responsible` on the BTP path, so a second
cloud branch would duplicate that.

Confirmed also that omitting yields the **right** owner, not a blank one — the object came back
`adtcore:responsible="<logged-on user>"`, which under PP is the correctly propagated principal.

Full dossier with all captured response bodies:
`docs/research/issues/636-onprem-pp-responsible-char12-overflow.md`. Queued for a fix — the
scope is 13 `SAPWrite` types plus `SAPManage create_package`, across create, `batch_create`, and
metadata update.
```

---

## Resolution (shipped)

Fixed on branch `claude/deep-issue-636-ebea7d`; plan in
[`docs/plans/2026-07-29-issue-636-onprem-responsible-char12.md`](../../plans/2026-07-29-issue-636-onprem-responsible-char12.md).

`normalizeAdtResponsible` now returns `''` for anything that cannot be an on-prem user name
(empty, `>12` chars, or containing `@`), and every builder emits the attribute conditionally via
`adtResponsibleAttr`. `SAPManage create_package` keeps requiring a real user and returns a directed
error naming the `responsible` parameter.

The `'DEVELOPER'` fallback was dropped in the same change — it is a demo-system-only literal, it is
the same defect class, and omitting is live-proven better.

**Post-fix live verification** — `config.username` set to `firstname.lastname@example.com` (the PP
shape) with the session authenticated by cookie, driven through `arc1-cli` so the whole ARC-1 path
runs, on every supported on-prem release:

| Release | create | **activate** | owner readback | delete |
|---|---|---|---|---|
| NW 7.50 (`npl`) | ✅ | ✅ | `DEVELOPER` (that system's logon user) | ✅ |
| S/4HANA 2023 / 758 (`a4h`) | ✅ | ✅ | `MARIAN` | ✅ |
| ABAP Platform 2025 / 816 (`a4h-2025`) | ✅ | ✅ | `MARIAN` | ✅ |

`create_package` with the same identity returns the directed error in 2 ms (no SAP round-trip), and
succeeds when `responsible="MARIAN"` is passed.

> **Verification note.** An earlier round of this check was invalid: a `.env` in the worktree was
> supplying `SAP_USER`, so `config.username` was a valid short name and the omit path never ran.
> The runs above set `SAP_USER` to the email with no password (cookies carry the session) and run
> from a directory with no `.env` — confirmed by `SAPRead(type="SYSTEM")` reporting the email as
> the user. Recorded because the passing result looked identical either way.

**Bug caught in review, not by tests.** Rewriting the templates initially left the BTP package body
emitting `adtcore:version="active"adtcore:responsible="…"` — glued attributes, malformed XML. The
existing test used `toContain('adtcore:responsible="CB9980000000"')`, which matches happily either
way. Fixed, and `tests/unit/adt/create-xml-wellformed.test.ts` now asserts structurally that no
generated create body glues two attributes together, across all 14 builder types × cloud/on-prem ×
responsible present/omitted.

## Recommendation

**Done.** Fixed as described in [Resolution](#resolution-shipped). The `DEVC` design decision went
to un-gating the `responsible` parameter on-prem (rather than the createdBy-cache), because package
create validates that the user *exists* and the cache costs a GET per create while cold.

*Validated 2026-07-29 against `npl` (7.50), `a4h` (S/4HANA 2023 / 758), `a4h-2025` (816). All
test objects created during validation were deleted.*
