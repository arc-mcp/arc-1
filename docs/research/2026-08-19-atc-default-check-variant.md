# Which ATC check variant runs when `SAPDiagnose action=atc` gets no `variant`?

> **Question** (Jonas Schlak, 2026-08-18): which ATC check variant does ARC-1 use when the diagnostic
> tool is called without `variant`? Suspicion: *not* the default variant.
> **Answer: the suspicion is correct.** SAP runs the Code Inspector variant literally named
> `DEFAULT` — **not** the ATC system default (`systemCheckVariant`) that ARC-1's own
> `atc_variants` action reports.
> **System:** a4h — S/4HANA 2023, SAP_BASIS 758. **Live-verified 2026-08-19.**

## TL;DR

| Call | Variant SAP actually ran |
|---|---|
| `SAPDiagnose(action=atc, …)` — no `variant` | **`DEFAULT`** |
| `variant="ZABAP_CLOUD_DEVELOPMENT"` (= the system default) | `ZABAP_CLOUD_DEVELOPMENT` |
| `variant="DEFAULT"` | `DEFAULT` |
| `variant="SAP_CLOUD_PLATFORM_DEFAULT"` | `SAP_CLOUD_PLATFORM_DEFAULT` |
| `variant="ZZZ_DOES_NOT_EXIST"` (typo) | **`DEFAULT`** — silent fallback, **no error** |

Two separate problems, both invisible to the caller:

1. **Omitting `variant` ≠ system default.** a4h's `systemCheckVariant` is `ZABAP_CLOUD_DEVELOPMENT`;
   the bare run uses `DEFAULT`. Different check sets → different findings (see §2).
2. **A misspelled variant is not rejected.** It silently degrades to `DEFAULT`, so a run that looks
   like "S4HANA_READINES_2023" (typo) reports as a clean-core check but is a `DEFAULT` run.

`/sap/bc/adt/atc/customizing` exposes `systemCheckVariant` **so the client can send it** — the
server does not apply it on an empty `checkVariant`. Eclipse ADT prefills its dialog from that
property and always sends an explicit `checkVariant`; ARC-1 sends none, which is why the two
disagree. (The prefill mechanism is inference from the endpoint's purpose; the *server* behavior
below is measured.)

## 1. How it was proven

`SATC_AC_RESULTH.CHK_PROFILE_NAME` records the variant each ATC run really used. Five consecutive
runs against `PROG Z_CREATE_BOOKING_SAMPLES`, then:

```sql
SELECT check_run_ix, chk_profile_name, title FROM satc_ac_resulth WHERE check_run_ix >= '734'
```

| `CHECK_RUN_IX` | ARC-1 call | `CHK_PROFILE_NAME` |
|---|---|---|
| 734 | no `variant` | `DEFAULT` |
| 735 | `ZABAP_CLOUD_DEVELOPMENT` | `ZABAP_CLOUD_DEVELOPMENT` |
| 736 | `DEFAULT` | `DEFAULT` |
| 737 | `SAP_CLOUD_PLATFORM_DEFAULT` | `SAP_CLOUD_PLATFORM_DEFAULT` |
| 738 | `ZZZ_DOES_NOT_EXIST` | `DEFAULT` |

`DEFAULT` is an SAP-delivered **global** CI variant (`SCICHKV_HD`: `CHECKVID=00001`, `CIUSER=''`,
created 2018-05-03) — not a user-specific one, so this is not a per-developer artifact.

The worklist XML itself carries no variant attribute (`atcworklist:id/timestamp/usedObjectSet/
objectSetIsComplete` only), which is why nothing in the ADT response reveals the substitution.

## 1b. Wo `DEFAULT` herkommt — drei Ebenen, nicht eine

`DEFAULT` ist **kein hartkodierter Endwert**. Es ist der Code-Inspector-Standardname, der über eine
Alias-Tabelle auf eine andere Variante umgebogen werden kann:

