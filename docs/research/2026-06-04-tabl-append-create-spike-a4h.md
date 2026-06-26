# TABL APPEND-structure create spike — A4H (S/4HANA 2023, SAP_BASIS 758)

**Date:** 2026-06-04 · **System:** a4h.marianzeis.de (S/4HANA 2023, ABAP 7.58) · **Context:** Feature 5 (Extensibility Assistant) of the [2026 Joule roadmap assessment](2026-06-03-joule-2026-roadmap-feature-assessment.md).

## TL;DR

| Capability | Verdict |
|---|---|
| **Read** an append structure (`SAPRead type=TABL`) | ✅ **Works today, zero code.** Returns the `extend type <base> with <append> { … }` source. |
| **Create** an append structure via ADT REST | ⛔ **Opaque protocol.** Same class as `autoqf` and ENHO-create — not reachable through ARC-1's generic create flow, and not crackable without an Eclipse "Create Append Structure" wire trace. |

This **invalidates the original Feature 5a plan** in the assessment doc, which assumed an append is a classic `R3TR APPS` object created by mirroring `dtelXml`/`domaXml` (~2 dev-days). On a modern S/4 system an append is a **source-based `TABL/DS` object** (`<blue:blueSource>`), and the create cannot be assembled from the parts ARC-1 already has.

## What an append actually is on 7.58

Not the classic `R3TR APPS` envelope the plan assumed. It is a **source-based DDIC structure** (subtype `TABL/DS`, `xmlns:blue="http://www.sap.com/wbobj/blue"`) whose source is:

```abap
@EndUserText.label : 'ARC append'
extend type zarc_apnd_base with zarc_apnd_re {
  zz_extra : abap.char(20);
}
```

The append *is* a structure object named `ZARC_APND_RE`; its source declares that it extends `ZARC_APND_BASE`. There is no separate `<appendOf>` reference element — the parent is named in the `extend type` source.

## The spike (live curl against A4H, client 001)

ARC-1 creates DDIC objects **shell-then-PUT**: POST a `<blue:blueSource>` create envelope (which always materialises a *regular* structure), then PUT the source. Tested whether that flow can produce an append:

| Step | Request | Result |
|---|---|---|
| 1. Create shell | `POST /sap/bc/adt/ddic/structures` with `<blue:blueSource>` envelope, `adtcore:type="TABL/DS"`, name `ZARC_APND_RE` | **201** — but creates a **regular structure** named `ZARC_APND_RE` |
| 2. Lock | `POST …/structures/zarc_apnd_re?_action=LOCK&accessMode=MODIFY` (stateful) | **200** — `<LOCK_HANDLE>` returned in `asx:abap/asx:values/DATA` |
| 3. PUT append source | `PUT …/structures/zarc_apnd_re/source/main?lockHandle=…` with the `extend type` source | **400** `ExceptionResourceAlreadyExists` — *"Can't save due to errors in source; execute check for details"* (`T100KEY SBD_MESSAGES/007`) |

Then, after deleting the shell, a **1-step** create (POST the `extend type` source directly to the collection as the create body):

| Content-Type | Result |
|---|---|
| `text/plain` | **415** Unsupported Media Type |
| `application/vnd.sap.adt.structures.v2+xml` | **400** |
| `application/vnd.sap.adt.ddic.structure.v1+xml` | **415** Unsupported Media Type |

## Root cause

The shell-then-PUT flow is **fundamentally incompatible** with appends:

1. Step 1 creates a **regular structure** named `ZARC_APND_RE` (the generic `<blue:blueSource>` create has no "this is an append" marker — `adtcore:type="TABL/DS"` is just "DDIC structure").
2. Step 3's source says `extend type zarc_apnd_base with zarc_apnd_re { … }` — i.e. "register an append **named** `ZARC_APND_RE`". But `ZARC_APND_RE` now already exists (the regular structure from step 1) → **`ResourceAlreadyExists`**.

An append must be **born as an append in a single create operation**. ADT exposes no create payload for that over any content-type tried, and there is no reference implementation (abap-adt-api does not cover append creation). The lock-handle parse was confirmed correct (handle lives in `asx:abap/asx:values/DATA/LOCK_HANDLE`), so the 400 is the real create error, not a transport/lock artifact.

## Why this is "opaque", not "todo"

Cracking it would require **capturing the wire trace** of Eclipse ADT's *Create → Append Structure* wizard (the exact create endpoint, content-type, and body that makes SAP materialise an append rather than a regular structure). That capture needs a GUI/Eclipse session against the system — it cannot be reverse-engineered headless by probing, the same boundary already documented for:

- `autoqf`/ATC batch quickfix (opaque `step=` multi-stage protocol)
- dynpros / GUI status (SAPGUI-only, 404 via ADT REST)
- refactoring quickfix *apply* (HTTP 500 on a4h)

## Recommendation

- **Keep the read win.** `SAPRead type=TABL` already returns append source — that covers the "AI Explain / discover extensions" half of Feature 5 with zero code. Worth a one-line skill mention.
- **Do not implement Feature 5a create** as the assessment doc described — the `appendStructureXml` / `tabl-v1.json` / `appendOf` plan is based on the classic `R3TR APPS` model that doesn't apply here, and the modern create is opaque.
- **Feature 5b (BAdI/ENHO impl create) is the same opaque-create class** and was not spiked separately on this evidence; expect the same wall (complex enhancement create, no abap-adt-api reference).
- If pursued later, the unblocking step is a **wire-trace of the Eclipse append-create wizard**, not more headless probing.

## Cleanup

Test objects created during the spike were deleted from A4H: `ZARC_APND_BASE` (base table), `ZARC_APND_RE` (regular-structure shell). No strays remain.
