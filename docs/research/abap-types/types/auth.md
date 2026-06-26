# AUTH — Authorization Field

## TL;DR
ARC-1 short type `AUTH` represents an **Authorization Field** (table TOBJ / TOBJT entries —
the named fields used inside authorization objects, e.g. `ACTVT`, `MANDT`). It is **not**
the same as the broader R3TR concept of authorization *objects* (TADIR `SUSO`) or
*profiles* (`SUSP`). ARC-1's `AUTH` reads via the IAM-fields ADT endpoint
`/sap/bc/adt/aps/iam/auth/<NAME>`.

The short form `AUTH` does NOT appear as a TADIR R3TR object type (TADIR uses `SUSO`,
`SUSP`, etc. for authorization-related artifacts). `AUTH` is therefore best classified as
**pseudo** in TADIR terms — but it does correspond to a real ADT endpoint with stable
shape.

## TADIR ground truth
- **R3TR type**: does not exist as `AUTH`. Authorization fields are stored in TOBJ /
  AUTHX / similar tables and are surfaced through the IAM ADT API.
- **LIMU sub-objects**: n/a.
- **abap-file-formats support**: ❌ no `auth` directory in abap-file-formats.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| n/a | Authorization Field metadata | `/sap/bc/adt/aps/iam/auth/<name>` | probe catalog, ARC-1 client |

## SAP docs & notes
- ABAP Authorization concept; SU20 / SU21 transactions for fields & objects.
- ADT IAM endpoints: `/sap/bc/adt/aps/iam/auth/`.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: similar AUTH read (when present).

## Live verification
### a4h (S/4HANA 2023)
- Probe known objects `ACTVT`, `MANDT` (`src/probe/catalog.ts:174`) — confirmed available.
- ADT URL: `/sap/bc/adt/aps/iam/auth/ACTVT`, MIME
  `application/vnd.sap.adt.blues.v1+xml`.

### 7.50 (NW 7.50)
- Available — `minRelease: 751` per probe catalog.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `handleSAPRead` | 1573–1576 | `case 'AUTH'` → `getAuthorizationField` | ✅ |
| `client.getAuthorizationField` | 426–432 | `/sap/bc/adt/aps/iam/auth/<name>` | ✅ |
| `src/probe/catalog.ts` | 171–177 | `AUTH` (with `ACTVT`/`MANDT`) | ✅ |

## Verdict
- **Status**: pseudo (no TADIR R3TR `AUTH`) but functionally correct against a real ADT endpoint
- **Evidence**: verified-from-source + verified-on-live-system (probe known objects)
- **Issue**: short-name collision risk — `AUTH` is generic; future SAP TADIR additions or
  customer expectations could conflict. Acceptable for now.

## Recommendation
- Keep as-is (on-prem only). Tool description already calls it "Authorization Fields".
- Consider a clearer alias like `AUTHFLD` or `IAM_AUTH` long-term — but only if we touch
  the schema for other reasons.
- **Breaking change**: no (would be one if renamed)
- **Test gap to close**: none specifically; probe covers it.