| Ebene | Ort | a4h |
|---|---|---|
| CI-Standardname | `CL_CI_CHECKVARIANT`, private `CONSTANTS default_variant_name VALUE 'DEFAULT'` | `DEFAULT` |
| **CI Global Check Variant** (Alias) | `CL_CI_CHECKVARIANT=>get_chkv_alter` → `db_access->get_alternative_name()` → Tabelle `SCICHKV_ALTER` *"Code Inspector: Mapping Global Check Variant to Alter Ego"*; UI: SCI *Basic Settings (Global)* → „Global Check Variant" | Identität: `DEFAULT→DEFAULT`, `TRANSPORT→TRANSPORT` (SAP, 2010) |
| Benutzer-Variante | `SATC_AC_VST` *"VST Parameters"* — Key `USERNAME`, Felder `CHECK_VARIANT` + `KIND` (Flavor) | **leer** |

Auf a4h sind Alias und Benutzerebene identisch bzw. leer — deshalb kam bei der Messung `DEFAULT`
heraus. Auf einem System, dessen *Global Check Variant* z. B. `/SIEC/DEFAULT` ist, würde derselbe
Fallback dort landen. Die Messung „leerer `checkVariant` → `DEFAULT`" ist also systemabhängig; nur
die Aussage **„leerer `checkVariant` ≠ `systemCheckVariant`"** ist allgemein belegt.

Das ist eine **andere** Einstellung als die ATC-Konfiguration aus §3: SCI *Global Check Variant*
(`SCICHKV_ALTER`) vs. ATC-Konfiguration (`SATC_CI_CF.CHECKVARIANT` = `systemCheckVariant`, Tx `ATC`).
Beide können unterschiedliche Varianten tragen.

**Auf einem Fremdsystem nachmessen** (einzig belastbarer Weg — die Run-Antwort verrät es nicht):

```sql
SELECT check_run_ix, chk_profile_name, title, scheduled_by, scheduled_on_ts
  FROM satc_ac_resulth ORDER BY scheduled_on_ts DESCENDING
```

Nach einem `SAPDiagnose(action="atc")` ohne `variant` steht in der obersten Zeile die real gelaufene
Variante. (Braucht `SAP_ALLOW_DATA_PREVIEW`; alternativ SE16.)


### 1c. Der SCI-Screen „Basic Settings (Global)" IST `SATC_CI_CF`

