# Issue #343 — `SAP_LANGUAGE=DE` ignored by hard-coded `EN` in create metadata

**Status:** Implemented & live-verified. Fix threads `config.language` into all create-XML builders.

> **Post-fix verification (a4h 7.58, real fixed binary, `SAP_LANGUAGE=DE`, German labels):** DTEL `ZARC1_FIXDT` → `DD04L.DTELMASTER=D`, `DD04T.DDLANGUAGE=D`, `TADIR.MASTERLANG=D`. DOMA `ZARC1_FIXDO` → `DD01L.DOMMASTER=D`, `DD01T.DDLANGUAGE=D`, `TADIR.MASTERLANG=D`. All consistent; split-brain gone; German texts filed under `D`. (Before the fix the same path produced `DTELMASTER=E`/`DD04T=E`.)
**Systems used:** A4H S/4HANA 2023 (kernel 7.58, HANA) `a4h.marianzeis.de:50000`; NPL NetWeaver 7.50 SP02 (ASE) `npl.marianzeis.de`.
**Date:** 2026-06-04.

> Infrastructure note: the lab host moved from `65.109.59.210` to **`176.9.72.62`** (`sap-fsn1`); the A4H container is now **`a4h-2023`** (HANA schema `SAPA4H`), and a second system **`a4h-2025`** runs on ports `50100/50101` (different credentials — not used here). `INFRASTRUCTURE.md` still lists the old IP/container name and should be refreshed.

---

## 1. Verdict

