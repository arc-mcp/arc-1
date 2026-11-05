# Native LOCAL package result and retained owners

The fixed run at `fc14a7465cf10eed29b5e0291f33b3310e8a5ac0` created its parentless LOCAL root,
child package and class, then activated and verified the class on A4H/001 as MARIAN.
It stopped when deleting the non-empty root returned HTTP400 without a recognized refusal.
The specific non-cascade contract remains unqualified; cleanup did not run.

The [independent source review](2026-11-03-native-local-package-review-verbatim.md) and
[execution audit](2026-11-03-native-local-package-execution-audit-verbatim.md) are retained verbatim.
The audit verified 256 original protocol files, nine operator files and 15 separate inspection
files unchanged, including 109 retained body hashes, 23 canonical snapshots and 13 fresh bodies.
This is Basic-native evidence, not PP, public qualification or merge approval.

## Exact result

The 214 attempt rows span 3 November 2026, 09:31:30.812–09:31:48.099 UTC.
The used GET-only preflight was `AB1A9102C35FD216`; an earlier sample remained unused after
WebGUI sign-in consumed its freshness. Actual suffix/user searches and the offline check preceded
execution; no active or queued CI was observed immediately before the attempt.

| Retained owner | Fresh observed state |
| --- | --- |
| `$ARC1_PK_R_A5CD6186AFDACA31` | Active parentless LOCAL root with the declared child |
| `$ARC1_PK_C_A5CD6186AFDACA31` | Active LOCAL child belonging to the exact root |
| `ZCL_ARC1_PK_A5CD6186AFDACA31` | Active class in the exact child, with matching source |

The DELETE error record contains status400, 700 bytes and SHA-256
`76ae8e3c1718995163603b756d1210fd9bf608c4ac0a87dc9fb9eb3af1fe5864`.
Its raw text was omitted by the shared observer because the request contains an opaque lock handle.
The adapter result is also digest-only. Consequently, this packet cannot distinguish an unsupported
PAK051 encoding from a different native refusal. It must not be relabelled a successful negative test.

Owning cleanup reported no failed unlock and a closed session. Fresh actual SM12 searches at
09:34:27.463 UTC (MARIAN) and 09:35:22.156 UTC (suffix across users) both showed zero locks.
The preceding timed-out WebGUI observation is preserved separately and excluded.
Thirteen later GET-only reads matched all three pre-DELETE metadata receipts and the class source.
Their inactive queries returned active fallback; they do not prove separate inactive versions.

The original attempt is permanently consumed. A separately reviewed continuation must bind these
exact retained receipts and clean up class, child, then root, using the normal owning lifecycle and
typed absence checks. It must preserve the unknown400, capture sufficient non-secret diagnostics
for future failures, and not repeat the original DELETE merely to retrieve its lost message.
The remaining non-cascade qualification requires separate evidence after cleanup.

Private protocol root: `~/.local/state/arc1-qualification/pr1142-native-local-package-v1`.
Operator packet: `~/.local/state/arc1-review/pr1142-native-package-execution-20261103`.
Audit SHA-256: `42aa168b6bd38ab18cd6464e091b72184cd63dfffb301e9a54fb45f68777eaa7`;
ledger: `d3de6a3131fcbd81e75fe4c4f70b4160b119b1478c5bec6bb42654b02b16e5b6`.
