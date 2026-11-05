# Pinned CTS rich inactive-object inventory

The retained CTS release stopped locally before any release-job POST. A fresh read of the same native
rich inventory matched the refusal response exactly: HTTP 200, 21,127 bytes, SHA-256
`a41870c2e23e759bcd4ff35091334a204a359cdc8af5e5f834b1c796708bfff8`.
Its 54 entries comprise eight request headings, one empty slot, 29 unassigned objects and 16 assigned
objects. The earlier 64-entry receipt contains six inactive components assigned to the selected task;
it must still block release. The two full inventories remain private; the committed fixture contains
only sanitized representative shapes.

| Native form | Required evidence | Meaning for release |
| --- | --- | --- |
| Request heading | Present empty object; qualified transport reference, user and `linked=false` | Validates the heading, but establishes no inactive object or authority |
| Empty slot | Both containers present and exactly empty | No object/assignment in this slot |
| Unassigned object | Qualified object reference/user/deleted flag; exact empty transport container | Explicitly no CTS assignment; a missing container or partial reference is refused |
| Assigned object | Qualified object and canonical transport ID, `/RQ` type, matching URI and optional canonical parent; exact boolean `linked` | Selected task or parent always blocks, including `deleted=true` and `linked=false` |

The observed assigned rows include both values of `linked`; it does not determine assignment. Object
`parentUri` is navigation metadata only. It never supplies a CTS assignment, package, ownership or a
follow-up URL. Missing/foreign/duplicate/nested references, unknown fields, ambiguous flags, paging,
count metadata, over-bound inventories and incomplete/non-200 responses remain refused. The whole
inventory is classified before deciding that selected inactive objects block release.

The class DELETE re-recorded its exact R3TR CLAS row after successful explicit record removal. A
nonempty request containing that now-absent class is not an empty request, and a typed class 404 does
not provide package information. Existing CTS release admission uses its real canonical request/task
membership and the request policies; this correction adds no package fallback or transport authority.
Offline actual-body replays and intercepted release-job POSTs test that boundary. They do not qualify
native release, downstream transport, or the still-unattempted management workflows.

Any next native attempt needs a new fixed claim, the consumed histories, fresh request/task and
inactive-inventory evidence, and the existing source, deadline and lock controls. It must skip completed
class operations and task reassignments. This change does not alter legacy inventory parsing, the
public surface, request/package policies, mutation budgets or owning cleanup.
