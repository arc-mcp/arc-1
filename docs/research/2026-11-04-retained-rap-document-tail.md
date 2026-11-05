# Fixed retained RAP/document tail

The failed `pr1142-native-rap-documents-v1` claim at c9b3 remains consumed. Its nine
completed stages, SKTD creation acknowledgement and separate 38-GET inspection are
bound by the private operator audit (1,230 files). No original CREATE, generation or
pool/BDEF batch activation is repeated. See the [parent-link correction](2026-11-04-rap-document-parent-coupling.md).

`native-rap-retained-entry.ts` compiles one suffix, `8E66923BDEF5`, and a new root,
`pr1142-native-rap-documents-retained-v1`. It uses the shared prepare/preflight/check/
execute phases and the same RAP driver, transport fence, production factories, owning
cleanup, bounded deadlines and terminal checks. There is no caller-selected resume,
root, source, stage or fixture. Preparation/check remain offline; check does not grant
execution. Source review and fresh native controls are required before execution.

The actual captured native states are:

| Resource | Native state |
|---|---|
| TABL/DT and its implicit TABL/DTT | active |
| DDLS, behavior-pool CLAS and BDEF | active |
| SKTD/TYP | inactive, including the response to an active-version query |
| SRVD/SRVB | never created in the original run; fresh typed absence required |

Fresh adoption matches all 38 captured raw metadata/source body hashes and then applies
production identity/state/source readers. The generated CCIMP and all other observed
class includes stay exact. The preflight inactive inventory must be valid, but is not
reported clean while the document is retained. Existing-owner failures preserve all six
resources; an unexpectedly present or uncertain service/binding is also listed for
inspection without acquiring ownership.

The actual 7,513-byte SKTD body has six nodes. Its root short text is forbidden;
create/update short texts are optional. The approve action's long text is mandatory.
The first unfinished step therefore uses an ordinary update with a fresh metadata hash,
explicit headings for the root and the exact `BDEF/BAC` approve node, and no short-text
change to the root. The existing separate create/update node edits follow after first
activation; their earlier text and the approve text must survive. These are actual native
slots, not the earlier smaller synthetic node fixture. Other nodes/opaque content remain
unchanged. Native acceptance of the new text and activation remains unobserved.

The 18-stage tail then creates/activates SRVD and SRVB, observes publication/unpublication,
deletes the owned document, and performs the existing reverse graph cleanup. The parent
link's removal is accepted only under the separately reviewed same-owner transition.
Generated binding cleanup and recording retain their explicit native-governed/unverified
limits; no arbitrary generated child or shared service authority is added. Unrelated
inactive objects and global locks are not acquired or removed. Operator SM12 controls
remain separate actual UI evidence.

Results distinguish historical retained resources and completed prefix from new creates,
newly completed tail stages, confirmed deletions and current residuals. An ambiguous write
stops without retry or rollback. Future phases cannot reuse the old or new consumed claim.
No current PP/public/whole-PR qualification follows from this source candidate.
