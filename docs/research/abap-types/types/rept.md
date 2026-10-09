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

## Remaining deletion gap — SAP_BASIS 758 SP02, 2026-10-09

Reproduced independently at `9e6c99af` using HTTPS/Basic, client 001 and the
`$TMP` allowlist: create and activate a disposable PROG, then lock/PUT/unlock
its pool directly without activation. `SAPWrite(action="delete", type="PROG")`
reports deletion and the program GET returns 404, but REPOTEXT retains state I.
The inactive-object list no longer includes it, and `SAPActivate(REPT)` fails
at the pool metadata GET with 404. Activation routing cannot recover that orphan.

Recreating the same name retains an inactive REPOTEXT row. Default and explicit
inactive selection-text reads returned empty; stale text becoming visible or active
was not established. Each fixture was recovered by recreating only its own name,
activating program and pool, then deleting it. Zero rows remained in REPOTEXT,
REPOSRC, DWINACTIV, TADIR and TRDIR; the program GET returned 404.

This is a separate deletion gap in [#940](https://github.com/arc-mcp/arc-1/issues/940),
tracked as [COMPAT-12](../../../../docs_page/roadmap.md#compat-12).
Do not close #940 solely because explicit activation now works. A delete safeguard
needs research into SAP's supported draft handling, including concurrency and
other users' drafts; automatic activation of an owner's source is not a solution.
