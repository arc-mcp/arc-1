# MSAG native row preservation

The A4H/001 SAP_BASIS758 collections v2 attempt stopped after creating its message class. Native
POST, locked PUT and own UNLOCK succeeded; the adapter correctly reported `created-active`. The
qualification observer incorrectly expected inactive metadata. No MSAG update or deletion was sent.
The independently audited run and all three retained owners require a separate fixed continuation.

Offline replay of complete native row651 and the three later metadata views exposed another safe
refusal: rebuilding a message class discarded each row's Atom links and native modification fields.
The full metadata projection refused that loss before PUT. This correction changes only the private
MSAG update profile; the ordinary single-target builder and other DDIC projections are unchanged.

The update now carries the complete stored XML, matches native rows by unique three-digit message
number, edits only selected texts/description, removes explicitly omitted rows, and builds new rows
with the existing ordinary builder. Stored flags, opaque fields and known links survive on retained
rows. Namespace aliases and attribute text cannot redirect the edit. Native message/long-text links
must identify this exact class and number; foreign links, unknown link relations, duplicate numbers,
unsupported row identities and malformed bookkeeping refuse before PUT. No link is followed.

The complete post-save proof checks exact row membership and text, unchanged opaque state and
root metadata. Only validated row modifier/date bookkeeping can change natively. Added rows may
acquire the observed empty native name and exact native message/long-text links; unknown additions
still refuse. Existing row links cannot silently disappear. The returned metadata hash remains the
actual native document projection; optimistic preconditions and owning lock/cleanup are unchanged.
This is source compatibility evidence, not completed native update qualification or PP evidence.

Private evidence:

- Original row651 body SHA256 `df62cf768c90efb1c5a4b44f443e3d3fe28a971548edd84ac39cf4cd4b8884e3`.
- Actual stopped result SHA256 `866e13b09a1f991258e9222255d80e0864a22b5b5b66894ddd96ac888a360a46`.
- Independent audit SHA256 `a9758e49adb2596338bb18ade712c4d18b460c7af23c2264eb7b9dfc45b6b323`;
  ledger SHA256 `d4959197799077b5c54ea48c89fc647548e880270a331ee7dfa33e69bbff5000`.
- The committed regression XML keeps the complete native document shape, with only its generated
  suffix rebound to `0123456789AB`. It is derived test input, not another native observation.

The separate observer/tail must adopt updated-active structure/TTYP and created-active MSAG without
repeating any completed stage. Keep the original claims and evidence immutable. Independent review
and the remaining bounded native run are still required; public capability admission is separate.
