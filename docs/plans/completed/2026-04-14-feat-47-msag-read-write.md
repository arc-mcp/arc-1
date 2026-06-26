# Plan: FEAT-47 MSAG (Message Class) Read/Write

## Overview

Add message class (MSAG) creation and structured read support to ARC-1. Message classes are used in RAP for structured error messages in exception classes (e.g., `RAISE EXCEPTION TYPE zcx_travel USING MESSAGE` referencing a message class). Without MSAG write, LLMs must use hardcoded text in RAISEs instead of proper message classes, which is bad practice in ABAP.

**Current state:** ARC-1 already reads message class texts via `SAPRead type=MESSAGES` using `getMessages()` (reads from `/sap/bc/adt/msg/messages/{name}`), but returns raw XML. It cannot create message classes, and the read output is not structured.

Research from abap-adt-api (gold standard):
- **Creation endpoint:** `POST /sap/bc/adt/messageclass`
- **Content-type:** `application/*`
- **XML root:** `<mc:messageClass>` with namespace `http://www.sap.com/adt/MessageClass`
- **ADT type:** `MSAG/N`
- **Creation is container-only:** POST creates the empty message class; individual messages (T100 entries with number + short text) are added via a separate mechanism — either via source-like PUT or via individual message endpoints
- **No activation needed:** Message classes are immediately active after creation (like packages)

**Key design insight:** MSAG creation via abap-adt-api uses the generic `createBodySimple()` — the simplest possible creation XML (same shape as PROG/CLAS). The complexity is in managing individual messages AFTER creation. From sapcli research: individual messages are managed via `/sap/bc/adt/messageclass/{name}/messages/{number}`. ARC-1 can support individual message editing via the SAPWrite update action.

## Context

### Current State

- `SAPRead type=MESSAGES` reads message class texts via `client.getMessages(name)` at line ~423 in client.ts
- `getMessages()` reads from `/sap/bc/adt/msg/messages/{name}` — returns raw XML body (not parsed)
- `objectBasePath()` does NOT have a MSAG mapping
- MSAG is not in `SAPWRITE_TYPES`
- `buildCreateXml()` has no MSAG case
- The current `/sap/bc/adt/msg/messages/` endpoint is for listing messages — the object endpoint for CRUD is `/sap/bc/adt/messageclass/`

### Target State

- SAPWrite `create` for type=MSAG creates an empty message class container
- SAPWrite `update` for type=MSAG writes individual messages via source-based update
- SAPWrite `delete` for type=MSAG deletes the message class
- `SAPRead type=MESSAGES` enhanced to return structured JSON (message number, type, short text) instead of raw XML
- `batch_create` supports MSAG (create message class before exception classes that reference it)
- MSAG treated as a source-based type — individual messages are written as source text to `/sap/bc/adt/messageclass/{name}/source/main` (to be confirmed via testing; if not available, use the metadata approach)

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `handleSAPWrite()` (line ~1551), `buildCreateXml()` (line ~1302), `objectBasePath()` (line ~1483), SAPRead MESSAGES case (line ~792) |
| `src/handlers/tools.ts` | `SAPWRITE_TYPES_ONPREM/BTP` (line ~103-104), tool descriptions |
| `src/handlers/schemas.ts` | `SAPWRITE_TYPES` Zod enums (line ~123-136) |
| `src/adt/client.ts` | `getMessages()` at line ~423 — current raw XML read |
| `src/adt/xml-parser.ts` | XML parsing functions — add message class parser |
| `src/adt/types.ts` | Type definitions — add MessageClassInfo interface |
| `src/adt/crud.ts` | `createObject()`, `safeUpdateSource()`, delete flow |
| `src/adt/ddic-xml.ts` | XML builders — add MSAG builder |
| `tests/unit/handlers/intent.test.ts` | SAPWrite handler tests |
| `tests/unit/adt/ddic-xml.test.ts` | XML builder tests |
| `tests/unit/adt/xml-parser.test.ts` | XML parser tests — add message class parsing |

### Design Principles

