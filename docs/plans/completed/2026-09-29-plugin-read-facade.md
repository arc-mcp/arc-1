# Explicit plugin read facade

## Root cause and plan

The plugin client used `Omit<AdtClient, ...>` and a runtime denylist. New public and
private TypeScript methods became callable unless someone updated both lists.
`withStatefulSession`, introduced in #879, returns a raw client to its callback;
older writers and SQL variants had also outgrown the denylist. This contradicts
the documented plain-read API even though loaded plugins remain trusted code.

Use one reviewed list of plain reads for both a `Pick` type and a frozen facade.
Bind methods to the actual per-request client, preserving its identity and guards.
Do not change the internal client or its stateful write lifecycle. An allowlist is
preferable to adding another group of omitted methods that can drift again.

## Verification and limits

Ten regression rows fail on main: raw session access, writers, SQL variants,
private POST helpers and a hypothetical future capability. They pass with the
facade. Existing normal-read binding and immutability cases continue to pass.
A local stub demonstrates one write through the old session callback without any
network contact. No SAP service, authorization or object is changed by this fix.
A live `getSystemInfo()` through the built facade succeeded on SAP_BASIS 758
(client 001, direct HTTPS/Basic, 2026-09-29); the facade stayed frozen and exposed
no session factory. This is helper-level read coverage, not MCP/PP end-to-end.
This is an API capability guard, not a sandbox against hostile in-process code.

Roadmap checked: no existing idea covers this regression; no roadmap impact.
