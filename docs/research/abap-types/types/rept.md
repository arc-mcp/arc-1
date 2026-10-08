# REPT — program text pool (PROG/PX)

`REPT` is the program's LIMU text-pool subobject, separate from its source.
For explicit program text-pool activation, `PROG/PX` normalizes to `REPT` and
uses `/sap/bc/adt/textelements/programs/<name>`. SAPRead/SAPWrite continue to
use their existing TEXT_ELEMENTS / edit_text_symbols interfaces.

## Live evidence — SAP_BASIS 758 SP02, 2026-10-08

HTTPS/Basic, client 001, disposable `$TMP` program `ZARC940R_MV00SZGK`.
GET `/sap/bc/adt/textelements/programs/zarc940r_mv00szgk` returned the
following identity and package metadata. This is a projection of the response;
authors, timestamps, unrelated attributes and source links are omitted.

```xml
<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="ZARC940R_MV00SZGK" adtcore:type="PROG/PX" adtcore:version="inactive">
  <adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp"
    adtcore:type="DEVC/K" adtcore:name="$TMP"/>
</rept:textElement>
```

The native inactive-object list independently returned the same name, type
`PROG/PX`, and text-pool URI. Activating the program URI left the REPOTEXT
inactive row; activating the pool URI cleared it while preserving a separate
inactive program-source draft. The pool's packageRef supports the existing
fail-closed package guard without an owner lookup.

A never-activated program still needs its first PROG activation (#946).
Accordingly, an accepted REPT request is reported as requested, not proof of
active state. Discovery gates systems without the text-element service.
No class/function-group slash codes or cross-release support are inferred
from this program evidence. Fixture deletion and zero REPOTEXT rows verified.
