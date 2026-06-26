# Evaluation: Issue #44 — Dynpro metadata access + non-native object source retrieval

**Priority**: Medium
**Source**: marcellourbani/abap-adt-api issue #44 (2026-04-14)
**ARC-1 Component**: `src/adt/client.ts`, `src/handlers/intent.ts`

## What They Proposed

Two related but distinct feature proposals:

### 1. Dynpro (Screen) Metadata Access

ABAP programs can contain Dynpros (screens/dialogs). These are not accessible via the standard program source endpoint — they have separate metadata including:
- Screen number, type, dimensions
- Field list with types and attributes  
- Flow logic (PBO/PAI event handlers)

The ADT endpoint pattern: `GET /sap/bc/adt/programs/programs/<PROG>/dynpros/<SCREEN_NUMBER>`

Currently abap-adt-api (and ARC-1) only reads the ABAP source of programs, not the screen definitions.

### 2. Non-Native Object Source Retrieval

Some legacy ABAP object types (old-style function modules, transaction variants, etc.) don't have native ADT endpoints. SAP Note 2980930 introduces an extension endpoint that enables source retrieval for these "non-native" types via ADT infrastructure.

## ARC-1 Current State

- **Dynpro**: ARC-1 has no Dynpro support. SAPRead with `PROG` action reads ABAP source only.
- **Non-native objects**: ARC-1 returns an error for unsupported object types. No fallback to extension endpoints.

## Assessment

### Dynpro
Dynpros are becoming less relevant (S/4HANA Fiori replaces screens) but remain critical for legacy ABAP maintenance. An AI assistant helping maintain legacy programs needs to understand screens. The ADT endpoint likely returns XML describing the screen layout and fields.

Priority: **Medium** for on-premise/ECC users, **Low** for BTP/cloud-only.

### Non-native objects
The SAP Note 2980930 extension endpoint is an interesting discovery. If ARC-1 gets an unsupported object type, having a fallback to try the extension endpoint could help with legacy projects.

Priority: **Low** — edge case, requires specific SAP Note installed.

## Decision

**consider-future** for both:
- Dynpro: Add as optional `DYNT` action on SAPRead. Effort: 1-2 days to map ADT XML response to a useful structure.
- Non-native: Note the extension endpoint pattern for future fallback logic in `getObjectSource()`.

## ADT Endpoint Notes

- Dynpro list: `GET /sap/bc/adt/programs/programs/<PROG>/dynpros`
- Dynpro metadata: `GET /sap/bc/adt/programs/programs/<PROG>/dynpros/<SCREEN>`
- Non-native source: Extension via SAP Note 2980930 — endpoint TBD from note content