1. **Simple creation XML**: MSAG creation uses the same simple pattern as PROG/CLAS — just a root element with name/description/package. No complex nested elements for creation.
2. **Source-based for message content**: After container creation, individual messages are written via the standard source mechanism (lock → PUT source → unlock). The "source" for a message class is the message entries.
3. **Structured read**: Parse the current raw XML response from `getMessages()` into a structured JSON format with message number, type (E/W/I/S/A), and short text.
4. **objectBasePath mapping**: Add `MSAG → '/sap/bc/adt/messageclass/'` — this is the CRUD endpoint. The existing `/sap/bc/adt/msg/messages/` is a different read-only endpoint for message text listing.
5. **No activation**: Message classes are immediately active — no SAPActivate step needed.
6. **Both on-prem and BTP**: Message classes are available on both platforms.

## Development Approach

- Start with the structured read enhancement (parse existing XML)
- Add creation XML builder (simple — same pattern as PROG)
- Wire into SAPWrite with proper objectBasePath
- Test with unit tests for XML builder/parser, plus integration test for lifecycle

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add MSAG to objectBasePath and buildCreateXml

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/adt/ddic-xml.ts`
- Modify: `tests/unit/adt/ddic-xml.test.ts`

Add the MSAG creation XML builder and URL mapping. MSAG creation uses a simple XML shell (like PROG/CLAS) with `mc:messageClass` root element.

- [ ] Add `case 'MSAG':` to `objectBasePath()` in `src/handlers/intent.ts` (line ~1483): return `'/sap/bc/adt/messageclass/'`
- [ ] Add a `case 'MSAG':` to `buildCreateXml()` in `src/handlers/intent.ts` (line ~1302). The XML follows the simple creation pattern:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <mc:messageClass xmlns:mc="http://www.sap.com/adt/MessageClass"
                   xmlns:adtcore="http://www.sap.com/adt/core"
                   adtcore:description="${escapeXml(description)}"
                   adtcore:name="${escapeXml(name)}"
                   adtcore:type="MSAG/N"
                   adtcore:language="EN"
                   adtcore:masterLanguage="EN"
                   adtcore:responsible="DEVELOPER">
    <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
  </mc:messageClass>
  ```
  Note: MSAG includes `adtcore:language="EN"` and does NOT have `adtcore:masterSystem="H00"` — matching the abap-adt-api pattern.
- [ ] Add unit tests (~3 tests) in `tests/unit/adt/ddic-xml.test.ts`:
  - `buildCreateXml('MSAG', ...)` produces correct XML with `mc:messageClass` root and `MSAG/N` type
  - XML includes `adtcore:language="EN"` and `adtcore:masterLanguage="EN"`
  - XML escaping of special characters in name and description
- [ ] Run `npm test` — all tests must pass

### Task 2: Wire MSAG into SAPWrite type arrays and handler

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add MSAG as a writable type in SAPWrite. MSAG follows the source-based pattern — after container creation, messages are written as source text.

- [ ] Add `'MSAG'` to `SAPWRITE_TYPES_ONPREM` in `src/handlers/tools.ts` (line ~103)
- [ ] Add `'MSAG'` to `SAPWRITE_TYPES_BTP` in `src/handlers/tools.ts` (line ~104) — message classes are available on BTP
- [ ] Update `SAPWRITE_DESC_ONPREM` and `SAPWRITE_DESC_BTP` to mention MSAG
- [ ] Add `'MSAG'` to `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP` in `src/handlers/schemas.ts` (both main schemas and batch object schemas)
- [ ] Verify MSAG does NOT need to be added to `isDdicMetadataType()` — MSAG is source-based (messages are written via `/source/main` or similar source endpoint). The standard create → write source flow should work.
- [ ] Verify MSAG does NOT need to be added to `needsVendorContentType()` — MSAG uses `application/*` for creation (per abap-adt-api)
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts`:
  - SAPWrite create type=MSAG calls createObject with correct URL (`/sap/bc/adt/messageclass/`)
  - SAPWrite create type=MSAG produces correct XML body
  - SAPWrite create type=MSAG with source writes messages after creation
  - SAPWrite update type=MSAG calls safeUpdateSource
  - SAPWrite delete type=MSAG follows lock/delete/unlock
  - SAPWrite create type=MSAG blocked by readOnly
- [ ] Run `npm test` — all tests must pass

### Task 3: Enhance SAPRead MESSAGES to return structured data

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/adt/client.ts`
- Modify: `src/handlers/intent.ts`
- Create: `tests/fixtures/xml/message-class.xml`
- Modify: `tests/unit/adt/xml-parser.test.ts`

Enhance the existing `SAPRead type=MESSAGES` to return structured JSON instead of raw XML. Parse message entries into a clean format with message number, type, and text.

