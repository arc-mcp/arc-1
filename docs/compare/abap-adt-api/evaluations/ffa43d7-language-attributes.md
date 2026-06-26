# Language Attributes on Object Creation

> **Priority**: Medium
> **Source**: abap-adt-api commit ffa43d7 / issue #40 (v7.1.1, 2026-03-02)
> **ARC-1 component**: `src/adt/crud.ts`

## What abap-adt-api added

Adds `masterLanguage` and `originalLanguage` attributes to the object creation XML body. This allows creating objects in a specific language (e.g., DE, FR) rather than defaulting to the system language.

## ARC-1 current state

- ARC-1's `createObject()` in crud.ts constructs XML for object creation but does not include language attributes
- The `SAP_LANGUAGE` config var sets the session language but doesn't influence creation metadata
- Objects are created in whatever language the ADT session uses

## Assessment

Useful for multi-language development environments where objects should be created in a specific original language. Most ARC-1 users work in EN, but enterprise customers with DE/FR/JP SAP systems would benefit.

## Decision

**Consider future** — Low urgency since most AI-assisted development is in EN. When implementing, add optional `language` parameter to SAPWrite create action that maps to `masterLanguage`/`originalLanguage` XML attributes.

**Effort**: XS (< 0.5d — just add XML attributes to creation template)
