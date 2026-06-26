# Issue #2: Comments in .env File Not Supported

> **Priority**: Low
> **Source**: fr0ster issue #2 (closed, 2025-12-09)
> **ARC-1 component**: `src/server/config.ts`

## Issue description

Inline comments in `.env` files (e.g., `SAP_PASSWORD=secret # my password`) were being parsed as part of the value. The `#` character and everything after it was included in the password string, causing auth failures.

Fix: Stop parsing inline comments to preserve `#` characters that may be part of actual values (like passwords). Full-line comments (lines starting with `#`) are still supported.

## ARC-1 current state

ARC-1 uses the `dotenv` npm package for `.env` parsing (`src/server/config.ts`). The `dotenv` package handles comments correctly:
- Full-line comments (`# comment`) → ignored
- Inline comments (`VALUE # comment`) → depends on quoting. Unquoted values may include the `#`.

## Assessment

ARC-1's use of the standard `dotenv` package means this is handled by a well-tested library rather than custom parsing. The edge case with `#` in passwords is handled if the user quotes the value: `SAP_PASSWORD="pass#word"`.

## Decision

**No action needed** — ARC-1 uses `dotenv` which handles this correctly. No custom `.env` parsing to worry about.