- [ ] Add a `MessageClassInfo` interface to `src/adt/types.ts`:
  ```typescript
  export interface MessageClassInfo {
    name: string;
    description: string;
    messages: Array<{
      number: string;    // e.g., "001", "002"
      type: string;      // E=Error, W=Warning, I=Info, S=Success, A=Abort
      shortText: string; // Message short text
    }>;
  }
  ```
- [ ] Add a `parseMessageClass(xml: string): MessageClassInfo` function to `src/adt/xml-parser.ts`. The function should parse the ADT XML response from `/sap/bc/adt/msg/messages/{name}` and extract message entries. The XML structure from ADT typically wraps messages in a collection — parse all message elements and extract number, type, and text attributes.
- [ ] Create a test fixture `tests/fixtures/xml/message-class.xml` with a sample ADT message class XML response. This should include a message class with 2-3 messages of different types (E, I, S).
- [ ] Update `client.getMessages()` in `src/adt/client.ts` (line ~423): change return type from `Promise<string>` to `Promise<string>` (keep returning raw for now — the structured parsing happens in the handler for backwards compatibility). Or better: add a new `getMessageClassInfo(name: string): Promise<MessageClassInfo>` method that reads from `/sap/bc/adt/messageclass/{name}` and returns parsed data.
- [ ] In `src/handlers/intent.ts`, update the `case 'MESSAGES':` handler (line ~792) to return structured JSON when possible. Try calling `getMessageClassInfo()` first; if the endpoint isn't available, fall back to the current raw `getMessages()` response.
- [ ] Add unit tests (~4 tests) in `tests/unit/adt/xml-parser.test.ts`:
  - `parseMessageClass` returns name and description
  - `parseMessageClass` extracts all message entries with number, type, text
  - `parseMessageClass` handles empty message class (no messages)
  - `parseMessageClass` handles XML with special characters in message text
- [ ] Run `npm test` — all tests must pass

### Task 4: Add integration test for MSAG lifecycle

**Files:**
- Modify: `tests/e2e/rap-write.e2e.test.ts`

Add a message class create → read → delete lifecycle test.

- [ ] Add a new test case: `'SAPWrite create MSAG, read, delete'`. Use `uniqueName('ZARC1_')` for a collision-safe name (message class names max 20 chars, so use a short prefix). The test should:
  1. Create: `SAPWrite(action="create", type="MSAG", name=..., package="$TMP", description="ARC-1 test message class")`
  2. Read: `SAPRead(type="MESSAGES", name=...)` — verify it returns data about the message class
  3. Delete: `SAPWrite(action="delete", type="MSAG", name=...)`
  4. Use `try/finally` with best-effort delete for cleanup
- [ ] The test does NOT need rapAvailable check — message classes are a basic ABAP feature
- [ ] Run `npm test` — all tests must pass (E2E tests only run with `npm run test:e2e`)

### Task 5: Update documentation and roadmap

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Update all documentation artifacts to reflect MSAG write support.

- [ ] In `docs/tools.md`, add MSAG to the SAPWrite supported types table. Document MSAG creation and note that messages can be written as source text. Add examples:
  ```
  SAPWrite(action="create", type="MSAG", name="ZCM_TRAVEL", package="$TMP",
    description="Travel application messages")
  SAPWrite(action="delete", type="MSAG", name="ZCM_TRAVEL")
  ```
- [ ] In `docs/tools.md`, update the SAPRead MESSAGES description to note it now returns structured JSON with message number, type, and text
- [ ] In `docs/roadmap.md`, update FEAT-47 status from "Not started" to "Completed"
- [ ] In `docs/compare/00-feature-matrix.md`, update the "Message class write (MSAG)" row: change `❌ (FEAT-47)` to `✅`
- [ ] In `CLAUDE.md`, update relevant sections to mention MSAG is now writable
- [ ] Run `npm test` — all tests must pass

### Task 6: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify `buildCreateXml('MSAG', 'ZTEST_MSG', '$TMP', 'Test messages')` produces valid XML with `mc:messageClass` root and `MSAG/N` type
- [ ] Verify `objectBasePath('MSAG')` returns `/sap/bc/adt/messageclass/`
- [ ] Verify SAPWrite create with type=MSAG follows the source-based path (container creation + optional source write)
- [ ] Verify SAPRead type=MESSAGES returns structured JSON with message entries
- [ ] Move this plan to `docs/plans/completed/`
