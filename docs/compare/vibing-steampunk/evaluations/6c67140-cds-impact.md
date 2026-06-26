# CDS Impact Analysis and Element Info

> **Priority**: Medium
> **Source**: VSP v2.33.0 — commit 6c67140 (2026-04-04)
> **ARC-1 component**: `src/adt/codeintel.ts`

## What VSP did
CDS impact analysis and element info tools. CDS impact analysis traces downstream consumers of a CDS view (who depends on this view). Element info provides column-level metadata.

## ARC-1 current state
SAPNavigate has findWhereUsed which can find references to CDS views. However, it's generic where-used, not CDS-specific impact analysis. No column-level metadata for CDS.

## Assessment
CDS-specific tooling is increasingly important as S/4HANA moves more logic into CDS. Impact analysis for CDS views is useful for refactoring and change impact. Could be added to SAPNavigate or SAPContext.

## Decision
**Consider future** — CDS-specific tools are a growing need. Not urgent but worth tracking.
