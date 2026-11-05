# DDIC DDL source readback normalization

The A4H/001 collections attempt at `757a7cef0e3a4bec73f08fb59ab29c964572bc05` returned a structure
source with two additional empty code lines. POST create and source PUT completed, but the shared
pinned source lifecycle correctly reported `created-source-unknown`: its generic comparison allowed
CRLF/final-newline changes only. This affects ordinary valid structure input, so changing only the
experiment fixture would leave a production compatibility gap.

The retained own-fixture request/readback is in
`tests/fixtures/adt/structure-source-a4h-readback.json`. Requested SHA-256 is
`35302f92ce9ec1e7f627050cac985e177940347c90f58ab0eb15a88b611d0e0c`; stored SHA-256 is
`d43f070a565b803b577110c004c64a1cc10e77bfed5714b103dc04b319208ce4`.
Original failed result `69ee03b39d67b22ff71d6e43c8a0e744e05b8586943429bc878fb308680961b5` and its
claim remain consumed. Subsequent default/active-request/inactive-request metadata all explicitly
report **new**, not active; each source view returns the same stored bytes. No activation or deletion
has been qualified by this observation.

## Narrow production proof

Only resolved `TABL/DS` and `TABL/DT` use `prepareDdicDdlSourceVerification` in the shared pinned
source-save callback. The proof removes complete **empty** lines outside proven quoted/comment
spans. The 4 November table follow-up also permits an existing internal code separator to contain
different runs of spaces/tabs. Separator presence remains exact: no token boundary is inserted or
removed. Indentation, trailing whitespace, whitespace-only lines, case, annotations, field/type/value
bytes, literal contents and comment text remain exact. Empty lines inside quoted
strings/identifiers or block comments remain exact. CRLF and terminal-newline normalization retain
the existing policy. No blanket whitespace stripping, token equivalence or caller flag is introduced.

The bounded scanner recognizes single/double quotes with doubled and supported backslash escapes,
`//`/`--` line comments and non-nested `/* ... */` comments. Nested comment openers and paired
backslashes within double quotes refuse because their boundaries are not qualified here. Unclosed
spans, unmatched block-comment
closers, unknown backtick delimiters, ambiguous backslash/newline continuations, unqualified control
separators and sources above 1 MiB refuse. This is a lexical preservation proof, not an extra DDL
compiler or a claim that arbitrary native syntax is supported. The installed CDS lexer is unsuitable
as the proof because it drops block comments and normalizes additional characters.

The expected proof is prepared before the source PUT. Existing-source `expectedSourceHash` remains
an exact SHA-256 checked under the owning lock, even when two sources would compare equivalent for
readback. Success returns the hash of the actual stored bytes. Unexpected stored content remains
`source-save-unknown`/`created-source-unknown`, with no replay. A create may already have made its
owner before source-proof refusal; that result stays `created-source-not-confirmed` and is retained,
without compensating deletion. Owning cleanup remains available.

The collections snapshot reuses this same proof against intended fixture content. Its native-version
checks, exact cross-view stored hashes and activation's accepted-stored-hash comparison are unchanged.
Class/interface/program/CDS/function and other source profiles retain their existing comparisons.
The real native normalization was observed on one structure and one table. A complete table lifecycle
and current PP/recording qualification remain separate evidence obligations.

## 4 November table alignment observation

The independently reviewed `bf4b7590a60f666ea961a3a2ecad955ce3668183` native table graph stopped
after acknowledged table create/source save, before activation. SAP additionally aligned spaces before
the field colons. The unchanged proof refused those stored bytes as `created-source-unknown`.
The table and implicit technical settings remain retained; the claim is consumed, with no automatic
replay or compensating deletion. Owning cleanup and both post-run SM12 searches report no lock leak.

The exact own-fixture sources are in `tests/fixtures/adt/table-source-a4h-readback.json`.
Requested SHA-256 is `854084ad7bc099135630b5a13a268f60e1466860e5d9d158c2c4c274bf5653fb`;
stored SHA-256 is `a9b595f9d35811a62397d8d8ff4a846c8b77f531371451eae83665f43ab11a46`.
The follow-up scanner collapses existing internal horizontal separators only while in proven code.
Quoted strings/identifiers and line/block comments keep all their bytes. The exact raw optimistic
hash check, actual stored-source hash, lexical refusals and generic source comparator are unchanged.

## Review and remaining qualification

Offline tests reproduce the original production failure from exact captured bytes, then verify the
corrected actual writer/snapshot composition. Controls preserve literal/comment contents, refuse
changes outside the two qualified formatting differences and malformed lexical boundaries, reject stale hashes before PUT, report the
observed stored hash, keep uncertain submitted outcomes and preserve owning cleanup. No native phase
runs as part of these checks.

A separately reviewed retained-owner continuation must bind the original failed evidence and fresh
exact new-state/source observations, omit repeated CREATE/initial PUT, and require fresh typed
absence before the two unattempted owners are introduced. This correction itself neither creates
that continuation nor authorizes it, and grants no public/PP/merge approval.
