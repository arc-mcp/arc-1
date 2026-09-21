# ENHS — qualified native relationship identity


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### ENHS/XSB

- Observed object: `/AIF/ALERT`; GET `/sap/bc/adt/enhancements/enhsxsb/%2faif%2falert`.
- Recorded: 2026-09-09T23:02:36.586Z; metadata QName: `enhs:objectData`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/enhs-xsb.json) also preserves one observed ENV edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<enhs:objectData adtcore:name="/AIF/ALERT" adtcore:type="ENHS/XSB" adtcore:version="active" xmlns:enhs="http://www.sap.com/adt/enhancements/enhs" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%2faif%2falert" adtcore:type="DEVC/K" adtcore:name="/AIF/ALERT"/>
</enhs:objectData>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
