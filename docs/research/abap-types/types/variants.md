# VARIANTS — program-variant read limitation

`VARIANTS` is an ARC-1 pseudo type, not a TADIR object type. Its client method requests
`GET /sap/bc/adt/programs/programs/{name}/variants`. No tested backend below serves that resource.
The earlier claims of successful 200/XML reads are withdrawn; they were not supported by a
capture in this repository and conflict with these live checks.

## Verified evidence (November 1–2, 2026)

The 758 and 816 probes used report `RSUSR002`, client 001, with writes and data preview disabled.
The 750 row used the same report through an installed MCP instance.

| SAP_BASIS | Route | Observed result |
|---|---|---|
| 750 SP0002 | Installed ARC-1 MCP | HTTP 404, `No suitable resource found`; the program source is readable |
| 758 SP0002 | Direct HTTPS/Basic, public tool pipeline | HTTP 404; English: `No suitable resource found`; German: `Keine geeignete Ressource gefunden` |
| 816 SP0001 | Direct HTTPS/Basic, public tool pipeline | HTTP 404; English: `No suitable resource found`; German: `Keine geeignete Ressource gefunden` |

On 750 and 758, reading `CL_SEDI_ADT_RES_APP_PROGRAMS->REGISTER_RESOURCES` confirmed that
the registered program resources include metadata, source and revisions, but no `variants` route.
[Issue #1125](https://github.com/arc-mcp/arc-1/issues/1125) independently reports the same failure
on 750 SP23 and 758 SP04 through BTP Cloud Foundry/Cloud Connector principal propagation.
The local checks above do not qualify that deployment route.

## ARC-1 behavior

- Preserve the HTTP error. For the exact variants path and captured EN/DE resource error,
  explain that ARC-1 cannot read variants through this endpoint. The 404 proves neither a
  missing program nor an empty variant list; it does not justify SICF configuration changes.
- Inspect variants with [SE38 in SAP GUI](https://help.sap.com/saphelp_snc70/helpdata/en/c0/980389e58611d194cc00a0c94260a5/content.htm).
- Keep the existing `getVariants` public client method and on-premises tool input for compatibility.
  Successful responses remain unchanged. BTP ABAP Environment excludes this type.
- No automatic table-data fallback is added. Access to `VARID`/`VARIT` metadata would require
  the existing data permissions and separate validation; it would not decode `VARI` values.

Current implementation: `src/adt/client.ts` (`getVariants`), `src/adt/errors.ts`
(`program-variants-unavailable`), `src/handlers/read.ts` (`VARIANTS`).
