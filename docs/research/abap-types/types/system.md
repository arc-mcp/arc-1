# SYSTEM — Pseudo: ADT discovery aggregate

## TL;DR
`SYSTEM` is a **pseudo type** — it does not exist in TADIR, ADT slash forms, or
abap-file-formats. It is ARC-1's identifier for "give me system information" and resolves
to a single ADT call: `GET /sap/bc/adt/core/discovery`. The output is parsed into
`{ user, systemId, ... }` JSON. The name belongs in the schema enum **only** as a
documented pseudo / cross-cutting read, not as an object type.

## TADIR ground truth
- **R3TR type**: does not exist
- **LIMU sub-objects**: N/A
- **abap-file-formats support**: ❌ no `system/` directory
- **Source URL or fixture**: `src/adt/client.ts:617-622` (`getSystemInfo`),
  `src/handlers/intent.ts:1712-1713`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (none) | discovery aggregate | `/sap/bc/adt/core/discovery` | a4h ✅, 7.50 ✅ |

`/sap/bc/adt/core/discovery` is the ADT atom-feed root; it lists every collection the
backend exposes. ARC-1's `parseSystemInfo` extracts user identity and basic metadata.

## SAP docs & notes
- The discovery endpoint is the standard ADT root and present on every ADT-enabled
  release back to NW 7.40. No special doc.
- ARC-1's intent.ts at line 482-489 uses `SYSTEM` as the canonical "connectivity smoke
  test" recommendation when a tool call hits a network failure.

## Other MCP servers / cross-reference
- Most ADT-MCP projects expose discovery in some form; few use the literal token
  `SYSTEM` in a schema enum. None claim it is a TADIR type.

## Live verification
### a4h (S/4HANA 2023)
- ADT response: 200 atom feed with `<service>` + `<workspace>` + `<collection>` entries.

### 7.50 (NW 7.50)
- ADT response: same shape, fewer collections.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | 39, 72 (Read onprem + BTP) | `SYSTEM` | ✅ pseudo |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | — | no entry | ✅ |
| `src/handlers/intent.ts` Read switch | 1712-1713 | `client.getSystemInfo()` | ✅ |
| `src/handlers/intent.ts` connectivity hint | 482-489 | references `SYSTEM` as smoke test | ✅ |
| `src/adt/client.ts` getSystemInfo | 617-622 | GET `/sap/bc/adt/core/discovery` | ✅ |

## Verdict
- **Status**: pseudo (legitimate)
- **Evidence**: verified-from-source
- **Issue**: none — the name is functional and well-scoped. Slight risk of confusion
  with TADIR/transport "system" terminology but no collision in practice.

## Recommendation
- **Keep.** Document in the tool description that `SYSTEM`, `COMPONENTS`, `MESSAGES`,
  `TEXT_ELEMENTS`, `VARIANTS`, `INACTIVE_OBJECTS`, `VERSIONS`, `VERSION_SOURCE`,
  `TABLE_CONTENTS`, `API_STATE` are pseudo-actions, not TADIR object types. (Many of
  these are already grouped this way in the inventory.)
- **Breaking change**: no.
- **Test gap to close**: a single unit test asserting `getSystemInfo()` returns parseable
  JSON with `user` and `systemId` fields against a fixture XML — already implicitly
  covered by integration tests.
