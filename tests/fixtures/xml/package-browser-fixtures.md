# Package-browser fixtures

Captured read-only on 22 October 2026 with main `d3c0191c`, direct Basic auth:

- `package-browser-750-*`: SAP_BASIS 750 SP02, `SABP_UNIT_CORE`.
- `package-browser-758-*`: SAP_BASIS 758 SP02, `SABP_UNIT_CORE_RUNTIME`.

These are projections, not complete package inventories. Root fixtures retain all
native type folders but omit category labels. Expansion fixtures retain at most
two objects per type, their names, technical names, URIs and native descriptions;
other metadata is omitted. All names are standard SAP repository objects.

The actual combined expansions returned 105 and 152 objects respectively. 750
omitted descriptions; 758 returned them, but the direct browser must not expose
them because nodestructure descriptions have previously been misaligned.

Further native controls verified namespace objects on both releases, missing
package empty bodies, more than 16 type folders, and the `AMSD/TYP` folder returning
`AMSD/ASD` objects on 758. Synthetic unit fixtures isolate these cases. No 740
fixture or validation is implied.
