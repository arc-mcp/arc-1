# CTS missing-request evidence on A4H/001

One bounded read-only GET on 3 November 2026, using source
`f6a9acbfe077e00d4171a34689196d6867fcec0e` and the native MARIAN identity, requested
`/sap/bc/adt/cts/transportrequests/A4HK000000` with the transport-organizer MIME type.
SAP returned HTTP 404 and a 597-byte XML body with SHA-256
`680cf2891ba25b71e77efd89a4403fdd4dc613fd660c7214404d4398aaf62833`.
The exact body is retained in `tests/fixtures/xml/cts-request-not-found-a4h-758.xml`.
There was no mutation in this observation.

The native exception identifies the communication-framework XML namespace, `com.sap.adt`,
`ExceptionResourceNotFound`, T100 message `SADT_RESOURCE/002`, resource kind
`Transport Request/Task`, and the exact requested transport ID in `T100KEY-V2`.
Localized diagnostic wording is not the identity check.

Previously the post-delete reader required HTTP 200 with an empty typed organizer. That would
leave a successful native deletion unconfirmed on this target. The explicit post-delete reader
now also accepts the captured exception structure, bounded to 32 KiB, with the exact HTTP error
class, status, request path and ID. Namespace changes, missing or duplicate identity fields,
additional properties, a wrong resource kind or ID, malformed XML, generic HTTP 404 and
authorization errors remain unknown. Ordinary initial/preflight reads retain their strict contract.
Membership checks still reject a disappearing parent after only a child was deleted.

The native qualifier uses the same discriminator only for final inspection of round C after
both explicit deletions were confirmed. It retains the raw exception body, status and hash;
released A/B history and unknown residuals retain their existing rules. Neither this read-only
receipt nor synthetic dispatcher replay establishes a successful native deletion or release.
Those operations, independent review and final lock/receipt audit remain required before acceptance.

Roadmap impact: FEAT-93 remains open. This corrects one CTS compatibility requirement without
claiming completion of its native or principal-propagation qualification.
