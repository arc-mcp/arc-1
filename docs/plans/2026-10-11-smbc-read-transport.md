# SMBC read and transport routing (#933)

## Root cause and evidence

The KTD parent fix is already shipped. SAPRead still rejects SMBC and transport
check/history cannot map SMBC/TYP to a URI. Native metadata/source and transport
endpoints work on the same object; this is missing ARC-1 routing.

Discovery advertises /sap/bc/adt/bct/smbctyp with blues.v1+xml on 758, 816 and
BTP, but not 750. Metadata for BEL_ACTIVATE_SOT on 816 and namespaced
/AIF/MESSAGEDELETION on BTP confirms SMBC/TYP, packageRef and JSON source/main.
On 816, asking for inactive metadata of an active-only object returns active.
Native transport checks return SAP's package/recording result; BTP correctly
refuses a change-check against the protected SAP-owned /AIF object.

## Plan and review

1. Add only the verified SMBC/TYP alias, SMBC base path and SAPRead type row.
2. Use a small guarded client reader for native JSON. Check metadata when an
   explicit active/inactive version is requested and refuse substitution.
   Omitted/auto preserves SAP's developer view. Do not parse/rewrite its JSON.
3. Reuse existing transport check/history handling through the shared URI map.
   Do not register SMBC in the read/write SDO registry or add SAPWrite support.
4. Test namespaced routing, versions, absence/authorization errors and unchanged
   write refusal. Verify live existing 816/BTP reads and native transport results,
   plus a disposable 758 parent with active/inactive changes and complete cleanup.
5. Update concise tool docs, evidence and snapshots; run full local gates.

Reviewed before implementation: no generic read-only SDO framework is necessary
for one type. Existing guarded fetchSource and shared transport mapping are enough.
The shared URI map also corrects activation/ATC/syntax/navigation routing
(formerly a program URI); existing write and package gates still apply. KTD
parent creation reuses this map instead of a duplicate SMBC path. No new source
create/update/delete capability is advertised. No reusable open PR exists.

Roadmap checked: no dedicated remaining SMBC item; no roadmap impact.

## Validation

Nine of the initial ten regressions failed on main before implementation. Final
coverage checks omitted/auto/active/inactive source selection, missing/substituted
metadata versions, native 403/404 propagation, namespaced transport routing under
a read-only safety configuration and continued SAPWrite rejection. Snapshot review
shows only SMBC added to SAPRead; SAPWrite schemas are unchanged.

Built on main a0fc4cb8 with Node 24.11.1/macOS. Final handler-to-native tests used
HTTPS Basic on 750 SP02, 758 SP02 and 816 SP01, and named-user OAuth on BTP:

- 750: discovery has no SMBC collection and the source request returns native 404.
- 758: disposable $TMP parent ZARC933_MV3YJ13M referenced the existing draft-enabled
  Book service. Active/inactive/auto reads returned the correct distinct JSON.
  Check/history returned local/no-transport state. Deleted the parent; metadata
  404 and empty search confirmed cleanup. Existing services were unchanged.
- 816: BEL_ACTIVATE_SOT read matched raw native active JSON. Check/history returned
  transport recording and bounded assignment candidates, not historical changes.
- BTP: namespaced /AIF/MESSAGEDELETION matched raw native active JSON; history
  returned no current lock/candidates. Check reached SAP and preserved its expected
  refusal to change this SAP-owned object. No BTP object was modified.
- Explicit inactive reads of active-only objects were refused on all three
  supporting systems, rather than returning active content under an inactive label.

Full units, typecheck, lint, policy validation, build, file/schema budgets and
strict MkDocs passed. No full MCP HTTP, PP or BTP customer-owned SMBC lifecycle is
claimed for this patch.
