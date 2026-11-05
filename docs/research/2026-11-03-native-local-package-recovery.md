# Fixed retained LOCAL package cleanup

Execution update: the exact reviewed `71e1af3c82603dfe6d7ab58bc834d615aef1d1d3` candidate completed once on 3 November 2026. The [independent actual-execution audit](2026-11-03-native-local-package-recovery-audit-verbatim.md), SHA-256 `4c25c96b00ed9c7cf6638585d858c265aacae8b1b8596d595e69aa8fb3076d31`, confirms deletion of all three owners, typed absence and successful owning cleanup. The claim is consumed. The design and pre-execution constraints below remain historical; non-cascade refusal and PP remain outstanding.


Status: offline candidate, awaiting independent exact-source review. No recovery intent,
preflight, baseline, claim or native operation was executed while authoring it. Basic-native cleanup
is separate from public admission, PP qualification, noncascade qualification and whole-PR readiness.

## Preserved failure and retained ownership

The original `pr1142-native-local-package-v1` attempt at
`fc14a7465cf10eed29b5e0291f33b3310e8a5ac0` created the parentless LOCAL root, its real child
and the contained class, then activated the class. Its first negative root DELETE returned HTTP 400.
The observer intentionally suppressed the lock-bearing response body; only its 700-byte length and
SHA-256 `76ae8e3c1718995163603b756d1210fd9bf608c4ac0a87dc9fb9eb3af1fe5864` survive.
The full adapter error is also digest-only. Neither the status nor the digest identifies PAK051.
No cleanup occurred and the claim is permanently consumed. The refusal classifier is unchanged.

The independently audited failure result is
`22a2901a427c42d01ae7e0747c4ec0d84b58474f984f10a793825e8450a7bbcc`. A separate fixed GET-only
inspection observed the same exact active metadata and class source for all three retained owners.
Explicit `version=inactive` queries returned active metadata/source and are not treated as drafts.
Fresh post-failure SM12 searches showed zero matching locks; owning unlock/session predicates were
confirmed. These observations do not establish fixture absence or a successful noncascade refusal.

The recovery binds the audit Markdown/JSON hashes, all 256 original protocol files, nine operator
files, all 15 fresh inspection files and the three audit-bound external proof files. It never edits
or reopens any of them. Current exact source/runtime binding is independently enforced by the
existing `nativeLockBinding`; historical source hashes are retained as history, not represented as
the changed recovery source. Owned native XML fixtures exercise the observed canonical hashes;
they contain no standard SAP source, credentials, lock handles or unrelated inventories.

## One fixed cleanup chain

The separate entry `scripts/qualification/pr1142/native-package-recovery.ts` owns only the new
`pr1142-native-local-package-recovery-v1` root and suffix `A5CD6186AFDACA31`. The immutable graph is:

| Order | Exact retained owner | Required relation |
|---|---|---|
| 1 | `ZCL_ARC1_PK_A5CD6186AFDACA31` | Class in the child package; exact active source hash `8983b81cbe288e20cc351c6dc91492cdcc002a65bf0d383bb963b0a79b1ff6cb` |
| 2 | `$ARC1_PK_C_A5CD6186AFDACA31` | Exact real root parent; LOCAL/development, non-recording, empty layer |
| 3 | `$ARC1_PK_R_A5CD6186AFDACA31` | Explicit parentless LOCAL root with native responsibility/author MARIAN |

There are no creates, source writes, activation, negative DELETE stages, arbitrary owners or
caller-supplied receipt overrides. Both package policies authorize exactly the two retained packages;
both request policies explicitly contain `*`. The normal shared delete profiles retain native CTS
checks, owning locks, under-lock preconditions, positive package-browser shortcuts and typed absence.
Package browsing never substitutes for package authorization. Only the declared child-reference
change may alter the root metadata projection after confirmed child deletion; all other metadata
values and class source remain exact. Deletion is not cascading and no hidden helper is introduced.

The original phase lifecycle is shared explicitly. The fixed cleanup flags are
`--prepare-reviewed-local-package-recovery-v1`, `--preflight-reviewed-local-package-recovery-v1`,
`--check-reviewed-local-package-recovery-v1` and `--execute-reviewed-local-package-recovery-v1`.
Each requires the full independently reviewed SHA; check/execute also require the returned preflight
ID. They are operational descriptions, not authorization to run this unreviewed candidate.

Prepare is offline and creates a new immutable intent once. The bounded GET-only preflight reads
all three exact retained receipts and a valid suffix-free inactive inventory with writes disabled.
After preflight, capture fresh raw JPEG SM12 suffix/user searches for client 001, table `*`,
user `*` plus argument `*A5CD6186AFDACA31*`, and user MARIAN plus argument `*`. Both must visibly
show complete zero-lock results, without timeout/error. The receipt binds their hashes, observation
times, exact intent/revision and preflight ID. Check is read-only and nonclaiming; it gives no execution
grant. Execute claims once before loading credentials and repeats all source/history/prerequisite
checks. An execution refusal also consumes that new claim. Never retry a claimed attempt.

Before execution the operator must confirm no SAP CI or other native activity overlaps, keep the
host awake, visually inspect both actual images, and use the exact clean reviewed checkout and
supported Node runtime. The environment guard, actual final HTTP boundary and original baseline
freshness remain enforced. Source/history/policy/stop/deadline checks repeat after queue, auth and
CSRF waits and after the inherited attempt budget is consumed. Owning unlock/session closure retains
bounded cleanup capacity when ordinary work stops. No automatic rollback or replay occurs.

After each native DELETE, independent typed absence and owning cleanup are required before the next
owner. Final absence of all three exact owners and a valid suffix-free inactive inventory are checked
again. Failures preserve dispatched/confirmed facts, remaining owners and required inspection; even
a late source/history failure cannot erase confirmed deletion. Capture new post-run SM12 searches
and independently audit the saved outcome before declaring cleanup confirmed.

## Future error evidence and remaining acceptance

Recovery DELETE exceptions additionally retain a bounded diagnostic projection: status, raw body
length/hash, native exception namespace/type, T100 properties and message/language fields. Exact
owning handles (including encoded forms) are redacted; credential/session fields and unknown property
values are omitted. Malformed, ambiguous or oversized envelopes remain digest-only. This is explicitly
a projection, never a reconstructed raw error or an automatic success/refusal classification.
The shared observer continues suppressing lock-related raw bodies.

Successful cleanup would resolve only these retained owners. The minimum later representative
noncascade experiment remains a fresh, separately reviewed LOCAL root + child + contained class:
prove one unambiguous native root refusal while its child exists and one child refusal while its class
exists, with diagnostic evidence and matching survivor receipts, then perform changed-state class →
child → root cleanup. An ambiguous failure must stop; repeating it to recover missing text is not
authorized. A clearly classified refusal followed by deletion after its blocker is removed is a
declared state transition, not replay of an ambiguous mutation. This second experiment is not
implemented here. Recorded-package selection and current-build PP/public evidence remain separate.
