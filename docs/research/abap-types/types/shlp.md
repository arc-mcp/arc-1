# SHLP — qualified native relationship identity

## 2026-10-29: active partial metadata read

Live GET on SAP_BASIS 750 SP02 and 758 SP02:
`/sap/bc/adt/ddic/elementinfo?path=SCUSTOM&type=SHLP`,
Accept `application/vnd.sap.adt.elementinfo+xml`. Both return a named
`abapsource:elementInfo` with `adtcore:type="SHLP/DH"`; direct parameter children have
`adtcore:type="SHLP/DHF"`. Captured responses are in `tests/fixtures/shlp/`.

This supports whole-object alias SHLP/DH and a specialized read only. Generic source URLs
are explicitly refused; SHLP/DHF remains a parameter identity. No write/activation contract
is inferred from the VIT identity.

The result covers description, available package information and parameter types/import/export
flags. It omits selection-method/exit headers, collective assignments, positions/defaults,
append provenance and inactive content. Unnamed HTTP 200 responses remain unavailable, not
proof of absence. Discovery advertises this collection without Accept entries on both releases.
French SCUSTOM requests returned English-identical bodies; effective response language is unknown.

Positive namespace controls: /AIF/ADDRESS_FIELDS (758), /BOBF/CONF_UI_BO_EXTENSION (750).
Namespaced query values must be encoded; NPL search display labels can have a "(Search Help)"
suffix and are not canonical names. No SQL, execution helper or Git export was used.

## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### SHLP/DH

- Observed object: `ZSHLP01`; GET `/sap/bc/adt/vit/wb/object_type/shlpdh/object_name/ZSHLP01`.
- Recorded: 2026-09-09T23:02:36.586Z; metadata QName: `adtcore:mainObject`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/shlp-dh.json) also preserves one observed ENV edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<adtcore:mainObject adtcore:name="ZSHLP01" adtcore:type="SHLP/DH" adtcore:version="active" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP"/>
</adtcore:mainObject>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