The bug reported in [#343](https://github.com/arc-mcp/arc-1/issues/343) is **real on modern S/4HANA**, but the reporter's *mechanism* and *affected-type list* are both partly wrong. The corrected picture:

1. **Two different "master language" values exist** and are written from **two different inputs**:
   - The **per-object DDIC master language** (`DD04L-DTELMASTER` for data elements, `DD01L-DOMMASTER` for domains) is taken from the **XML body** `adtcore:masterLanguage`.
   - The **repository directory** `TADIR-MASTERLANG` is taken from the **`sap-language` URL parameter** (which ARC-1 already sets correctly from `config.language`).
2. For **DTEL and DOMA**, the per-object master language *also drives which language bucket the texts/labels are filed under* (`DD04T`/`DD01T` `DDLANGUAGE`). So the hard-coded `EN` body causes a German shop's German labels to be **mis-filed as English**, and creates a `DTELMASTER/DOMMASTER = E` vs `TADIR.MASTERLANG = D` **split-brain**. This is a genuine data-correctness bug. **(HIGH severity.)**
3. For **source/container objects (PROG, and by the same mechanism CLAS/INTF/FUGR/INCL/…)** the master language is read from `TADIR` (the URL param). The body `adtcore:masterLanguage` is **ignored/cosmetic** — these objects already get the correct language today. **(Cosmetic only.)**
4. The bug is **handler/version-specific**: it reproduces on the **v2 DDIC handler (S/4HANA 7.58)**. On **NW 7.50 (v1 handler)** the body `masterLanguage` is ignored and the object correctly takes the URL language — so 7.50 is **not** affected.

The reporter is nevertheless right that **the fix is to thread the configured language into the create XML** instead of hard-coding `EN`. That fix is correct for the buggy types and harmless (consistency-improving) for the cosmetic ones.

---

## 2. Methodology

All ADT object creation goes through ARC-1's HTTP layer, which appends `sap-language=<config.language>` to **every** request (`src/adt/http.ts:1095`) for both shared and per-user clients (`buildAdtConfig` sets `language: config.language` unconditionally — `src/server/server.ts:187`). The create XML body is built by `buildDataElementXml`/`buildDomainXml`/`buildServiceBindingXml` (`src/adt/ddic-xml.ts`) and `buildCreateXml` (`src/handlers/intent.ts`), all of which **hard-code `adtcore:masterLanguage="EN"`**.

To separate the body input from the URL input, I created objects via raw ADT REST calls varying each independently, then read the persisted truth directly from HANA (`SAPA4H` schema) via `hdbsql`, and finally reproduced the exact ARC-1 behavior with the **real compiled binary** (`dist/cli.js call SAPWrite`).

Confirmed prerequisite: **German (`D`) is installed** on A4H (`DD04T` for standard `BUKRS` has both `E` "Company Code" and `D` "Buchungskreis"; `BUKRS` `TADIR.MASTERLANG = D`). `TADIR.MASTERLANG` stores the **1-char** SAP code (`E`/`D`); ADT `adtcore:masterLanguage` uses the **2-char** ISO code (`EN`/`DE`); SAP converts internally.

---

## 3. Decisive experiment (DTEL on A4H 7.58, v2 handler)

Three data elements, varying body `adtcore:masterLanguage` and URL `sap-language` independently, then read back from HANA:

| Object | body `masterLanguage` | URL `sap-language` | `DD04L.DTELMASTER` (per-object / Eclipse-visible) | `TADIR.MASTERLANG` (repo directory) |
|--------|:--:|:--:|:--:|:--:|
| LANGA = **today's ARC-1** | `EN` | `DE` | **E** | **D** |
| LANGB = **proposed fix** | `DE` | `DE` | **D** | **D** |
| LANGC | `DE` | `EN` | **D** | **E** |

- LANGA vs LANGB (same URL, different body) → only `DTELMASTER` changed → **the body drives `DTELMASTER`**.
- LANGA vs LANGC (the two inputs swapped) → `DTELMASTER` follows the body, `TADIR` follows the URL → **the two fields have independent sources.**
- Activation does **not** change either value (re-read after activate: identical).

The ADT **GET metadata** for a DTEL echoes the **body** value (`DTELMASTER`): LANGA GET returns `masterLanguage="EN"` even though `TADIR=D`. **This is exactly what the reporter "saw" in Eclipse/ADT** — the object's master language reads English.

---

## 4. Real-binary reproduction (the smoking gun)

`dist/cli.js call SAPWrite` with `SAP_LANGUAGE=DE`, creating a DTEL with German labels (`Echter Test` / `Kurz` / `Mittel` / `Lang` / `Kopf`), then activate, then HANA read:

```
ARC-1 response: adtcore:masterLanguage="EN"  adtcore:language="DE"
HANA after activation:
  DD04L.DTELMASTER  = E      ← from hard-coded body masterLanguage="EN"
  DD04T.DDLANGUAGE  = E   ("Echter Test", "Kurz", …)   ← German texts mis-filed as ENGLISH
  TADIR.MASTERLANG  = D      ← from sap-language=DE URL param
```

So with the **real, unmodified ARC-1** and `SAP_LANGUAGE=DE`:
- the data element's own master language is **English**,
- the **German labels are stored under the English language key**, and
- `TADIR` disagrees (German).

ARC-1's DTEL create does a **follow-up label PUT that reuses the same hard-coded body** (`src/handlers/intent.ts:4122-4132`), which is why the German labels land under `E`.

**Fix confirmation:** creating with body `masterLanguage="DE"` (+ `sap-language=DE`) yields `DTELMASTER=D` and `TADIR=D` (object `ZARC1_FIXED`, and LANGB above). The text bucket follows the per-object master language (established by the real-binary run above where text language == `DTELMASTER`), so body=`DE` → texts under `D`. *(End-to-end "German labels land under `D`" with a successful label PUT is the headline acceptance test for the implementation phase.)*

---

## 5. DOMA is also genuinely affected; PROG (source objects) is not

**DOMA (A4H 7.58), body=`EN`, URL=`DE`, after activation:**
```
DD01L.DOMMASTER  = E
DD01T.DDLANGUAGE = E   ("Doma Test")   ← German description mis-filed as ENGLISH
TADIR.MASTERLANG = D
```
Same pattern as DTEL → **DOMA is genuinely buggy.** (Note: the DOMA ADT *GET* echoes `masterLanguage="DE"` from `TADIR`, which is misleading — the persisted `DOMMASTER` and text language are `E`.)

**PROG (A4H 7.58), body=`EN`, URL=`DE`:**
```
ADT GET echo    : masterLanguage="DE"
TADIR.MASTERLANG: D
TRDIRT (title)  : SPRSL = D   ← title correctly under German
```
→ **PROG ignores the body `masterLanguage`; it follows `sap-language`/`TADIR`. Cosmetic only.** Source/container objects (CLAS, INTF, FUGR, INCL) work the same way: their original language lives only in `TADIR`.

**Why the difference:** DTEL/DOMA are DDIC objects with a *per-object* master-language field (`DTELMASTER`/`DOMMASTER`) plus language-keyed text tables (`DD04T`/`DD01T`). The ADT v2 create handler honors the body `masterLanguage` for that field and files the texts under it. Source objects have no such per-object field.

---

## 6. Version dependency (NPL 7.50, v1 handler)

NW 7.50 rejects the v2 DTEL content type (`415`) and requires `application/vnd.sap.adt.dataelements.v1+xml` (ARC-1 already auto-falls-back — PR #169). With v1, body `masterLanguage="EN"` + `sap-language=DE`:
```
create 201; ADT GET echo: masterLanguage="DE"
```
→ On **7.50 the body is ignored** and the object takes the URL language. **7.50 is not affected.** The bug is specific to the **v2 DDIC handler on S/4HANA** — the primary modern target, consistent with the reporter's environment.

---

## 7. SAP Notes corroboration

The "original language vs text language" mismatch is a recognized, consequential problem class:
- **2408957** "Wrong language used in data elements" — field labels in German even when logged on in English.
- **3659876** "Activation for data element may delete texts in original language" — DTEL original language is tied to text persistence.
- **3382553 / 3031206 / …** multiple "Correction of original language" notes for individual data elements — SAP itself ships corrections when a DTEL's original language was set wrong.

These confirm `DTELMASTER`/original-language is a real attribute with downstream impact on label language and translation — exactly the field ARC-1 mis-sets to `EN`.

---

## 8. External client behavior & SAP doc (reference)

**SAP is explicit that the master language = logon language, not `EN`.**

- **SAP ABAP doc — "Original Language" guideline** (`ABENORIGINAL_LANGU_GUIDL`): *"When a repository object is created … its original language must be specified. This is specified implicitly by the current logon language … When a repository object is created, its original language is the logon language."* → https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENORIGINAL_LANGU_GUIDL.html
- **SAP Note 727896** — documents this *exact* defect: DDIC objects (a domain, several `TABL`s, a `DEVC`) ended up with the wrong original language because they "have not been developed in logon language DE"; SAP's correction reset the original language to German. This is the arc-1 bug, named by SAP.
- **SAP Note 1433092** — DDIC objects have a per-object original language distinct from modification language; texts are filed per language (matches the `DD04T`/`DD01T` `DDLANGUAGE` behavior observed here).

**Reference clients:**

| Client | How it sets create master language | Takeaway |
|---|---|---|
| **abapGit** (ABAP, reference impl) | repo main language = `sy-langu` (logon); deserialize/create **blocked unless logon == main language**; sets `TADIR-MASTERLANG` from it; DTEL via `DDIF_DTEL_PUT`/`dd04v`, DOMA via `DDIF_DOMA_PUT`/`dd01v` keyed by `ddlanguage` | **logon language** (enforced) — validates the fix |
| **vibing-steampunk** (Go) | **omits** `masterLanguage`/`language` from the POST body → SAP applies logon-language default | logon language (by omission) |
| **abap-adt-api** (TS) | `masterLanguage = options.masterLanguage \|\| options.language \|\| "EN"` — caller param, **defaults EN**, never auto-threads logon language | opt-in; EN default |
| **fr0ster/mcp-abap-adt-clients** (TS) | hard-codes `adtcore:language="EN"` + `adtcore:masterLanguage="EN"` across DOMA/TABL/CLAS/… | **same anti-pattern as arc-1** |

The authoritative consensus (SAP docs + Note 727896 + abapGit) is **master language = logon/session language**. ARC-1 already sends that as `sap-language=config.language`; the body must match it. Two valid implementations: set the attributes to `config.language` (Eclipse/abap-adt-api style — chosen here, and empirically proven by LANGB/`ZARC1_FIXED`), or omit them entirely (vibing-steampunk style). Setting explicitly is more deterministic and is what the fix does.

**adt-ls / sapse.adt-vscode:** SAP's ABAP language server is closed-source; it drives the same ADT REST endpoints under the hood, so the documented logon-language semantics above govern it too. No code-level inspection possible.

---

## 9. ARC-1 affected code

All create-XML builders hard-code `EN`. Full inventory (the issue lists only 7 of these):

**`src/adt/ddic-xml.ts`**
| Builder | Type | Line | Severity |
|---|---|---|---|
| `buildDomainXml` | DOMA | `:171` `masterLanguage="EN"` | **Genuine (texts mis-filed)** |
| `buildDataElementXml` | DTEL | `:246` `masterLanguage="EN"` | **Genuine (texts mis-filed)** — headline |
| `buildServiceBindingXml` | SRVB | `:323-324` `language="EN"`+`masterLanguage="EN"` | Cosmetic (metadata type; not individually verified) |

**`src/handlers/intent.ts` `buildCreateXml`**
| Type | Line | Severity |
|---|---|---|
| PROG | `:2885` | Cosmetic (verified) |
| CLAS | `:2897` | Cosmetic (source object) |
| INTF | `:2909` | Cosmetic (source object) |
| INCL | `:2921` | Cosmetic (source object) |
| DDLS | `:2933` | Cosmetic (source object) |
| DCLS | `:2945` | Cosmetic (source object) |
| TABL/DT/DS | `:2963` | Cosmetic (source-based; not individually verified) |
| BDEF | `:2978` | Cosmetic (source object) |
| SRVD | `:2990` | Cosmetic (source object) |
| DDLX | `:3023` | Cosmetic (source object) |
| FUGR | `:3101` `language="EN"`+`masterLanguage="EN"` | Cosmetic (container) |

**Inline SKTD builder** in `handleSAPWrite`: `src/handlers/intent.ts:4039` `language="EN"`+`masterLanguage="EN"`.

**Not affected (no language attribute — do NOT add one):** MSAG (`buildMessageClassXml`), DEVC (`buildPackageXml`), FUNC (inherits from parent FUGR).

**Reuse paths that inherit the fix automatically:** for `isMetadataWriteType` = {DOMA, DTEL, MSAG, SRVB} (`src/handlers/intent.ts:2550`), `buildCreateXml` is reused for **create**, the **DTEL/MSAG follow-up label PUT** (`:4122-4145`), and **metadata UPDATE** (`:3819-3838`). Three `buildCreateXml` call sites: update `:3827`, create `:4087`, batch_create `:5202`.

---

## 10. Root cause & correct fix

**Root cause:** the create-XML builders hard-code `adtcore:masterLanguage="EN"` (and `adtcore:language="EN"` for SRVB/FUGR/SKTD) instead of deriving from the configured language. On the S/4HANA v2 DDIC handler this sets `DTELMASTER`/`DOMMASTER`=`E` and files texts under English, contradicting `sap-language=DE`.

**Fix:** thread the configured language into the builders. **`config.language` is the correct single source of truth** — it is exactly what `buildAdtConfig` uses for the `sap-language` URL param on every client (shared and PP), so the body will always match the URL. `config` is already in scope in `handleSAPWrite`; **no `AdtClient` property and no `withSafety()` change is needed** (the issue's suggestion to expose it from the client would introduce a clone hazard for nothing).

- Add `language?: string` to `DomainCreateParams` / `DataElementCreateParams` / `ServiceBindingCreateParams`; emit `adtcore:masterLanguage="${escapeXml((language||'EN').trim().toUpperCase())}"` (and `adtcore:language` where present).
- Add a `language` parameter to `buildCreateXml(...)` and replace every literal `"EN"` with it; default `'EN'` preserves today's behavior when `SAP_LANGUAGE` is unset.
- Pass `config.language` from the three `buildCreateXml` call sites and into the inline SKTD body.

**Regression risk: low.** Default-`EN` is preserved, so existing builder unit tests that pass no language still hold (e.g. the FUGR test asserting `masterLanguage="EN"`). KTD-envelope and read-side `masterLanguage` fixtures are inputs, unaffected.

---

## 11. Recommended scope, acceptance tests, open items

**Scope:** apply the fix to **all** builders (matches the issue's "broader fix" and fixes the Eclipse-visible echo for every type), but **focus acceptance on DTEL + DOMA** (the only genuinely buggy types).

**Acceptance (run on A4H 7.58 with `SAP_LANGUAGE=DE`):**
1. Create DTEL with German labels → assert `DD04L.DTELMASTER='D'`, `DD04T.DDLANGUAGE='D'`, `TADIR.MASTERLANG='D'` (all German, no split-brain). *This is the headline test.*
2. Create DOMA with German description → assert `DD01L.DOMMASTER='D'`, `DD01T.DDLANGUAGE='D'`, `TADIR.MASTERLANG='D'`.
3. Default (`SAP_LANGUAGE` unset → `EN`) → builders still emit `masterLanguage="EN"`.
4. Unit: each builder with `language:'DE'` emits `masterLanguage="DE"`; without it, `"EN"`.

**Open / not individually verified:** SRVB and TABL persistence behavior (classified cosmetic by analogy; fix is harmless either way). NW 7.50 is unaffected (v1 ignores the body) so the fix is a no-op there.

**Cleanup:** all test objects created during this research (`ZARC1_LANGA/B/C`, `ZARC1_REAL1`, `ZARC1_FIXED`, `ZARC1_DOMALANG`, `ZARC1_PROGLANG` on A4H; `ZARC1_NPLLANG` on NPL) were deleted.
