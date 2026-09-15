# Edit class members

Change method declarations and visibility without resending the whole class.

These actions require `type="CLAS"`. ARC-1 reads the current structure and source, makes the
requested change, and saves an inactive draft under the class lock.

Run `SAPActivate` after editing and inspect its result. Whole-include replacement initializes a
missing include automatically, then writes the complete supplied source.

## `action="edit_class_definition"` — replace the DEFINITION block whole

Without `include=`, send only the new global `CLASS … DEFINITION … ENDCLASS.` block (typical ~10–80 lines for a 20-method class). ARC-1 fetches the existing `/source/main`, splices the new DEFINITION over the existing one, and PUTs back. The IMPLEMENTATION block is preserved verbatim.

With `include=definitions|implementations|macros|testclasses`, send the full replacement body for that local include. For ABAP Unit tests, target `include="testclasses"` and write local `ltc_*` classes; ARC-1 creates the missing CCAU include automatically on first write.

**Validation.** Before PUT, ARC-1 diffs the new DEFINITION against the current class structure. If the diff would produce a non-activatable draft, the call is refused with a structured error pointing at the right tool:

- Added concrete method without a matching `METHOD …. ENDMETHOD.` block in IMPLEMENTATION → "use `add_method`".
- Removed method that still has an orphan METHOD/ENDMETHOD block in IMPLEMENTATION → "use `delete_method`".

Exempted from the symmetry check (no IMPL needed): `ABSTRACT METHODS`, `EVENTS`, `INTERFACES`, `ALIASES`. For `include=` writes, validation of declaration/body symmetry is skipped — cross-include validation is not performed; rely on `SAPActivate` to catch breaks.

```jsonc
// Drop FINAL from a class without touching any method
{
  "action": "edit_class_definition",
  "type": "CLAS",
  "name": "ZCL_ORDER",
  "source": "CLASS zcl_order DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS process RETURNING VALUE(r) TYPE abap_bool.\n  PRIVATE SECTION.\n    DATA mv_id TYPE string.\nENDCLASS."
}
```

## `action="add_method"` — atomic DEFINITION + IMPLEMENTATION insert

Insert a METHODS clause AND an empty `METHOD <name>. ENDMETHOD.` stub in one PUT. Default target is `visibility=public`. The target section header must already exist; if missing, ARC-1 refuses with a hint to use `edit_class_definition` to add the section first.

```jsonc
{
  "action": "add_method",
  "type": "CLAS",
  "name": "ZCL_ORDER",
  "method": "METHODS greet IMPORTING who TYPE string RETURNING VALUE(r) TYPE string.",
  "visibility": "public"
}
// → inserts METHODS greet ... in PUBLIC SECTION + empty METHOD greet. ENDMETHOD. in IMPLEMENTATION
```

Pass `abstract: true` to skip the IMPLEMENTATION stub (for `METHODS x ABSTRACT.` in an abstract class).

## `action="edit_method_signature"` — replace one METHODS clause

One range replacement on a method's declaration. The IMPLEMENTATION block is untouched — any body incompatibility surfaces at `SAPActivate`, as with `edit_method`.

```jsonc
{
  "action": "edit_method_signature",
  "type": "CLAS",
  "name": "ZCL_ORDER",
  "method": "process",
  "source": "    METHODS process IMPORTING force TYPE abap_bool DEFAULT abap_false RETURNING VALUE(r) TYPE abap_bool."
}
```

## `action="delete_method"` — atomic DEFINITION + IMPLEMENTATION remove

Drops both the METHODS clause and the METHOD…ENDMETHOD body in one PUT. ABSTRACT methods (no IMPL) have only the DEFINITION line removed.

**Deleting a method removes its body.** To change visibility, use [`change_method_visibility`](#actionchange_method_visibility-move-a-method-between-sections-body-preserved) instead, which preserves the implementation.

```jsonc
{
  "action": "delete_method",
  "type": "CLAS",
  "name": "ZCL_ORDER",
  "method": "deprecated_helper"
}
```

## `action="change_method_visibility"` — move a method between sections (body preserved)

Moves a method's METHODS clause from its current visibility section to a target section (`public` / `protected` / `private`). Touches the **DEFINITION only** — the IMPLEMENTATION block (the method body) is preserved verbatim. This is the safe, token-efficient way to change visibility: send the method name + target section instead of re-sending the whole DEFINITION (`edit_class_definition`), and without the data loss of `delete_method` + `add_method`.

- Idempotent: if the method is already in the target section, it's a no-op (no write).
- The target section header must already exist; if not, ARC-1 refuses with a hint to add it via `edit_class_definition` first.

```jsonc
{
  "action": "change_method_visibility",
  "type": "CLAS",
  "name": "ZCL_ORDER",
  "method": "process",
  "visibility": "private"
}
// → METHODS process … clause moves from its current section to PRIVATE SECTION;
//   METHOD process. … ENDMETHOD. body in IMPLEMENTATION is untouched.
```

## Cross-release notes

Older NetWeaver releases can require SAP-side stateful-session support for ADT writes.
See [write compatibility](sap-write.md) and [trial-system troubleshooting](../sap-trial-setup.md).

[All SAPWrite parameters](sap-write.md)
