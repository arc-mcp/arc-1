# Classic secondary indexes — #938 / FEAT-72

## Contract and scope

Verified 12 October 2026 on SAP_BASIS 758 (S/4HANA 2023), 816 (2025), and
BTP ABAP 920. ARC-1's public dispatcher ran locally: HTTPS Basic to on-premise
SAP and the existing named-user OAuth client to BTP ABAP. This does not qualify
a deployed CF/XSUAA/Principal Propagation route. Tested code is the implementation
in this PR, based on `150dc8b9` (before documentation/test-only final changes).

Classic transparent-table indexes use `TABL/DTI` and the name `TABLE~INDEX`.
The existing server-driven engine fits their lifecycle; no separate CRUD engine
or bundled AFF schema was needed. SAP remains the semantic validator.

| Operation | Verified native request |
|---|---|
| Metadata | GET `/sap/bc/adt/ddic/db/indexes/<table>~<id>`, Accept `application/vnd.sap.adt.blues.v1+xml` |
| Source | GET/PUT object `/source/main`, `application/json` |
| Create | POST collection, blues v1 `blueSource`, type `TABL/DTI`, name, actual parent packageRef and TABL/DT containerRef |
| Save | Lock index → source PUT with lockHandle and explicit or lock-returned corrNr → unlock; no activation |
| Activate | Normal ADT activation/preaudit, then repository-state verification |
| Delete | Existing advertised deletion check → locked DELETE → unlock → metadata 404 |
| Listing | Empty-body POST `/sap/bc/adt/repository/nodestructure?parent_type=TABL%2FDT&parent_name=<TABLE>&withShortDescriptions=true` |

Listing Accept is
`application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.RepositoryObjectTreeContent`;
Content-Type is `application/xml`. Read the parent first so a missing table cannot
look like an empty index list. The XML tree contains `TABL/DTI` nodes: `OBJECT_NAME`
is the short index ID, `OBJECT_URI` the native URI. `TECH_NAME` is padded CTS-style
text and must not be split heuristically. The similarly named objectstructure GET
returned unusable repeated URLs on the test system. Native fixtures are in
`tests/fixtures/table-index-{nodes,metadata}-758.xml`.

Default reads explicitly request `version=inactive`, returning an available active
version when SAP has no pending draft. This follows the two-user technical-settings
finding: an unversioned GET can hide another user's draft. Explicit version requests
must match native metadata. Full JSON updates intentionally replace a pending source;
they do not promise field merging or optimistic concurrency. On 758, a saved index
can report `new` even after an earlier activation, and source PUT ignores header
description edits. The integration test changes actual index fields and verifies
the saved definition plus final active state instead of assuming metadata conventions.

## Qualification and failure cases

The public SAPRead/SAPWrite/SAPActivate path passed on 758, 816 and BTP:

- Owned table populated with two rows; fresh listing empty, then correct before and
  after activation. Non-unique CLIENT/STATUS index activated and read back.
- Changing a non-unique index to unique required database conversion on all three.
  ARC-1 returned SAP's refusal; it did not run a conversion.
- After deleting and recreating a fresh unique CLIENT/STATUS index over duplicate
  data, 816/BTP returned activation errors. **758 returned only a warning, and its
  metadata nevertheless reported active.** ARC-1 therefore treats relevant index
  activation warnings as unverified database state, retaining SAP's warning. It
  does not classify truncated/localized SAP message text or claim a rollback.
- Replacing the definition with unique CLIENT/EXTERNAL_ID (distinct fixture values)
  activated through batch activation and read back active. Making the index identical
  to the primary key was separately rejected by SAP (DT509).
- Public deletion, then class/table fixture cleanup, returned metadata 404.

758 recording-package qualification passed: create with explicit transport, update
using the lock-returned transport, separate activation, then deletion. SAP recorded
`LIMU INDX` with the table name padded to 30 characters plus index ID; the parent was
`R3TR TABL`. Package inheritance came from the actual table. The test removed the
owned tasks/requests, moved the owned table to `$TMP`, deleted it and the empty package,
and verified absence. An initial harness run omitted the responsible SAP user when
creating the package; it created only an empty request, which was deleted before retry.

750 lacks the advertised collection: public read/list/create/activate refuse it.
Namespaces have unit coverage only. Foreign-lock and package/scope refusals, partial
creation, no transient PUT replay, complete source replacement, malformed listing,
version selection and encoded activation URIs have regression tests. The committed
integration test covers a repeatable public lifecycle without data population.

## Limits

No automatic database conversion, index selection/tuning, guarantee of performance,
physical database-catalog verification, CDS table-entity variants or XINX support.
Metadata alone cannot prove database creation. Warning-free activation plus native
active metadata is the success contract; warnings or unavailable state require review.
A lost activation response leaves an unknown result: inspect SAP before retrying.
On-prem recording CTS was tested on 758; BTP used the existing authorized development
package. No customer data or pre-existing repository objects were modified.

Roadmap FEAT-72 now distinguishes this implemented classic-index contract from the
remaining CDS/XINX research. The model guidance is preserved; the per-tool byte ceiling
increases 23,000→23,300 for full on-prem schemas and the BTP token estimate 17,350→17,450 for the new instructions.
The total writable-tool wire ceiling remains 74,000 bytes.

Final review probe: a newly created, never-activated transparent table returned an
empty native index tree and public `[]` on 758 and 816. The suspected empty-body
case was not reproduced; keep rejecting malformed/empty responses rather than
silently claiming no indexes. The BTP repeat was blocked by the stopped system.
