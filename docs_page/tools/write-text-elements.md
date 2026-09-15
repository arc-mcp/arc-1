# Write text elements

Read, replace, or clear one part of a class, program, or function-group text pool.

Read and write an object's **text pool** via the ADT textelements service. Three subobjects, each
with its own media type: `symbols` (the numbered `'Text'(001)` literals), `selections` (a report's
selection texts — the labels beside `PARAMETERS`/`SELECT-OPTIONS`) and `headings` (list header and
column headers). Writes support `symbols` for classes and all three parts for `PROG` and `FUGR`.
Selection texts require selection-screen fields in the program/function group source.

```
SAPRead(type="CLAS", name="ZCL_ORDER", include="text_symbols")      — class text symbols
SAPRead(type="TEXT_ELEMENTS", name="ZHU_CREATE", objectType="PROG") — whole program pool
SAPRead(type="TEXT_ELEMENTS", name="ZHU_CREATE", objectType="PROG", include="selections")

SAPWrite(action="edit_text_symbols", type="CLAS", name="ZCL_ORDER",
         source="@MaxLength:20\n001=Order\n\n@MaxLength:30\n002=Order created\n")

SAPWrite(action="edit_text_symbols", type="PROG", name="ZHU_CREATE", textPart="selections",
         source="P_LGNUM=Warehouse\nP_WRKST=Work center\n")
```

- **Body formats:** `symbols` — one `@MaxLength:NN` line per symbol, then `NNN=text`, blank-line
  separated (a shared or missing `@MaxLength` is rejected with `406 "Text elements contain errors"`).
  `selections` — one `PARAM=text` line per selection-screen field. `headings` — `listHeader=` plus
  `columnHeader_N=` lines.
- **Replacement, not merge:** each write replaces the complete selected part. Read it first and
  retain any entries you want to keep. Other parts remain unchanged. An explicit `source=""`
  clears the selected part; omitted/null source is rejected. Do not send the `=== part ===`
  markers from a whole-pool read as source — read the individual part with `include=` instead.
- **Immediately active** — no `SAPActivate` needed. Defining the referenced symbols is what clears
  the ATC finding *"Text symbol NNN not defined"* that a bare `'Text'(001)` literal otherwise leaves
  behind; maintaining `selections` is what stops a report's selection screen from showing raw
  parameter names.
- **On-prem only, discovery-gated.** The service was verified on 758 and 816 and is absent
  on the tested NW 7.50 system. When discovery is loaded, ARC-1 reports an unavailable service
  without calling the broken legacy endpoint. Without discovery, SAP's actual error surfaces.
- **Reads:** `objectType` defaults to `PROG`; use `CLAS` or `FUGR` explicitly for those objects.
  Whole-pool reads label the non-empty raw bodies of supported parts. SAP may return empty-value
  heading placeholders. Individual reads preserve the raw body and use the requested part's media
  type. Multipart output adds a reminder to read/write parts individually and omit the markers
  from write source. A failed part fails the read; HTTP 406 can indicate a source parsing/consistency error.
- **Class parts:** whole-class reads fetch only `symbols`. Explicit `include=selections` or
  `include=headings` reads return SAP's raw response (empty selection bodies and heading
  placeholders on the verified systems). Class writes remain restricted to `symbols`; attempts
  to write `selections` or `headings` are refused before HTTP.

Text-pool operations were verified on SAP_BASIS 758. Other releases may return different bodies;
start from the part returned by SAPRead.

[All SAPWrite parameters](sap-write.md)
