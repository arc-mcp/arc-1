# Write function modules

Create a function group, declare function-module parameters, and maintain structural includes.

## Create the group first

```text
SAPWrite(action="create", type="FUGR", name="ZARC1_FG", package="$TMP")
```

For a transportable package, provide its required `transport`. Function modules inherit the real
parent-group package; omit `package` or pass that exact package as an assertion. A mismatch is
rejected. Delete the group only after deleting its function modules.

## Choose the processing type

On FUNC **create**, set `processingType="rfc"` for an RFC-enabled module, or
`processingType="update"` with an explicit `updateTaskKind`. `startImmediate` means V1
restartable; `immediateStartNoRestart` means V1 non-restartable; `startDelayed` means V2.
Processing fields are rejected on updates and non-FUNC objects.

An explicit processing type requires a metadata write and read-back after SAP creates its normal
shell. If that step fails, a normal module may remain: inspect it before retrying. Omitting the
processing type uses SAP's normal create behavior without those extra calls.

## SAPWrite for FUNC: create / update with structured parameters

Pass the existing parent `group` on create and a `parameters` array for the signature. ARC-1 writes
IMPORTING, EXPORTING, CHANGING, TABLES, EXCEPTIONS, and RAISING clauses into the function source.
Update/delete can resolve the group through search when omitted. SAPGUI-style parameter comment
blocks are removed with a warning because SAP rejects them (`FUNC_ADT028`).

Each parameter:

| Field | Type | Description |
|-------|------|-------------|
| `kind` | string | One of `importing`, `exporting`, `changing`, `tables`, `exceptions`, `raising`. |
| `name` | string | Parameter / exception name. Always uppercased on emit. |
| `type` | string | ABAP type expression (`STRING`, `I`, `BAPIRET2`, `TYPE STANDARD TABLE OF X`, `LIKE DOKHL-OBJECT`, …). Required for IMPORTING/EXPORTING/CHANGING/TABLES; ignored for EXCEPTIONS/RAISING. For TABLES, include the leading `TYPE` or `LIKE` keyword. |
| `byValue` | boolean | Emit `VALUE(name)` wrapper. Default `false` (pass-by-reference). |
| `default` | string | Raw ABAP literal — IMPORTING/CHANGING only. Emitted verbatim (no escaping). Examples: `'X'`, `0`, `space`. |
| `optional` | boolean | Emit `OPTIONAL` keyword. |

Example — create an FM with a typed signature:

```jsonc
SAPWrite({
  action: "create",
  type: "FUNC",
  name: "Z_GREET",
  group: "ZARC1_FG",
  description: "Greet a user",
  parameters: [
    { kind: "importing", name: "IV_NAME",  type: "STRING", byValue: true, default: "'World'" },
    { kind: "exporting", name: "EV_GREET", type: "STRING", byValue: true },
    { kind: "raising",   name: "CX_ROOT" }
  ],
  source: "  ev_greet = |Hello { iv_name }|.\n"
})
```

The `source` value is the FM body only — ARC-1 wraps it in `FUNCTION Z_GREET …. ENDFUNCTION.` and emits the signature clause from `parameters`. Or pass full `FUNCTION/ENDFUNCTION` source and the splicer will replace just the signature region. Or omit `source` entirely to create an empty-body FM with only the signature.

Round-trip: `SAPRead({type: "FUNC", name: "Z_GREET", group: "ZARC1_FG", includeSignature: true})` returns:

```jsonc
{
  "source": "FUNCTION z_greet\n  IMPORTING\n    VALUE(iv_name) TYPE string DEFAULT 'World'\n  EXPORTING\n    VALUE(ev_greet) TYPE string\n  RAISING\n    cx_root.\n  ev_greet = |Hello { iv_name }|.\nENDFUNCTION.",
  "signature": {
    "importing": [ { "kind": "importing", "name": "IV_NAME", "type": "string", "byValue": true, "default": "'World'" } ],
    "exporting": [ { "kind": "exporting", "name": "EV_GREET", "type": "string", "byValue": true } ],
    "changing":  [],
    "tables":    [],
    "exceptions": [],
    "raising":   [ { "kind": "raising", "name": "CX_ROOT" } ]
  }
}
```

When `parameters` is omitted, ARC-1 writes the supplied source without rebuilding the signature. When `includeSignature` is omitted on read, the response is plain text source.

## Reading the processing type back

`SAPRead(type="FUNC", …, includeSignature=true)` reports `processingType` and, for update modules,
`updateTaskKind` alongside the parsed signature — so a caller that set one can verify it took effect.
It is a metadata read, so a failure there adds `propertiesError` to the payload rather than breaking
the signature read. See the create-side docs above for how the attributes are written.

## Function-group structural includes (`type="INCL"` with `group=`)

`SAPWrite(type="INCL", group=<FUGR>)` creates, updates and deletes a function group's structural includes (`LZ<GROUP>TOP` global data, `F01` subroutines, `O01`/`I01` PBO/PAI modules, `T99` unit tests):

```jsonc
SAPWrite({ action: "create", type: "INCL", name: "LZARC1_FGF01", group: "ZARC1_FG",
           description: "Subroutines", package: "$TMP" })
SAPWrite({ action: "update", type: "INCL", name: "LZARC1_FGF01", group: "ZARC1_FG",
           source: "FORM do_work.\nENDFORM.\n" })
```

- The include **name must start with `L<GROUP>`** — SAP derives the include from its group and rejects anything else with an opaque `500 "Attributes for program … have not been saved"`, so ARC-1 refuses it up front.
- **SAP maintains the main program itself**: creating an include appends its `INCLUDE` line, deleting one comments that line out. No main-program edit is needed.
- The include inherits the group's package — SAP ignores `package` here — so `allowedPackages` is checked against the **group's real package**, and a `package` argument that disagrees with it is refused. On update/delete the include itself is the lock and package-resolution target (its `containerRef` carries the group's package).
- Omitting `group=` targets the standalone program-include collection instead, which still works for ordinary include names. An `L`-prefixed name there is refused with a pointer to `group=` — SAP reserves `L*` for function-group includes and answers with a 500, which would otherwise read as a transient error.

Verified on NW 7.50 SP02 and S/4HANA 2023 (758) — the ADT contract is identical on both.

[All SAPWrite parameters](sap-write.md)
