# Native creator evidence in the current PP observer

The corrected recording-only PP run at `9e947c0bbfbfd2d03d572787589d8f2c693ceb3a` completed two
class write/activation workflows with distinct native creators, MARIAN and ARC1_WG_RO. It stopped
after the include activation response because native active INCL metadata omitted `createdBy`.
The actual owned response is retained as a regression fixture, body SHA256
`233c1574592fa69c594061d3b476d1ff773e24303e6738937a746c30487950d8`.
The consumed run remains failed; no object deletion or retry is implied by this correction.

This changes only qualification code. CLAS still requires the native creator. For INCL/PROG, an
absent creator requires the exact successful PP create response, planned fixture source/package,
recording selection, run/manifest binding and verified actor evidence. The response timestamp and
actor must match the saved create operation. A contradictory or empty native creator refuses;
`responsible` is never substituted. The report records `createdBy: null`, unavailable native
creator evidence and the separate owned-create receipt hash. It does not claim SAP supplied a
creator. Current source/active equality, metadata race checks, changedBy and native recording
checks remain mandatory. A future program observation remains distinct from the observed INCL.

The native worker reads only the current journal and bounded redacted RPC receipts to establish
that provenance; it does not read credential inputs. The PP runner records the actor proof only
after fresh token identity, raw scopes, target grants and expiry checks pass. The native client's
normal authorized credential loading remains the operator's responsibility.

The retained three-owner continuation requires a separate fixed plan and independent review.
No old claim, result, receipt or native source is rewritten; no generic resume permission is added.
Current PP negative-route, program/text, deletion and final recording acceptance remain open.
