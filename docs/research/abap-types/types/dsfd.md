# DSFD — qualified native relationship identity


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### DSFD/SCF

- Observed object: `CALENDAR_OPERATION`; GET `/sap/bc/adt/ddic/dsfd/sources/calendar_operation`.
- Recorded: 2026-09-09T23:02:36.586Z; metadata QName: `blue:blueSource`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/dsfd-scf.json) also preserves one observed WUL edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<blue:blueSource adtcore:name="CALENDAR_OPERATION" adtcore:type="DSFD/SCF" adtcore:version="active" xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/sd_scalar_functions" adtcore:type="DEVC/K" adtcore:name="SD_SCALAR_FUNCTIONS"/>
</blue:blueSource>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
