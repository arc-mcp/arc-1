# NW 7.50: can ARC-1 create the open-rfc beta fixtures?

**Date:** 2026-07-29 · **Systems:** `npl.marianzeis.de` (NW 7.50 SP02), `a4h.marianzeis.de` (S/4HANA 2023, 758)

Review of the claim in `~/DEV/open-rfc/docs/netweaver-beta-fixture-installation.md`:

> ARC-1 can perform read-only source/interface/activation checks after installation, but its current
> NetWeaver ADT surface cannot safely create every required domain, transparent table, or
> Remote/V1 function property.

**Verdict: all three "cannot create" clauses are correct as written**, but they are not the same kind
of thing. Domains and transparent tables are hard ADT-on-7.50 restrictions (the endpoints do not
exist). The Remote/V1 function property is **not** a 7.50 restriction at all — ADT sets it fine on
7.50; ARC-1 simply never sends it. The read-only half of the sentence is over-optimistic in one
specific way (see §5).

Everything below is verified live on both systems (throwaway `$TMP` objects, deleted and confirmed
404 afterwards).

---

## 1. Domains — hard restriction (ADT endpoint absent on 7.50)

`/sap/bc/adt/ddic/domains` does not exist before SAP_BASIS 7.52.

| System | `GET /sap/bc/adt/ddic/domains/XFELD` |
|---|---|
| npl 7.50 SP02 (live, 2026-07-29) | **404** `ExceptionResourceNotFound` |
| ECC EhP8 / 7.50 SP31 prod (probe fixture) | **404** |
| a4h 758 / 816 | 200 |

Also recorded in `docs/integration-test-skips.md`: *"/ddic/domains endpoint not available on this
release"* — DOMA CRUD skipped on NW 7.50–7.51, needs ≥ 7.52.

`ZORFC_D_DEC15_2` and `ZORFC_D_FLTP` therefore cannot be created by ARC-1 on 7.50, and neither can
the data elements that reference them until the domains exist. SE11 is the only route.

**ARC-1 gap:** unlike TABL and TTYP, there is no discovery gate for DOMA — `objectBasePath('DOMA')`
routes straight to `/sap/bc/adt/ddic/domains/` and the caller gets a bare 404 instead of a hint.
See `src/handlers/object-types.ts:379`, `src/handlers/feature-cache.ts:64` (tables/tabletypes only).

## 2. Transparent table — hard restriction, and ARC-1 already refuses it by design

`GET /sap/bc/adt/ddic/tables/T000/source/main` → **404 on both 7.50 systems**, 200 on 758/816.

ARC-1 refuses the write deliberately (`TABL_DT_WRITE_UNAVAILABLE_HINT`,
`src/handlers/write-helpers.ts:1127`, applied at `write.ts:179` and `write/create.ts:859`):

> …/sap/bc/adt/ddic/tables/ is not exposed — NW 7.50/7.51 ship the DDIC structures endpoint only;
> the table editor was added in NW 7.52. … Writing the source via /sap/bc/adt/ddic/structures/
> would silently flip DD02L-TABCLASS to INTTAB and corrupt the table.

That hazard is real and specific: on 7.50 `/sap/bc/adt/ddic/structures/T000/source/main` **does**
return the transparent table's DDIC source (verified live). A naive create/update through that URL
would produce a structure where `ZORFC_BETA_TX` should be. The runbook's "not safely" is the right
word.

*(The 7.52 cutoff is ARC-1's documented claim; independently verified here only as absent ≤ 7.50 and
present ≥ 7.58. The `synthetic-752` probe fixture is synthetic and is not evidence.)*

## 3. Remote-Enabled / V1 update property — ARC-1 gap, **not** an ADT restriction

SAP's own ADT model has exactly these attributes. From `com.sap.adt.functions_3.58.1.jar`,
`model/fmodules.xsd`:

