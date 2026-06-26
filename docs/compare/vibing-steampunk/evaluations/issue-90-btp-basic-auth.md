# BTP ABAP Environment Basic Auth 401

> **Priority**: Low
> **Source**: VSP issue #90 (2026-04-06)
> **ARC-1 component**: `src/adt/oauth.ts`

## What VSP did
Users can't authenticate to BTP ABAP Environment with Basic Auth on abap-web domain. BTP ABAP doesn't support Basic Auth — requires OAuth.

## ARC-1 current state
Uses OAuth 2.0 Authorization Code flow for BTP ABAP (oauth.ts). Doesn't attempt Basic Auth for BTP. This is the correct approach.

## Assessment
Validates ARC-1's BTP auth approach. ARC-1 correctly uses OAuth for BTP rather than attempting Basic Auth.

## Decision
**No action needed** — ARC-1 already handles BTP auth correctly via OAuth.
