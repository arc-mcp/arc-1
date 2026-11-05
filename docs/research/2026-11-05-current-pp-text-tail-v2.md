# Fixed PP text tail after owned include-context drift

This is qualification machinery only. It does not change the public capability matrix,
production authorization, SAP role validity, or the accepted PR2 requirements.

The consumed `current-pp-text-tail-v1` attempt at revision
`3adea700e80e6a31930e106c72fc058d16d5d0f5` stopped during fresh native prerequisites.
Its three actors passed identity/scope checks, two classes passed native checks, and
the include failed its full metadata comparison. Seventeen native GETs succeeded;
no mutation was submitted. The program's new native check was not reached.

The include's source and native identity were unchanged. Its earlier metadata was
captured before the already acknowledged program creation and activation. Current
metadata contains exactly one reference to that owned program, a context count of
one, and the corresponding text-elements link. Independently reversing exactly
those three changes yields the original raw metadata byte for byte. This is not
authority to ignore context metadata or adopt arbitrary changed hashes.

The private audit is retained separately. Core report SHA-256:
`40636bb3ed6fd18d6903281843c151d27b354f4cd63f8c72e44ce4c346f9768e`;
ledger `e02c4e65412f0ba24e11ce2c97dc1743408beb02a5d4e6894cddafaf41928049`.
The post-control addendum SHA-256 is
`16a268b16b8816cc55186af91a2ddcde3f0637b477a206beff04afa565693d0b`;
its ledger is `03f7d2cc1e907cea40889721f89c4be064aacbb2b82ac749a6817757eea51f42`.
The three fresh zero-lock searches were delayed after an expired initial session;
they do not establish an immediate lock-free interval. The app-only restoration
receipt does not establish IAM or SAP-role restoration.

## Fixed v2 contract

`prepare-current-text-tail-v2.mjs` prepares only the new compiled
`pr1142-current-pp-text-tail-v2` root. The earlier roots and claims remain consumed.
The new loader verifies all prior nonsecret history plus the failed 30-file attempt,
its audits, and nine additional post-control/application-restoration files. It never
opens the previous credential file or FIFO. Preparation is exclusive, and execution
still requires fresh source, artifact, actor, control, request/task and native-owner
checks. There is no generic owner, resume-offset or relationship override.

The two include states are explicit:

| Stage | Required evidence |
| --- | --- |
| Fresh prerequisites and unfinished workflow | Exact observed owned-program reference, count and text-elements link; full current metadata hash and unchanged source/actor/package/creation proof. Fresh program source and active identity must also pass. |
| Include deletion, after program deletion | The current run has one acknowledged own-program DELETE followed by its exact typed native absence receipt. Only then may the earlier zero-context metadata hash be used. Every other include identity/source/creation field must match its initial observation. |

The relationship proof is intentionally limited to the two captured lexical native
documents. Foreign, duplicate, nested, moved or changed references, links and opaque
fields refuse. An uncertain parent deletion or generic 404 cannot authorize the
second state. If SAP returns any additional difference after deleting the program,
the attempt stops and preserves the remaining owners for inspection.

The shared native read entry and reverse-deletion checks use this same fixed
profile. Owning typed-absence evidence is retained in the current result before
the next owner is considered. Source/history, cancellation, final-dispatch deadline,
attempt limits, no replay and truthful partial-result behavior remain shared.

Only the unfinished program text proof, accepted negative-route/recording checks
and reverse PP cleanup remain. No acknowledged CREATE, source UPDATE or activation
from either previous run is repeated. No native phase is authorized by this source
checkpoint; independent review, current user/role validity and fresh operator
prerequisites remain required. Basic-target and non-ADT PP acceptance, other native
families, and final restoration/release review remain separate accepted gates.
