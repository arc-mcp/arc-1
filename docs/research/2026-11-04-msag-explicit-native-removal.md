# Native MSAG explicit removal — private correction

The independently reviewed retained collections attempt at `fc00ebcc4cea89adc8ad9f3476daf63c1e258055`
submitted one MSAG PUT and stopped with `metadata-save-unknown`. SAP saved updated001, unchanged002
and added004, but retained omitted003. Exact row-membership verification correctly refused; it is
not relaxed by this correction. No DELETE or activation followed. All three retained owners remain.

The private actual-execution audit binds all237 protocol/operator/inspection files, the original
710+263-file histories, the31GET/8POST/1PUT dispatch ledger, owning-session cleanup, and the fresh
post-run zero-lock observations. Its report SHA256 is
`a098c9a5593e7ba08030f07d3df2636cbf804542ddf81ae1378246a7ce66e7ee`; its JSON ledger is
`1e1f8e46e2608fdd097e6c3cae24c9fd43f5b75a0999339adbdd68db01d7cdde`.
The consumed result is `e85321fd98d952e9480737901f37902f747dd0a9d927651d2e5e65a14740abb1`.
The four-row inspection body is `1dd99bf6e3531e546299586e7346740e148b86778353d7c0eaaf2f331a3c48f0`.
The repository fixture rebinds only its generated owner suffix; it contains the complete owned native
metadata, not a projected approximation. It is read evidence, not proof of a successful removal.

Root captured the active A4H/001 SAP_BASIS758 standard controller and transformation through bounded
GETs. Proprietary source stays in the private evidence packet. Exact source hashes:

- `CL_ADT_MC_RES_CONTROLLER`: `04def65ec25a2c1312077a85680178f30a07acc4a5b498b469053dab8e14c3fc`.
  `do_update` first upserts ordinary rows, then calls the native message-class API delete for each
  `tt_deletedmessage` entry. The older omitted-row deletion loop is commented out.
- `ST_ADT_MESSAGE_CLASS`: `208629802c2137a0045b723a021a7fb56a62dd55f0b714385403ad19d762f96b`.
  Its native instruction is a direct `mc:deletedmessages` child with an explicit `mc:msgno`, in
  `http://www.sap.com/adt/MessageClass`, within the same existing PUT document.

The private lossless builder now separates the submitted wire document from the intended persisted
document. Only validated stored numbers absent from a requested complete replacement generate
instructions. Each instruction has exactly the native number attribute: no caller-provided marker,
transport override, lock handle, text, or extra field is admitted. Legitimate stored000 can be removed;
a missing, malformed or duplicate number cannot default to000. Description-only updates emit none.

Native ordinary-row `corrno` and `lockhandle` can override recording/session context in this captured
contract. Nonempty values, including whitespace, refuse before PUT by expanded namespace/name;
explicit empty values remain inert and preserved. The captured controller also deletes long text for
the `selfexplainatory=true` and `documented=true` pair. Such stored state is not declared invalid SAP
data, but this adapter refuses to resubmit that operational combination, including description-only
updates. Ordinary false/true and true/false combinations and unrelated opaque attributes stay intact.
No additional long-text API, request selector, call or permission is introduced.

The same owning lock, package/recording checks, source/hash preconditions, URI, bounded no-replay PUT,
and own-session cleanup are retained. Readback cannot contain transient deletion instructions and
must exactly match intended membership and all preserved state. If SAP retains a removed row or
returns an unknown result, the single submitted update remains unconfirmed; no retry occurs.
Legacy single-target builders and non-MSAG profiles are unchanged. The retained observer helper
uses the same wire/persisted split, but neither consumed root or its frozen source is reopened.

Offline tests use the actual handler/client/HTTP composition and a native-style mock that retains
omitted rows until explicit instructions remove them. They cover the captured four-row state,
operational refusals, native aliases,000, malformed numbers, opaque state, readback contradictions,
exact hashes and owning cleanup. This source candidate still requires independent review. A separate
new fixed continuation must bind both consumed histories, adopt the actual four-row state, perform
only the unfinished explicit003 removal, then clean up MSAG, TTYP and structure in dependency order.
No native phase, PP evidence, public admission or merge readiness is asserted here.