Ein Kundensystem (2026-08-19 gemeldet) zeigt im SCI-Screen *Display Basic Settings (Global)* →
„Global Check Variant" eine Namensraum-Variante, und dieselbe steht in `SATC_CI_CF.CHECKVARIANT`.
Die Feldbeschriftungen des Screens bilden 1:1 auf die Tabellenspalten ab („Global Check Variant" →
`CHECKVARIANT`, „Handling of Pragmas/Pseudo Comments" → `PSEUDO_COMMENT_POLICY`).

**Damit ist der Screen kein dritter Kandidat, sondern genau `systemCheckVariant`** — also exakt die
Variante, die ein `checkVariant`-loser Lauf *nicht* nimmt. Die Alias-Ebene `SCICHKV_ALTER` bleibt der
einzige Weg, auf dem ein leerer `checkVariant` doch dort landen könnte (`DEFAULT → <Variante>`); das
ist pro System zu prüfen.

Dort war zusätzlich `TRANSPORT_CHECK_POLICY = 'C'` (*Use custom ATC settings*, nicht `'G'` wie a4h)
mit `BLOCK_FINDINGS = 1` (*On priority 1*) und `CHECK_TASKS = 'X'`. Wo das so konfiguriert ist, ist
die Diskrepanz nicht kosmetisch: die Task-Freigabe blockt auf Prio-1-Findings **der konfigurierten
Variante**, während ein blanker ARC-1-Lauf gegen eine andere Variante prüft und „sauber" meldet.


### 1d. Cross-System bestätigt — der ADT-Pfad nimmt den Namen literal

Ein zweites, unabhängiges System (Kunde, 2026-08-19) hat die a4h-Messung reproduziert **und die
Alias-Hypothese widerlegt**. Dort ist `SCICHKV_ALTER` *nicht* die Identität: `DEFAULT` →
`/<NS>/FT_DEFAULT`, und die ATC-Konfiguration trägt eine dritte, wieder andere Variante
`/<NS>/DEFAULT`. Drei unterscheidbare Ausgänge — gemessen wurde:

| `SATC_AC_RESULTH` | `CHK_PROFILE_NAME` | Herkunft |
|---|---|---|
| ARC-1-Lauf **ohne** `variant` | **`DEFAULT`** | literal |
| CTS-Freigabeprüfungen | `/<NS>/DEFAULT` | ATC-Konfiguration |
| Eclipse-ADT-Objektläufe | `/<NS>/DEFAULT` | Client sendet explizit |

**Ergebnis: der ADT-Worklist-Pfad verwendet bei leerem `checkVariant` den Namen `DEFAULT` wörtlich.**
Weder `systemCheckVariant` noch die CI-Alias-Auflösung (`SCICHKV_ALTER`) greifen. Auf a4h war das
nicht unterscheidbar, weil dort das Alias-Mapping die Identität ist — dieses System liefert die
Trennschärfe.

**Gemessener Unterschied am selben Objekt** (Kundenklasse, gleicher Zeitpunkt):

| Variante | Findings |
|---|---|
| leer → `DEFAULT` | 4, ausschließlich Extended Program Check (SLIN) |
| ATC-konfigurierte Variante | Dutzende über 4 Checkgruppen — kundeneigene Clean-Core-/API-Klassifizierung (Prio 2/3), Namenskonventionen (Prio 2), SLIN, Suspect Conversions |

Der blanke Lauf zeigte also nur die SLIN-Dimension und verbarg den gesamten kundeneigenen
Clean-Core-Checkblock. Im gemessenen Fall waren die verborgenen Findings Prio 2/3 — bei
`BLOCK_FINDINGS = 1` hätte die Freigabe hier nicht geblockt, aber die Lücke ist strukturell: ein
Prio-1-Finding derselben Variante wäre unsichtbar geblieben und hätte später die Task-Freigabe
gestoppt.


## 1e. Quergegenlesen: SAPs eigener Client macht genau das, was der Fix vorschlägt

| Quelle | Befund |
|---|---|
| **adt-ls** (`~/DEV/arc-1-lsp/docs/research/adt-ls-capability-map.md` §3c, `adt-ls-reference.md` L78) | Der Decompile von `AtcCheckService` zeigt: bei leerem `checkVariant` ruft **der Language Server** `getSystemDefaultCheckVariant()` aus dem Backend-Customizing und schickt den Wert mit. Das ist **client-seitige** Auflösung — SAPs eigener Client tut also exakt das, was Commit 1 vorsieht. |
| **FEAT-68-Dossier** (`2026-07-24`) | Las dieselbe Stelle als *"server-side"* und leitete daraus „leerer `checkVariant` → `systemCheckVariant`" ab. **Das ist die Fehlerquelle der falschen Doku** — die Auflösung passiert im Client, nicht im ABAP-Backend. |
| **Eclipse ADT** (`~/DEV/arc-1-eclipse-adt/api/10-abap-unit-and-atc-runs.md`) | Dokumentiert den Worklist-Flow, führt „variant selection" aber als **fehlende** Fähigkeit auf. Kein widersprechender Kontrakt. |
| **fr0ster-Discovery-Capture** + Live-Discovery auf 7.50/758 | `/sap/bc/adt/atc/worklists{?checkVariant}` — optionaler Query-Parameter, kein dokumentierter Server-Default. |

## 1f. Release-Matrix der beiden Endpoints, die der Fix braucht

| Release | `/atc/customizing` → `systemCheckVariant` | `/atc/variants?name=*` |
|---|---|---|
| **NW 7.50** (`npl`, SP02) | **200**, `DEFAULT` | **200**, 178 Varianten |
| **S/4 2023 / 758** (`a4h`) | **200**, `ZABAP_CLOUD_DEVELOPMENT` | **200**, 184 Varianten |
| **ABAP Platform 2025 / 816** | 200 (FEAT-68-Dossier, live) | 200, 215 Varianten (FEAT-68) |
| Kundensystem (758er Familie) | 200, namensraumeigene Variante | – |

Beide Endpoints existieren auf **jedem** unterstützten Release → der `sapFallback`-Zweig ist ein
Sicherheitsnetz, kein regulärer Pfad. Auf **7.50 ist der Fix ein Verhaltens-No-op**
(`systemCheckVariant` = `DEFAULT` = was ohnehin lief) — dort besteht kein Regressionsrisiko.

*(816 konnte in dieser Runde nicht selbst gemessen werden: `a4h-2025` antwortet mit 401. Die
Endpoint-Verfügbarkeit stammt aus dem FEAT-68-Dossier, das dort live verifiziert wurde.)*


## 2. The findings really do differ

Same object, same moment:

```
no variant / DEFAULT     -> 3 findings: Critical Statements "Use of ROLLBACK WORK" (x2, prio 3),
                                        SLIN "contains inactive parts" (prio 3)
ZABAP_CLOUD_DEVELOPMENT  -> 2 findings: SLIN "contains inactive parts" (prio 3),
                                        "Objects of type PROG are not allowed in ABAP Cloud
                                         Development" (prio 1)
```

The prio-1 clean-core finding only appears under the system default. A bare `action=atc` on this
system silently skips the checks the system is configured for.

## 3. Raw customizing (a4h, 758)

```xml
<atc:customizing xmlns:atc="http://www.sap.com/adt/atc"><properties>
  <property name="ciCheckFlavour" value="true"/>
  <property name="systemCheckVariant" value="ZABAP_CLOUD_DEVELOPMENT"/>
  <property name="isCCSTunnelEnabled" value="false"/>
  <property name="isTransportableExemptionTypeUsed" value="false"/>
</properties>…</atc:customizing>
```

`systemCheckVariant` is the **only** variant-ish property — there is no second "run-time default"
the server could be reading instead.

## 4. What is wrong in ARC-1 today

Behavior is not broken (it faithfully omits `checkVariant`), but every statement about what that
means is wrong, and the result hides the substitution:

| Location | Claim | Reality |
|---|---|---|
| `docs/dev-guide.md` (ATC run row) | "omit `checkVariant` → system default" | → `DEFAULT` |
| `src/adt/xml-parser.ts` `parseAtcSystemCheckVariant` docstring | "the variant ATC runs when `checkVariant` is empty" | it is not |
| `src/handlers/diagnose.ts` `atc_variants` comment | "the system default (used when none is given)" | it is not |
| `src/handlers/tools.ts` SAPDiagnose description | "list variants + the system default" | reads as *the effective* default |
| `docs/research/2026-07-24-feat68-atc-variant-listing.md` §2 | same claim, sourced from an adt-ls decompile | not reproducible on 758 |
| `docs/research/2026-06-03-atc-quickfix-surface-a4h.md` | "Omitting `variant` uses the system default" | → `DEFAULT` |
| `~/.claude/skills/migrate-custom-code/SKILL.md` (L17, L36, L44, L262) | "omit `variant` → system default"; "variant not found → error" | → `DEFAULT`; typos never error |
| `src/adt/atc.ts` `parseAtcRunResult` | `variant: context.variant ?? null` | echoes the **requested** variant — reports `ZZZ_DOES_NOT_EXIST` for a run that executed `DEFAULT` |

## 5. Cheapest fix

Make ARC-1 send what it claims: resolve `systemCheckVariant` once (already implemented as
`getAtcSystemDefaultVariant`) and pass it as `checkVariant` when the caller gives none — then the
echoed `variant` is true and clean-core checks actually run. Fall back to omitting it when
`/atc/customizing` is unavailable, and say so in the result.

Second-order (optional): the silent-fallback trap survives an explicit variant too, so validating
`variant` against `listAtcVariants` before the run — or reading back
`SATC_AC_RESULTH.CHK_PROFILE_NAME` — is the only way to *prove* which variant ran.

## Not verified here

- Whether 8.16 / BTP behave the same (only 758 was reachable; both connected instances are a4h).
- Whether Eclipse ADT sends `checkVariant` explicitly (inferred from the customizing endpoint's
  purpose, not captured on the wire).
