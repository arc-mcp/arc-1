---
name: sap-unused-code
description: Find Z/Y custom objects never called at runtime by combining SAP call-monitor (SCMON) usage data with static where-used analysis — classifies each as UNUSED/LIKELY_UNUSED/USED/INDETERMINATE. Use when asked to "find unused custom code", "identify retirement candidates", "dead Z objects", or "what can we delete safely".
---

# SAP Unused Code Discovery

Find Z/Y custom objects that are **never called at runtime** — the prerequisite for any credible custom-code retirement project. Combines runtime usage data from SAP's call monitor (SCMON) with static where-used analysis to classify each object as **UNUSED / LIKELY_UNUSED / USED / INDETERMINATE**.

## ⚠ Required: scope and intent

**This skill refuses to run without a filter.** A "list all unused code" report across an ECC system returns tens of thousands of rows and is useless. The user must provide at least one of:

- **Package** (e.g., `Z_FI_CUSTOM`) — analyze only objects in this package
- **Namespace prefix** (e.g., `Z_SALES_*`, `/ACME/*`) — only objects matching the pattern
- **Object list** — comma-separated names to check
- **Intent statement** — e.g., "find Z reports in FI-GL that haven't run in 90 days" — narrow by purpose

If none is given, ask. Example clarifying questions:

> Which package or namespace do you want to audit? E.g., "the Z_REPORTING package", "all Z* starting with Z_FI_", or "these 15 reports I'm planning to delete".

## Why this is harder than it looks (read before proposing a plan)

SAP has two relevant monitoring systems. Understand which you're working with:

| System | What it is | Where data lives | Latency | Data lifetime |
|---|---|---|---|---|
| **SCMON** (ABAP Call Monitor) | Raw per-call counters | `SCMON_DATA` + `SCMON_PROG` + `SCMON_SUB` + `SCMON_RDATA` tables | Real-time while active | ~7 days rolling |
| **SUSG** (Usage Statistics Generator) | Daily aggregation over SCMON | `SUSG_DATA` + `SUSG_PROG` + `SUSG_RDATA` + `SUSG_SUB` + `SUSG_ADMIN` tables (or CDS views `SUSG_I_DATA`, `SUSG_I_RDATA`, `SUSG_I_ODATA`) | Depends on batch schedule (default ~02:30 daily) | Months/years |

**Key constraint:** SCMON auto-deactivates when record threshold is hit (`SCMON_CONF_SET_MAX_NUM_SLICES`). SUSG refuses to aggregate if SCMON was inactive during the window. On dev/test systems this breaks the pipeline constantly.

## Three Options (pick based on system state)

### Option A (preferred) — Direct SCMON table join via ARC-1

Works immediately on any system where SCMON has ever been active, regardless of whether SUSG aggregation ran.

```sql
-- "Which programs actually ran?"
SELECT p~PROGNAME, p~OBJECT, p~OBJ_NAME, SUM( d~COUNTER ) AS EXECS
FROM SCMON_DATA AS d INNER JOIN SCMON_PROG AS p ON d~TRIGID = p~PROGID
WHERE <filter>
GROUP BY p~PROGNAME, p~OBJECT, p~OBJ_NAME
ORDER BY EXECS DESCENDING
```

```sql
-- "Which transactions/reports triggered anything?"
SELECT s~ROOTNAME, s~ROOTTYPE, SUM( d~COUNTER ) AS EXECS
FROM SCMON_DATA AS d INNER JOIN SCMON_SUB AS s ON d~SUBID = s~SUBID
GROUP BY s~ROOTNAME, s~ROOTTYPE
```

**Column caveat (SAP naming is inverted):**
- `SCMON_DATA.TRIGID` → `SCMON_PROG.PROGID` (the *executed program*, despite the name)
- `SCMON_DATA.SUBID` → `SCMON_SUB.SUBID` (the *trigger root*, transaction/report that initiated)

**Pros:** No batch wait, no slice rotation dance, runs today.
**Cons:** Limited retention window (~7 days); useless for "has this run in the last 6 months" questions.