```
processingType  ∈ { normal, rfc, update }
updateTaskKind  ∈ { startImmediate, immediateStartNoRestart, startDelayed, collectiveRun, unsupportedKind }
rfcScope, rfcVersion, basXMLEnabled, releaseState, releaseDate, global
```

**7.50 serves them on read** (live, npl):

| FM | attributes |
|---|---|
| `RFC_PING` | `processingType="rfc"` |
| `/SAPTRX/AOTREF_UPDATE_DB` | `processingType="update" updateTaskKind="immediateStartNoRestart"` |
| `COM_CATEGORY_TEXT_UPDATE_DB` | `processingType="update" updateTaskKind="startImmediate"` |

**Write path, verified live on both a4h 758 and npl 7.50** (throwaway `$TMP` FUGR, deleted afterwards
— all five probe objects confirmed 404 after cleanup):

| Attempt | 758 | 7.50 |
|---|---|---|
| `POST …/fmodules` with `fmodule:processingType="rfc"` in the create XML | **201 but silently ignored** — read-back `normal` | (same envelope; ARC-1's create path) |
| lock → `PUT …/fmodules/{fm}` with `processingType="rfc"` → unlock | **200**, read-back `rfc` ✅ | **200**, read-back `rfc` ✅ |
| same with `processingType="update" updateTaskKind="startImmediate"` | **200**, both persisted ✅ | **200**, both persisted ✅ |
| survives `SAPActivate` | — | ✅ active version reads `rfc` / `update`+`startImmediate` |

Both `…fmodules.v3+xml` and the unversioned `…fmodules+xml` Content-Type are accepted on 7.50 for the
PUT. **But the resource's NATIVE version is release-dependent** — a plain GET (no explicit Accept)
answers `…fmodules.v2+xml; charset=utf-8` on 7.50 and `…v3+xml` on 758, and returns the attributes
either way. So a read should negotiate rather than pin a version; pinning v3 works only because SAP
is lenient about the Accept. PR #634 reached the same conclusion for the write Content-Type and
derives it from the response/discovery instead of hardcoding.

So the property *is* settable over ADT on 7.50 — just not at create time, and ARC-1 never does it:

- `buildCreateXml('FUNC', …)` (`src/handlers/write-helpers.ts:681`) emits only
  `description` / `name` / `type=FUGR/FF` + `containerRef`. No processing type.
- `grep -rn processingType src/ tests/` → **zero hits**. ARC-1 neither sets nor reads it.

**This is purely an ARC-1 gap — one lock → PUT → unlock away — not a 7.50 restriction.**

## 4. What ARC-1 *can* do for these fixtures on 7.50 — all live-verified

Driven through the real CLI (`node dist/cli.js call SAPWrite …`) against npl, then deleted:

- **FM interface**: `TABLES`, `EXCEPTIONS`, `VALUE(...)` pass-by-value, `IMPORTING/EXPORTING/CHANGING`
  are plain source syntax and fully supported (`src/adt/fm-signature.ts`). Created
  `Z_ARC1_PROBE_RFC` with `VALUE(C_CHAR) TYPE CHAR16` + `TABLES T_TABLES LIKE …` +
  `EXCEPTIONS VALUE_TOO_LARGE` in one call, read back byte-correct. The FM signature has no
  separate metadata endpoint — `/source/main` is the only channel.
- **FUGR + FM create + activate** — ✅ (the 7.50 lock-handle 423 quirk is already handled; npl has
  the `abapfs_extensions` enhancement).
- **Data elements** — ✅ **`Created DTEL … in package $TMP`**. ARC-1's v2→v1 content-type fallback
  (`CONTENT_TYPE_FALLBACKS`, `src/adt/crud.ts:83`) does its job. The
  `docs/integration-test-skips.md` entry *"DTEL v2 content type not supported on this release"* is
  **stale** and should be removed.
- **Structures (`TABL/DS`)** — ✅ created *and activated* on 7.50 via `/ddic/structures/`, including
  `@AbapCatalog.enhancementCategory : #NOT_EXTENSIBLE` ("Cannot be enhanced").
  **Gotcha: 7.50 requires `define type <name> { … }`** — `define structure` is rejected with
  HTTP 405 *"Can't save due to errors in source"*. (7.50 also warns that the runbook's field name
  `NUMBER` is reserved: *"Do not use structure as include in DB table"*.)

## 4b. Full fixture audit — every object in the runbook

Each row driven through the real CLI against npl 7.50 unless noted. ✅ = works, ❌ = impossible,
⚠️ = works with a caveat.

| § | Artifact | 7.50 verdict | Evidence / caveat |
|---|---|---|---|
| 1 | Workbench request (unreleased) | ✅ | `SAPTransport create` → `NPLK900083`. Local request (npl has no STMS route) — fine, the runbook says don't release it |
| 1 | Packages `ZOPEN_RFC_BETA_VALUES`, `ZOPEN_RFC_BETA_V1` | ❌ | `POST /sap/bc/adt/packages` → 404 *No suitable resource found*. **The whole `/packages` resource is absent on 7.50** (both 7.50 probe fixtures; present on 758). Even `GET /packages/$TMP` 404s. SE80/SE21 only |
| 2 | Domains `ZORFC_D_DEC15_2`, `ZORFC_D_FLTP` | ❌ | `/ddic/domains` absent — §1 |
| 2 | Data elements `ZORFC_DEC15_2`, `ZORFC_FLTP` | ❌ | DTEL create itself works (§4), but both reference the domains above. A `predefinedAbapType` DTEL is fine; a domain-typed one is not |
| 2 | Structure `ZORFC_BETA_VALUE_ROW` (+ "Cannot be enhanced") | ✅ | created **and activated**; `@AbapCatalog.enhancementCategory : #NOT_EXTENSIBLE` honored. ⚠️ 7.50 needs `define type`, not `define structure`; 7.50 warns field `NUMBER` is reserved |
| 3, 6 | Function groups `ZOPEN_RFC_BETA_VALUES`, `ZORFC_BETA_V1` | ✅ | `SAPWrite type=FUGR` create + activate |
| 3, 6 | TOP includes (tracked source) | ✅ | `SAPWrite type=INCL + group=<FUGR> action=update` → *Successfully updated*; inactive draft holds the exact bytes |
| 6 | **F01 include `LZORFC_BETA_V1F01`** | ⚠️ | ARC-1 refuses (`create/delete of FUGR structural includes is unsupported`) — but **ADT supports it**: `POST /functions/groups/{g}/includes` with CT `…functions.fincludes.v2+xml` → include created on **both 7.50 and 758**. Self-imposed gap, not a platform limit. (ARC-1's INCL create routes to `/programs/includes`, which correctly refuses L-names with 500 *"reserved for function group includes"*) |
| 6 | Main program `SAPLZORFC_BETA_V1` must `INCLUDE LZORFC_BETA_V1F01` | ✅ | **SAP adds the `INCLUDE` line to the main program automatically** when the structural include is created — no main-program edit needed. Verified end-to-end on 7.50: create include → `SAPWrite type=INCL+group` source → `SAPActivate FUGR` → *Successfully activated* |
| 3, 6 | FM signatures: `VALUE()` by-value, `CHANGING`, `TABLES`, `EXCEPTIONS` | ✅ | one `SAPWrite type=FUNC` call with structured `parameters` produced the exact clause; read back byte-correct |
| 3, 6 | **Remote-Enabled Module** flag (7 FMs) | ⚠️ | ADT supports it on 7.50 (§3) — **ARC-1 does not send it**. Needs the property PUT |
| 6 | **V1 update module / Start immediately** (3 FMs) | ⚠️ | same — `processingType=update` + `updateTaskKind=startImmediate`, proven on 7.50, not wired in ARC-1 |
| 5 | Transparent table `ZORFC_BETA_TX` + technical settings | ❌ | `/ddic/tables` absent — §2. Delivery class / data class / size category / buffering / logging are all unreachable on 7.50 regardless |
| 4, 7 | Execute the self-checks (`SE37`) | ❌ | ARC-1 cannot execute function modules. `ctx.run.classRun` is classes-only, plugin-gated, and needs `SAP_ALLOW_PLUGIN_EXECUTE` |
| 8 | `PFCG` role, `S_RFC` activity 16 | ❌ | out of ADT scope entirely |

**Net:** only **two domains, one transparent table and two packages** are genuinely impossible on
7.50 (plus the SE37 executions and PFCG, which are outside ADT). The two data elements follow from
the domains. The F01 include and both FM property flags are **ARC-1 wiring gaps** — ADT does all
three on 7.50 — so they are implementable, not platform limits.

### Read-side caveat for §9 verification

`SAPRead type=FUGR` **fails on 7.50** — it goes through `/functions/groups/{g}/objectstructure`,
which 404s there (works on 758). Use `SAPRead type=FUGR expand_includes=true`, which reads
`source/main` + the includes directly and works fine on 7.50.

## 5. Correction to the runbook's read-only claim

> ARC-1 can then perform the remaining read-only post-install source/interface/activation verification

Source and activation reads: yes. Reading the transparent table `ZORFC_BETA_TX` also works on 7.50 —
`resolveTablObjectUrl` falls back to `/ddic/structures/` on 404, and that URL serves transparent
tables (verified with `T000` above).

But **ARC-1 cannot read back `processingType` / `updateTaskKind`**. `SAPRead type=FUNC` returns the
source, plus a parsed signature when `includeSignature=true` (`src/handlers/read.ts:342`); the
fmodule XML attributes are never surfaced. So the one property the runbook most needs verified after
a manual SE37 installation — Remote-Enabled vs V1 update module — is the one ARC-1 cannot confirm.
§9's completion record has to keep relying on SE37/`TFDIR`.

## 6. The DOMA error an LLM actively gets today

`SAPWrite action=create type=DOMA` on 7.50 returns a 404 **plus a hint that contradicts the request**:

```
ADT API error: status 404 at /sap/bc/adt/ddic/domains: Resource … does not exist.
Hint: Object "ZZARC1PROBED" (type DOMA) was not found. Use SAPSearch with query
      "ZZARC1PROBED" to verify the name exists and check the correct type.
```

The caller asked to *create* the object; the hint tells it the object doesn't exist and to go
searching for it. An LLM will loop. This is worse than a bare 404.

*(Historical note: this run was initially blocked by `403 "No development license for user
DEVELOPER"` on every create — system-wide, not type-specific. Fixed by the system owner on
2026-07-29; everything above was then verified live.)*

## 6b. Superseded in flight: PR #634

While this dossier was being written, [PR #634](https://github.com/arc-mcp/arc-1/pull/634) landed on
main and implemented the **FUNC `processingType`/`updateTaskKind` write** independently. It reached
the same three conclusions from its own live probes: the create POST silently ignores the attributes,
a locked metadata PUT is the only writer, and the result must be read back and asserted. It also went
further than this dossier's plan by supporting FUNC inside `batch_create` (resolving the parent
group's package per item), which the plan had scoped out as impossible.

Two deltas worth knowing:

- #634's `updateTaskKind` input enum is `startImmediate | immediateStartNoRestart | startDelayed`.
  SAP also emits `collectiveRun` on existing modules (observed live), so anything **reading** the
  attribute back must report SAP's value verbatim rather than typing it to the create enum.
- #634 hit the same tools/list wire ceiling documented below and resolved it by removing duplicated
  guidance **and** raising the wall to 72 000 (per-tool 23 000), softening the "do NOT raise" comment
  to "Trim first; raise only deliberately."

What remains unique to this line of work: the FUGR structural-include create/delete, the DOMA and
DEVC release gates, the pre-7.52 `SAPRead type=FUGR` fallback, and reading the processing attributes
back on `SAPRead includeSignature=true` (#634 writes them but does not expose a read).

## 7. What is implementable in ARC-1 — ranked

**Real capability gaps** (ADT can do it on 7.50, ARC-1 cannot):

1. **FUNC `processingType` / `updateTaskKind`** — ✅ **shipped independently as PR #634** (see §6b).
   The remaining piece is the read side: surface the attributes on `SAPRead includeSignature=true`
   so the runbook's §9 verification can confirm what was written.
   The read must not pin a media version: 7.50 serves `…fmodules.v2+xml`, 758 serves `v3` (both
   measured 2026-07-29). Let discovery negotiate.
2. **FUGR structural-include create/delete** — lift the client-side refusal in `write.ts:160-165` and
   route create to `POST /functions/groups/{g}/includes` (CT `…functions.fincludes.v2+xml`, not the
   `/programs/includes` collection ARC-1 uses today). Works on 7.50 and 758; SAP maintains the main
   program's `INCLUDE` line itself.

**Error-quality fixes** (the operation stays impossible; the message stops misleading):

3. **DOMA discovery gate** mirroring `TABL_DT_WRITE_UNAVAILABLE_HINT`. Today a create returns
   *"Object … was not found. Use SAPSearch to verify the name exists"* — actively wrong for a create,
   and an LLM will loop on it. Highest value-per-line of anything here.
4. **DEVC discovery gate** — `create_package` dies on a raw 404; `/sap/bc/adt/packages` is absent
   wholesale < 7.52.
5. **`SAPRead type=FUGR` on < 7.52** — fall back to `source/main` + includes when
   `/functions/groups/{g}/objectstructure` 404s, instead of failing the read outright.
   (`expand_includes=true` already works; the default path does not.)

**Housekeeping:**

6. **Drop the stale DTEL skip** in `docs/integration-test-skips.md` — DTEL create works on 7.50.
7. Optional: pre-write hint for DDIC structure sources on < 7.52 — `define structure` → `define type`.

**Not implementable** (no ADT surface on 7.50): domains, transparent tables, packages. And FM
*execution* (§4/§7 self-checks) is a deliberate ARC-1 boundary, not a gap.

## 8. Implementation spikes (2026-07-29) — verified contracts

Throwaway `$TMP` groups `ZZSPK750` / `ZZSPK758`, deleted and confirmed 404.

### 8.1 FM properties: GET → mutate → PUT is mandatory

A hand-built minimal envelope (root element + `containerRef` + the one attribute) is **rejected**:
`400 ExceptionInvalidData` / *"Unexpected Case in Branch"*. The working contract is to GET the
current representation, edit attributes on the root element, and PUT the body back verbatim (atom
links included) under a `MODIFY` lock. Derive the Content-Type from the GET response rather than
hardcoding a version — see the release note below.

| Case | 7.50 | 758 |
|---|---|---|
| `processingType="rfc"` | 200 → `rfc` | 200 → `rfc` (+ SAP fills `rfcScope="notClassified"`, `rfcVersion="any"`) |
| `processingType="update"` + `updateTaskKind="startImmediate"` | 200 → both set | 200 → both set |
| back to `processingType="normal"` | 200 → `normal`, `updateTaskKind` cleared by SAP | same |
| `updateTaskKind` **without** `processingType="update"` | **200 but silently ignored** | same |
| invalid value (`"bogus"`) | **400** *"Unexpected Case in Branch"* | same |

Release-invariant. Two consequences for the implementation:
- validate the enum **client-side** (SAP's 400 text is useless), and reject `updateTaskKind` unless
  `processingType="update"` (SAP swallows it silently — the classic "200 ≠ honored" trap);
- after the PUT the FM is `adtcore:version="inactive"` → the result message must say activate.

### 8.2 FUGR structural includes

`POST /sap/bc/adt/functions/groups/{g}/includes`, CT **`application/vnd.sap.adt.functions.fincludes.v2+xml`**
(the unversioned type is refused: *"Supported Media Types: …fincludes.v2+xml"*). Body is
`finclude:abapFunctionGroupInclude` + `adtcore:containerRef`. **No group lock, no `_package`** — the
include inherits the group's package. Delete = lock the include → `DELETE ?lockHandle=…`.

| Include name | 7.50 | 758 |
|---|---|---|
| `L<GRP>F01` / `O01` / `E01` / `T99` / `F99` | 200, GET 200 | 200, GET 200 |
| arbitrary (`ZZ_ARBITRARY_INC`) | **500** *"Attributes for program ZZ_ARBITRARY_INC have not been saved"* | — |
| DELETE | 200 → GET 404 | 200 → GET 404 |

SAP maintains the main program itself: creating an include appends `INCLUDE <name>.`, deleting one
**comments the line out** (`*INCLUDE lzzspk750f99.`) rather than removing it. So the name must be
validated client-side as `L<GROUP>…`; anything else gets SAP's opaque 500.

### 8.3 FUGR read fallback for < 7.52

`/sap/bc/adt/functions/groups/{g}/objectstructure` 404s on 7.50 under **every** Accept. The generic
`/sap/bc/adt/repository/objectstructure` works there — note the **lowercase** query parameters
(`objectname`, `objecttype`; the camelCase form returns 400 *"Parameter objectname could not be found"*):

```
GET /sap/bc/adt/repository/objectstructure?objectname=ZZSPK750&objecttype=FUGR/F
→ <projectexplorer:objectstructure><projectexplorer:node … objecttype="FUGR/I" objectname="LZZSPK750TOP" …/>
                                   <projectexplorer:node … objecttype="FUGR/FF" objectname="Z_ZZSPK750_FM" …/>
```

It carries **both** includes (`FUGR/I`) and function modules (`FUGR/FF`) — full parity with what
`parseFunctionGroup` extracts from the 758 `abapsource:objectStructureElement` shape, but a
different XML shape, so the fallback needs its own small parser.

### 8.4 Discovery keys for the gates (4 systems)

| key | npl 750 | ECC 750 | a4h 758 | 816 |
|---|---|---|---|---|
| `/sap/bc/adt/ddic/domains` | ✗ | ✗ | ✓ | ✓ |
| `/sap/bc/adt/packages` | ✗ | ✗ | ✓ | ✓ |
| `/sap/bc/adt/ddic/tables` | ✗ | ✗ | ✓ | ✓ |

Same shape as the existing `isTablesEndpointAvailable()` — the two new gates are one-line siblings.

### 8.5 Prior art

Neither reference MCP repo implements any of this: `mcp-abap-adt` only reads FM `/source/main`;
`mcp-abap-adt-fr0ster` wraps an `AdtClient` library for FM get/delete and read-only include listing.
`grep -rn "processingType\|fincludes"` over both → no hits. SAP's own Eclipse plugin
(`com.sap.adt.functions_3.58.1`: `model/fmodules.xsd`, `model/fincludes.xsd`, and the content types
in `FunctionModulePropertyRestResourceFilter`) is the authority here.

### 8.6 Affected ARC-1 files

| Change | Files |
|---|---|
| FM `processingType`/`updateTaskKind` | `src/adt/client.ts` (GET+PUT pair, mirror `setApiReleaseState`), `src/adt/xml-parser.ts` (attr parse + body mutation, mirror `buildApiReleasePutBody`), `src/handlers/write.ts` + `write/create.ts` + `write/update-delete.ts`, `src/handlers/read.ts` (`includeSignature`), `src/handlers/{schemas,tools}.ts` |
| FUGR include create/delete | `src/handlers/write.ts` (lift the INCL+group refusal), `write/create.ts`, `write/update-delete.ts`, `src/handlers/write-helpers.ts` (`buildCreateXml` INCL case + `…fincludes.v2+xml` CT), `src/handlers/{schemas,tools}.ts` |
| DOMA + DEVC gates | `src/handlers/feature-cache.ts` (2 helpers), `src/handlers/write-helpers.ts` (2 hint constants), `src/handlers/write.ts`, `src/handlers/manage.ts` |
| FUGR read fallback | `src/adt/client.ts` (`getFunctionGroup`), `src/adt/xml-parser.ts` (projectexplorer parser) |
| Docs | `docs/integration-test-skips.md` (stale DTEL row), `AGENTS.md` rows, `docs/dev-guide.md` |
| Test surface | `tests/unit/adt/`, `tests/unit/handlers/`, and **`tests/fixtures/tool-definitions/*.json`** — the LLM-visible schema changes, so the snapshot needs `vitest -u` + a reviewed diff |

Adjacent paths that share state: `batch_create` has its own item schema and its own copy of the
TABL/TTYP discovery gates (`write/create.ts:852-859`) — new gates and new FUNC properties must land
there too, not just on the single-object path.

## 9. Method note

`dist/` in the main repo was **stale** (built 2026-07-17 from a 2026-06-22 checkout, before the
`INCL + group` branch existed). A first pass wrongly concluded that FUGR TOP-include writes were
blocked. Rebuilt from this worktree (`npm ci && npm run build`) and re-ran — the update works. Any
CLI-driven live probe should check `dist/` freshness first.

## Commands used

```sh
# endpoint availability (7.50, live)
curl -sk -u DEVELOPER:… 'https://npl.marianzeis.de/sap/bc/adt/ddic/domains/XFELD?sap-client=001'
curl -sk -u DEVELOPER:… 'https://npl.marianzeis.de/sap/bc/adt/ddic/tables/T000/source/main?sap-client=001'
curl -sk -u DEVELOPER:… 'https://npl.marianzeis.de/sap/bc/adt/ddic/structures/T000/source/main?sap-client=001'

# FM attributes (7.50, live)
curl -sk -u DEVELOPER:… 'https://npl.marianzeis.de/sap/bc/adt/functions/groups/srfc/fmodules/rfc_ping?sap-client=001'

# SAP's own model
unzip -p ~/DEV/arc-1-lsp/vendor/adt-ls/linux/gtk/x86_64/plugins/com.sap.adt.functions_3.58.1.jar model/fmodules.xsd

# real ARC-1 behavior on 7.50 (from /Users/marianzeis/DEV/arc-1, dist/ built)
export SAP_URL=https://npl.marianzeis.de SAP_USER=DEVELOPER SAP_PASSWORD=… SAP_CLIENT=001 \
       SAP_INSECURE=true SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES='*'
node dist/cli.js call SAPWrite --arg action=create --arg type=DTEL … --output json
node dist/cli.js call SAPWrite --json - < stru.json      # TABL/DS, source uses `define type`
node dist/cli.js call SAPWrite --json - < fm.json        # FUNC + TABLES/EXCEPTIONS/VALUE()
node dist/cli.js call SAPActivate --arg type=FUGR --arg name=ZZ_ARC1_PROBE_FG

# the property ARC-1 does not send: lock -> PUT -> unlock
curl -sk -u … -X POST "$B$FM?_action=LOCK&accessMode=MODIFY"        # -> LOCK_HANDLE
curl -sk -u … -H 'Content-Type: application/vnd.sap.adt.functions.fmodules.v3+xml' \
     -X PUT --data-binary @fm.xml "$B$FM?lockHandle=<handle>"        # processingType="rfc"

# probe fixtures
tests/fixtures/probe/{npl-750-sp02-dev-edition,ecc-ehp8-nw750-sp31-onprem-prod}/responses/
```
