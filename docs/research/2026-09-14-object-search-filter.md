# Normal object-search filtering (customer B-2)

## Root cause and protocol evidence

`SAPSearch` accepts `objectType`, but its default/object handler drops it before
calling `AdtClient.searchObject`. Filtering after the result cap would miss valid
objects, so SAP must apply the filter.

Read-only requests on A4H, SAP_BASIS 758 SP02, client 001 (14 September 2026):

| Quick-search parameter, query `*` | HTTP | Returned types |
|---|---|---|
| none, limit 10 | 200 | LDBA/L, DEVC/K |
| `objectType=CLAS`, limit 10 | 200 | CLAS/OC only |
| `objectType=CLAS/OC`, limit 5 | 200 | CLAS/OC only |
| `objectType=UIAC`, limit 5 | 200 | UIAC only |
| `objectType=FUGR/FF` or `FUNC`, limit 5 | 200 | FUGR/FF only |
| `objectType=NOSUCH` | 406 | rejected |
| `searchObjectType=CLAS`, `CLAS/OC`, `UIAC`, or `NOSUCH` | 200 | unfiltered LDBA/L, DEVC/K |

Endpoint: `/sap/bc/adt/repository/informationsystem/search`, with
`operation=quickSearch`, `query=*`, `maxResults`. Omitting `operation` while
using the reported `searchObjectType` parameter returned HTTP 400. The customer
parameter name is therefore not a portable contract. Existing exact lookup in
ARC-1 independently uses `objectType`. No customer-system reproduction is claimed.

## Decision and release behavior

The handler owns type normalization: normal searches preserve slash subtypes and
translate friendly aliases; source-code and exact lookup keep their existing rules.
The client URL-encodes the filter before SAP applies the result limit. No local
post-filter or automatic retry without the requested type is used.

Only a filtered HTTP 406 receives the type-specific hint; authorization and other
failures propagate. The hint never copies backend text, including in minimal mode.
Empty results retain generic search guidance and identify any applied type filter.

Read-only dispatch checks on 7.58 and 8.16 confirmed CLAS/OC and DDLS/DF filters
with maxResults=1, plus the NOSUCH refusal. On 7.50, TABL/DS returned both TABL/DT
and TABL/DS: ARC-1 preserves the filter, but that backend ignores its subtype.
