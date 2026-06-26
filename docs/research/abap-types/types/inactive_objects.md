# INACTIVE_OBJECTS — Inactive Draft List (pseudo-type)

## TL;DR
`INACTIVE_OBJECTS` is a pseudo-type. It takes no `name` and lists all objects currently in
inactive/draft state for the calling user (per session/PP identity). Real ADT endpoint:
`/sap/bc/adt/activation/inactiveobjects`.

## TADIR ground truth
- **R3TR type**: does not exist.

## What ADT URL ARC-1 actually calls
- `/sap/bc/adt/activation/inactiveobjects`, MIME
  `application/vnd.sap.adt.inactivectsobjects.v1+xml, application/xml;q=0.5`
  (`src/adt/client.ts:542–548`).

## Architectural assessment — type vs view/action
- This isn't tied to a specific object — it's a *workspace query*. Modeling it as a `type`
  inside `SAPRead` is awkward (`name` is unused).
- Better fit: an **action** on `SAPManage` or `SAPContext` — e.g.,
  `SAPManage(action='list_inactive')` or a dedicated subcommand. Same conclusion as the
  other pseudo-types: should not live in the type enum.
- Strong recommendation to move out of the type enum in a future cleanup; today's prompts
  do reference `type='INACTIVE_OBJECTS'` so deprecate softly.

## Live verification
### a4h (S/4HANA 2023)
- Endpoint live; vendor MIME returns rich `<ioc:object>` shape with user/deleted/transport
  info.

### 7.50 (NW 7.50)
- Same endpoint; verified per code comment in `client.ts:537–540`.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| Schema enum | `src/handlers/schemas.ts:47, 78` | `INACTIVE_OBJECTS` | ✅ functional |
| `handleSAPRead` | 1770–1773 | `case 'INACTIVE_OBJECTS'` → `getInactiveObjects` | ✅ |
| `client.getInactiveObjects` | 542–548 | `/sap/bc/adt/activation/inactiveobjects` | ✅ |
| Inactive-list cache | `src/cache/inactive-list-cache.ts` | per-user cache | ✅ |

## Verdict
- **Status**: pseudo (action disguised as type)
- **Evidence**: verified-on-live-system (per existing integration tests and per-user cache)
- **Issue**: same architectural smell as `API_STATE`/`VERSIONS` etc.

## Recommendation
- Move under `SAPManage(action='list_inactive')` or `SAPRead(type=<obj>, action='inactive_list')`
  long-term; keep current entry until a coordinated pseudo-type cleanup.
- **Breaking change**: yes if removed; soft-deprecate first.
- **Test gap to close**: integration test that activates a draft and asserts it disappears
  from `INACTIVE_OBJECTS` (cache invalidation regression).
