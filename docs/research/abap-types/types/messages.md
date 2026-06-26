# MESSAGES — Pseudo: message-class read

## TL;DR
`MESSAGES` is a **pseudo type** — but unlike most pseudos, it overlaps with a real TADIR
type (`R3TR MSAG` = message class). `MESSAGES` is *the read-side* of a message class,
returning structured `{ messages: [...] }` info via `GET /sap/bc/adt/messageclass/{name}`,
falling back to the legacy `GET /sap/bc/adt/msg/messages/{name}` raw body. The
canonical TADIR/ADT short for the object itself is `MSAG` (used by ARC-1's write surface).
`MESSAGES` exists as a separate read-only synonym so the legacy free-text endpoint stays
reachable. Borderline — could be collapsed into `SAPRead(type="MSAG")`.

## TADIR ground truth
- **R3TR type**: `MSAG` (message class) — `MESSAGES` is not a TADIR code
- **LIMU sub-objects**: `MESS` (individual message line); not exposed by ARC-1
- **abap-file-formats support**: ✅ `msag/` directory exists in
  `SAP/abap-file-formats/file-formats/`
- **Source URL or fixture**: `src/adt/client.ts:638-651`, `src/handlers/intent.ts:1718-1726`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `MSAG/N` | message class (real) | `/sap/bc/adt/messageclass/` (info) and `/sap/bc/adt/msg/messages/` (legacy raw) | a4h ✅, 7.50 ✅ |

ARC-1's `MESSAGES` calls `getMessageClassInfo` first; on failure falls back to
`getMessages` (raw body). Both target the same MSAG object.

## SAP docs & notes
- Message classes documented under tx `SE91`. ADT exposes them via the workbench object
  type `MSAG/N`.

## Other MCP servers / cross-reference
- `mcp-abap-abap-adt-api` exposes message-class read; uses `MSAG` directly (no separate
  `MESSAGES` synonym).
- Eclipse ADT plugin: only `MSAG/N`.

## Live verification
### a4h (S/4HANA 2023)
- Test object: e.g. `00` (system messages) or any Z-class.
- ADT response: 200 XML with `<messageclass>` root; structured by `parseMessageClass`.

### 7.50 (NW 7.50)
- Same; legacy `/sap/bc/adt/msg/messages/` works on older systems where the structured
  endpoint may be absent.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | 41, 74 (Read onprem + BTP) | `MESSAGES` (read pseudo) | ⚠️ overlaps with `MSAG` |
| `src/handlers/schemas.ts` | (write enum) | `MSAG` | ✅ |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | — | no entry for MESSAGES | ✅ |
| `src/handlers/intent.ts` Read switch | 1718-1726 | tries getMessageClassInfo, falls back to getMessages | ✅ |
| `src/adt/client.ts` getMessages / getMessageClassInfo | 638-651 | both endpoints | ✅ |

## Verdict
- **Status**: pseudo, overlapping (`MESSAGES` is read-only synonym for `MSAG`)
- **Evidence**: verified-from-source
- **Issue**: minor confusion — the read enum has `MESSAGES` while the write enum has
  `MSAG`, so an LLM that successfully wrote a message class then can't read it back with
  the same type token. Round-trip asymmetry.

## Recommendation
- **Collapse `MESSAGES` into `MSAG` for read** to make the type symmetric across read/write.
  Keep `MESSAGES` as a deprecated alias for one release. The fall-back from structured
  to legacy endpoint is internal — no need for a separate user-visible token.
- **Breaking change**: minor. Provide alias mapping `MESSAGES → MSAG` for one release.
- **Test gap to close**: an E2E test that writes an MSAG via `SAPWrite(type="MSAG")` then
  reads it via `SAPRead(type="MSAG")` — currently impossible without the alias because
  the read enum doesn't accept `MSAG`.
