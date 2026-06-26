# Issue #40: Translation/i18n Tools for Multilingual ABAP Development

> **Priority**: Medium
> **Source**: VSP issue #40 (open, 2026-03-01)
> **ARC-1 component**: `src/adt/client.ts`, `src/handlers/intent.ts`

## Issue description

Feature request for dedicated i18n/translation management tools:
- Read/write text elements across languages
- Manage OTR (Online Text Repository) texts
- Export/import translations (XLIFF format)
- Message class management across languages
- Translation status overview

## ARC-1 current state

ARC-1 already has partial i18n support:
- **Text elements**: `getTextElements()` reads text elements for programs
- **Message classes (T100)**: `getMessage()` reads individual messages by class/number
- **No write support** for translations or text elements
- **No OTR support**
- **No XLIFF export/import**

## Assessment

The basic read capabilities (text elements, T100 messages) cover the most common AI development needs — understanding what texts exist and what they say. Full translation management (write, export/import, OTR) is specialized workflow that most AI-assisted development doesn't require.

## Decision

**No action needed now** — ARC-1's existing text element and T100 message read support covers the primary use case. Translation management is a specialized workflow better handled by dedicated tools (SE63, transaction SLXT). Revisit if enterprise i18n automation becomes a requested feature.

**Effort**: 2d (if needed — OTR read, multi-language text elements)