### Option B — Aggregated SUSG via CDS views

Use when the customer has SUSG properly scheduled (production systems usually do).

```sql
-- Same question, longer window
SELECT PROGNAME, OBJ_TYPE, OBJ_NAME, SUM( COUNTER ) AS EXECS, MAX( LAST_USED ) AS LAST_SEEN
FROM SUSG_I_DATA
WHERE <filter>
GROUP BY PROGNAME, OBJ_TYPE, OBJ_NAME
```

Pre-joined CDS view: `SUSG_I_DATA`, `SUSG_I_RDATA`, `SUSG_I_ODATA`. All have `@AccessControl.authorizationCheck: #NOT_REQUIRED`.

**Pros:** Longer history (months), pre-joined (simpler SQL), officially supported data.
**Cons:** Requires SUSG batch to have run (0 rows in SUSG until it does); nothing works if SCMON was deactivated during the window.

### Option C — Manual SUSG XML export (fallback only)

If the customer has already run transaction SUSG and exported the 5 XML files (`ADMIN0001.xml`, `PROG0001.xml`, `DATA*.xml`, `RDATA*.xml`, `SUB0001.xml`), the skill can parse those locally. **This is the Kiro path and should be the last resort** — it requires human action in SAP GUI and offline file handoff.

This skill does not bundle an XML parser. If the user insists on Option C, tell them to use [Kiro's parse-susg.py](https://github.com/aws-solutions-library-samples/guidance-for-accelerating-sap-clean-core-journey-using-kiro-agents) or write a local Python script; ARC-1 won't do it.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Option selection | Probe SCMON activity first; use A if live data exists, else B | Most systems have one or the other |
| Output classification | UNUSED / LIKELY_UNUSED / USED / INDETERMINATE | Kiro's 4-way classification; useful for prioritization |
| Where-used check | Yes, for non-runtime-seen objects | Static references are a real signal |
| Reporting granularity | Per-object with counts; top-20 + summary | Full list available on request |

## Prerequisites

Check these up front. If missing, stop and tell the user.

1. **`SAP_ALLOW_FREE_SQL=true`** on the ARC-1 server (otherwise `SAPQuery` is blocked — it runs FreeSQL). Ask admin if needed.
2. **User has `S_TABU_NAM` authorization** on `SCMON_DATA`, `SCMON_PROG`, `SCMON_SUB`, `SCMON_RDATA` (or the SUSG equivalents for Option B).
3. **SCMON has been active at some point** (Option A) OR **SUSG aggregation has run** (Option B). Probe with:

```
SAPQuery(sql="SELECT COUNT(*) AS CNT FROM SCMON_DATA")
SAPQuery(sql="SELECT COUNT(*) AS CNT FROM SUSG_I_DATA")
```

Zero rows in both → data collection hasn't happened. Point the user to the next section and stop.

### If the customer has no SCMON/SUSG data yet

Tell them:

1. SAP GUI: transaction `SCMON` → activate the monitor → let it run for N days (7 is a common minimum)
2. Transaction `SCMONL` shows slice state; `SCMOND` shows raw data
3. For permanent data: schedule `SCMON_COLLECT` as a daily job, then `SUSG_COLLECT_FROM_SCMON` after it
4. Re-run this skill once data is flowing

## Step 1: Probe which option to use

Run the two COUNT queries above. Decision table:

| SCMON_DATA count | SUSG_I_DATA count | Use |
|---|---|---|
| > 0 | > 0 | **A** (fresher data, real-time) — but mention B is also available for longer history |
| > 0 | 0 | **A** (SUSG hasn't aggregated yet) |
| 0 | > 0 | **B** (SCMON expired; SUSG has history) |
| 0 | 0 | **Stop.** Tell user to activate SCMON; don't guess. |

## Step 2: Enumerate the scope

Based on user's filter input:

### 2a. Package

```
SAPRead(type="DEVC", name="<package>")
```

Keep only objects of runtime types (PROG, CLAS, FUGR, FUNC) with Z/Y prefix. (Tables, CDS views, interfaces aren't "called at runtime" in a way SCMON/SUSG captures directly.)

### 2b. Namespace / prefix

`SAPSearch` takes a single `objectType` filter — call it once per runtime type and union the results:

```
SAPSearch(query="<prefix>*", objectType="PROG")
SAPSearch(query="<prefix>*", objectType="CLAS")
SAPSearch(query="<prefix>*", objectType="FUGR")
```

### 2c. Object list

Use names as given.

Call this **set S** (the candidate list).

## Step 3: Query runtime usage

### Option A (SCMON direct join)

Build a WHERE clause from set S. SAP FreeSQL has query length limits, so chunk if |S| > 100.

```sql
SELECT p~PROGNAME, p~OBJECT, p~OBJ_NAME, SUM( d~COUNTER ) AS EXECS
FROM SCMON_DATA AS d INNER JOIN SCMON_PROG AS p ON d~TRIGID = p~PROGID
WHERE p~OBJ_NAME IN ( 'ZCL_FOO', 'ZR_BAR', ... )   -- or  p~OBJ_NAME LIKE 'Z_FI_%'
GROUP BY p~PROGNAME, p~OBJECT, p~OBJ_NAME
```

Also check trigger-side (some Z-objects run only as transactions/RFCs, never as inner callees):

```sql
SELECT s~ROOTNAME, s~ROOTTYPE, SUM( d~COUNTER ) AS EXECS
FROM SCMON_DATA AS d INNER JOIN SCMON_SUB AS s ON d~SUBID = s~SUBID
WHERE s~ROOTNAME IN ( ... )
```

Union the results. Build **set U** (runtime-used objects with counts).

### Option B (SUSG)

```sql
SELECT PROGNAME, OBJ_TYPE, OBJ_NAME, SUM( COUNTER ) AS EXECS, MAX( LAST_USED ) AS LAST_SEEN
FROM SUSG_I_DATA
WHERE <scope filter>
GROUP BY PROGNAME, OBJ_TYPE, OBJ_NAME
```

Build **set U** with additional `LAST_SEEN` timestamp.

## Step 4: Static where-used for objects not in U

For each object in S but not in U:

```
SAPNavigate(action="references", type="<type>", name="<name>")
```

(`references` is ARC-1's where-used action — it calls SAP's where-used scope API under the hood.)

Build **set W** (statically referenced objects — someone calls them in source, even if no one ran them in the observed window).

## Step 5: Classify

Apply first-match-wins:

| Object in … | Classification | Meaning |
|---|---|---|
| U (runtime executed ≥ 1 time) | **USED** | Runs in production; keep |
| W (referenced in source, not in U) | **LIKELY_UNUSED** | Static callers exist but nothing exercised it in the observed window |
| Neither U nor W | **UNUSED** | Strong deletion candidate |
| S but object doesn't exist on system (e.g., SAPSearch couldn't resolve it) | **INDETERMINATE** | Manual review |

## Step 6: Emit the report

### 6a. Headline

```
Unused Code Audit — <scope>
Data source: SCMON (2,843 rows, window: 2026-04-12 → 2026-04-19)   ← Option A
  — or —
Data source: SUSG (Aggregated 2026-01-01 → 2026-04-19, 128 days)    ← Option B

Scope:         42 objects
  USED:          18  (43%)  — safe to keep
  LIKELY_UNUSED: 12  (29%)  — still has static callers; investigate
  UNUSED:        10  (24%)  — deletion candidates
  INDETERMINATE:  2   (5%)  — manual review
```

### 6b. UNUSED table (the deletion candidates)

```
Object                  Type  Package           Last change (TR)
ZR_OLD_FI_POSTING       PROG  Z_FI_CUSTOM       2024-02-15 (MARIAN / A4HK900042)
ZCL_LEGACY_HELPER       CLAS  Z_FI_CUSTOM       2023-11-03 (MARIAN / A4HK900031)
...
```

"Last change" comes from `SAPRead(type="VERSIONS")`. Old + unused = safest to delete.

### 6c. LIKELY_UNUSED table with caller hints

For each LIKELY_UNUSED object, show who references it:

```
ZCL_OLD_SALES_UTILS  (CLAS)
  Called by:  ZR_SALES_JOB (PROG — also UNUSED — cascade delete)
              ZCL_ACTIVE_HANDLER (CLAS — USED at runtime) ← blocks deletion
```

A LIKELY_UNUSED object whose callers are all UNUSED is transitively deletable. One active caller blocks deletion.

### 6d. Follow-up options

- "Want to see the static reference graph as a tree?" (→ chained `SAPNavigate where-used`)
- "Want to clean-core-check the USED objects before worrying about unused ones?" (→ [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md))
- "Want documentation for the USED objects?" (→ [sap-object-documenter](../sap-object-documenter/SKILL.md))
- "Want to turn this into a reviewed S/4HANA migration dossier with HTML/CSV/graph outputs?" (→ [sap-migration-dossier](../sap-migration-dossier/SKILL.md))
- "Want to start deleting UNUSED objects?" → Manual: this skill **does not delete anything**; the user does it via `SAPWrite` or a transport

## Error Handling

| Symptom | Root cause | Fix |
|---|---|---|
| `SCMON_DATA` count = 0, `SUSG_I_DATA` count = 0 | Monitoring never activated | Stop; instruct user to activate SCMON (Step above) |
| SCMON has data but all `SLICEID=1` and SUSG is 0 | Slice hasn't rotated; SUSG can't aggregate open slices | Use Option A (direct), skip SUSG; or run `SCMON_COLLECT_ALL` via SA38 then `SUSG_COLLECT_FROM_SCMON` |
| `SUSG_LOG` shows "SCMON not active" | SCMON auto-deactivated (record threshold hit) | Raise threshold via `SCMON_CONF_SET_MAX_NUM_SLICES`, reactivate SCMON, accept you lost one aggregation cycle |
| `SAP_ALLOW_FREE_SQL=false` | Admin policy | Either get it relaxed, or fall back to `SAPRead(type="TABLE_CONTENTS", name="SCMON_DATA", maxRows=…)` (also blocked by `SAP_ALLOW_DATA_PREVIEW=false`; no joins either way) — badly degrades the report |
| 403 on `SCMON_*` / `SUSG_*` tables | Missing `S_TABU_NAM` auth | User needs auth assignment; document tables in request |
| Scope returns > 500 candidates | User's filter too broad | Refuse; ask user to narrow (a 500-object deletion list is not actionable) |

## Caveats

### What runtime data does NOT tell you

- **Coverage gap**: a report that runs every year-end won't appear in a week's worth of SCMON data. Always consider the observation window vs. the object's expected frequency.
- **Dead-code-detection ≠ code elimination**: an UNUSED object may be emergency/DR code, exam-period-only, or called by a scheduled job not active during the window. Cross-check with business owners before deletion.
- **Dynamic calls**: `CALL FUNCTION IN BACKGROUND`, `SUBMIT` with dynamic program names, or CALL METHOD via RTTI may not attribute to the right PROGNAME in SCMON. Some false UNUSEDs are unavoidable.

### What this skill does NOT do

- **No deletion.** Report only. Deletion must be a human decision, ideally via transport and CTS.
- **No cross-system consolidation** (DEV + QAS + PRD usage). That requires exports from each system; this skill reads one system at a time.
- **No replacement suggestions** for deprecated-but-used code. For that, use [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md).
- **No XML import** (Option C). If the customer has SUSG XML dumps and nothing else, they need an offline parser.

### When to Use This Skill

- Scoping a custom-code retirement project
- Before a migration — don't migrate what you don't use
- Post-project cleanup — removing code written for a feature that was rolled back
- License/compliance reviews requiring a dead-code inventory
- **Combine with [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md):** migrate USED Level-A code, audit USED Level-C/D code, delete UNUSED code entirely
