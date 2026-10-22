# Legacy DDIC: what existing APIs can provide

Investigation [#1066](https://github.com/arc-mcp/arc-1/issues/1066), following
[#996](https://github.com/arc-mcp/arc-1/issues/996). No 740 system was available.

## Decision

Keep native DTEL support and the existing read-only TABL fallback. Do not add a
transparent-table write fallback or claim complete legacy table metadata. There is
no verified native replacement for missing 740 SP04 DTEL editing in this investigation.

## Evidence

Read-only controls on 22 October 2026 used ARC-1 1.7.0 (`7b210cbf`), verified
SAP_BASIS 750 SP02 and 758 SP02 component metadata, TLS and the configured SAP identity.

| Native request / public client | 750 SP02 | 758 SP02 |
|---|---|---|
| `GET /ddic/dataelements/XUBNAME` | 200, v1 XML | 200, v2 XML |
| `GET /ddic/tables/T000` | 404; collection absent from discovery | 200; collection advertised |
| `GET /ddic/structures/T000` | 200, structure metadata | 200 |
| `getTabl('T000')` | `define type`, 1,077 characters; no table category/delivery class | `define table`, 1,190 characters; both annotations present |

Paths above are relative to `/sap/bc/adt`. Native reads succeeded; no create/update/
activation or SAP configuration change was attempted. The 750 fallback is useful for
field/type inspection, but its source is **not equivalent** to a complete table definition.
It must never be replayed as a transparent-table write. This corrects the older
[TABL research](abap-types/types/tabl.md) assertion that both routes return identical source.

[SAP's feature matrix](https://community.sap.com/t5/technology-blog-posts-by-sap/adt-feature-availability-matrix-for-as-abap-releases/ba-p/13027468/page/2)
places the native data-element editor at 7.50.
[SAP's table-creation documentation](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/creating-database-tables)
requires 7.52 SP00 for that editor. These are editor prerequisites, not proof that
every earlier endpoint is absent. Likewise, the broad `/ddic/*` namespace in SAP's
backend guide does not prove support for `/ddic/dataelements` on 740 SP04.

## Alternatives and boundaries

| Option | Assessment |
|---|---|
| Existing `/structures/.../source/main` read fallback | Useful today for legacy field/type source; incomplete table semantics on tested 750 |
| Discovery and type-specific metadata | Use actual advertised endpoints and response contracts; a release number alone is insufficient |
| GUI integration/VIT object links | Navigation evidence, not a verified serializable DTEL/table editing API |
| Read DDIC catalog tables with SQL | Would require working preview/SQL plus data permission; not a replacement on SP04, and not permission to broaden source reads into data access |
| Route transparent-table writes to structures | Reject: #285 documents subtype corruption; keep the current write resolver and discovery gates |
| RFC, temporary ABAP or installed helpers | Outside core under [ADR-0009](../adr/0009-abap-execution-and-rfc-belong-in-extensions.md); any extension is a separate approved design |

## Work possible without 740

Maintain the v1/v2 DTO and legacy error fixtures, read/write route separation, package
gates and no-retry-after-uncertain-create behavior. An empty HTML success response is
still an ARC-1 error, not an empty definition. Existing #996 fixes cover that distinction.

Before implementing another backend path, obtain a sanitized successful **native ADT**
exchange for the exact operation: method, path, MIME type, body shape, release/SP and
authorization context. Then add a failing contract test, implement the smallest adapter,
and repeat read-back/activation/cleanup on that backend. A mocked 740 fixture alone
cannot establish availability. The reporter checklist is tracked separately in #1063.

This investigation resolves the present alternative assessment; it does not complete
740 support. No additional roadmap feature is proposed without a proven native contract.
