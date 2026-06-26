# TRAN — Transaction Code

## TL;DR
Canonical TADIR R3TR `TRAN` (transaction code, table TSTC). ARC-1's spelling is correct,
but the URL prefix and slash alias deserve scrutiny:
- **Slash form `TRAN/O`** is not corroborated by the local Eclipse jar grep (no `TRAN/`
  hits at all). ADT historically uses `TRAN/T` in some contexts; ARC-1's `TRAN/O` may
  be a copy/paste from older docs. Treat as **inferred / unverified** until checked
  against a live `<adtcore:objectType>` response.
- **URL `/sap/bc/adt/vit/wb/object_type/trant/object_name/<name>`** is the *VIT generic
  workbench URL*, not a dedicated transaction endpoint. This is real (VIT = "Virtual
  Inspection Tool" / generic object viewer) and works on on-prem; it returns metadata
  XML that `parseTransactionMetadata` consumes. Worth flagging that this is not a
  first-class ADT endpoint and may not exist on BTP/Steampunk.

## TADIR ground truth
- **R3TR type**: `TRAN`.
- **LIMU sub-objects**: none.
- **abap-file-formats support**: ❌ `tran` not in `file-formats/` (verified via gh api).
  Transactions are generally not a cloud-released artifact.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `TRAN/O` (in ARC-1) | Transaction (alias used by ARC-1) | `/sap/bc/adt/vit/wb/object_type/trant/object_name/<name>` | not in Eclipse jar grep — **suspect** |

The "real" ADT slash subtype for transactions returned by `<adtcore:objectType>` is more
commonly `TRAN/T` in observed XML. We could not confirm on a live system within this audit.

## SAP docs & notes
- Table TSTC, transaction `SE93`, ABAP keyword `CALL TRANSACTION`.
- VIT generic-object endpoint: `/sap/bc/adt/vit/wb/object_type/<TYPE>/object_name/<NAME>`.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: also reads transactions via VIT path.

## Live verification
### a4h (S/4HANA 2023)
- `SAPRead(type='TRAN', name='SE38')` should hit
  `/sap/bc/adt/vit/wb/object_type/trant/object_name/SE38` and parse description/program.
- TSTC follow-up SQL is gated behind `allowFreeSQL`.

### 7.50 (NW 7.50)
- Same VIT endpoint expected to work (legacy generic viewer present).

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `SLASH_TYPE_MAP` | 2588 | `TRAN/O → TRAN` | ⚠️ unverified — keep but reconfirm |
| `objectBasePath` | 2706–2707 | `/sap/bc/adt/vit/wb/object_type/trant/object_name/` | ✅ functional |
| `handleSAPRead` | 1633–1648 | `case 'TRAN'` | ✅ |
| `client.getTransaction` | 521–525 | matches base path | ✅ |

## Verdict
- **Status**: legacy-tolerable (with one unverified alias)
- **Evidence**: verified-from-source (TADIR R3TR TRAN, VIT endpoint shape) — slash alias `TRAN/O` is **inferred**, not verified on a live system
- **Issue**: minor — `TRAN/O` alias is unconfirmed; the practical impact is low because the
  alias only affects user-typed slash inputs, not anything ADT returns.

## Recommendation
- Keep `TRAN` (canonical) and `TRAN/O` alias for now; add a fixture-backed test capturing
  an actual `<adtcore:objectType>` from a real transaction search response. If it turns out
  to be `TRAN/T`, add that alias too (don't remove `TRAN/O` unless we're sure no clients
  depend on it).
- **Breaking change**: no
- **Test gap to close**: live capture of `objectType=TRAN` search response and an integration
  test asserting that whatever slash form ADT returns is normalized to canonical `TRAN`.
