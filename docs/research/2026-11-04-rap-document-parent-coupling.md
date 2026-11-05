# Owned RAP documentation changes its parent's metadata link

The Basic-native RAP/document run at `c9b3da1b3d1bc0fd5b4f4cbeeda31f36250786b5`
completed nine stages through behavior generation and explicit pool/BDEF batch activation.
Its SKTD POST succeeded, but the qualifier stopped before the first document PUT. The
original claim remains failed and consumed; this correction does not permit its replay.

The native type `SKTD/TYP` is already accepted by production. The actual cause was the
qualification runner's complete BDEF receipt comparison: creating the owned document
added exactly one same-owner Atom DITA-documentation link to the active BDEF metadata.
The BDEF source, active state, authors and other metadata remained unchanged. Its new
link caused the next dependency check to reject before forwarding the PUT. Own unlock
and session close completed. No SRVD, SRVB, publication or repository cleanup occurred.

The owned native fixtures retain the exact captured bodies:

| Body | SHA256 |
|---|---|
| BDEF before document creation (00991) | `2d5e1def11850b3a1f975252f7b34acbe576786b90572d50dd928f24ca6c6fcd` |
| BDEF after document creation (01104) | `35568193c202a7a374019fad121e401999af13dfc741afcb1443ef9b1a968dce` |
| Created SKTD document (01089/01095/01101) | `2ecbaa6831d13537030c5593a7a98a9a3360850d269118731aadeb87932645eb` |

An offline replay of that parent-link delta plus the exact document body through the
original driver reproduced the actual adapter outcome hash
`ada96db299c62320717936863fb50e49baa76539cb3f0d07b4ffaab56c7cf7a9`.
Both production document-body builders agree on the captured document; no production
reader, writer, owner or opaque-content guard needs relaxation.

The qualifier now retains both complete namespace-bound BDEF metadata views alongside
their existing fingerprints. Only after its exact owned SKTD creation acknowledgement
may it adopt the single matching link. Both views, source hashes, native state, identity,
package and every other metadata field/link must remain exact. The relation's href, MIME,
title and complete structure match the observed native contract. Missing, duplicate,
foreign or additionally annotated links are refused. This is an explicit transition;
normal comparisons never ignore documentation links.

The inverse is bounded to the same owned document after its confirmed deletion and a
fresh typed absence check. It permits removal of that one relation while preserving all
other fields. Actual native removal has not yet been observed in this graph; synthetic
tests cover it without claiming a universal cleanup guarantee. Own cleanup and final
send/source/deadline checks remain unchanged.

The original native fixtures still require a separately bound retained continuation:
adopt the table/settings, DDLS, behavior pool, active BDEF and new document; skip every
successful CREATE/generation/batch activation; prove fresh current state; save the initial
document text and complete its remaining draft edits, activation, service/binding,
publication and exact reverse cleanup. The existing failed protocol must not be reused.
Current PP, public-route and whole-PR qualification remain separate accepted-plan gates.
