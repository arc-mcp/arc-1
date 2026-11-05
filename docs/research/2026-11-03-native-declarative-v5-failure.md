# V5 native result and retained owners

The fixed V5 run at `59eab1d09c331e605593284700bc180423aa74fe` completed five forward owner workflows on A4H/001 as MARIAN using Basic-native authentication. Both DDLS owners, DCLS, DDLX and the corrected abstract BDEF completed create, activation, source update, activation and readback. SRVD creation and inactive readback also succeeded, but activation refused its fixture comment: **Comments are not supported and will be deleted on save**, together with cancellation EU202. The response is preserved as failure, not active-state success.

The [independent execution audit](2026-11-03-native-declarative-v5-execution-audit-verbatim.md) verified these observations, including 315 body hashes, 66 canonical/source references, the original and operator packets, and the actual valid lock-control images. It does not establish PP, public qualification or merge readiness.

The attempt ran on 3 November 2026; its 956 journal rows span 08:40:12.267–08:41:36.991 UTC. It records six completed creates, ten activations, five updates and four deletes. Cleanup deleted BDEF, DDLX, DCLS and the abstract DDLS. Two exact owned objects remain:

| Owner | Last observed state | Required next work |
| --- | --- | --- |
| `SRVD ZARC1_V5S_3481C958A6CA5AC1` | Inactive initial fixture with the unsupported comment | Separately reviewed, source-bound correction/qualification or cleanup |
| `DDLS ZARC1_V5V_3481C958A6CA5AC1` | Active updated view, retained as the SRVD dependency | Delete after its dependent SRVD is confirmed absent |

The once-only claim is consumed permanently. Historical fixture/source bytes and receipts are unchanged. Replaying all six owners is not required merely to correct this fixture; any retained-owner continuation must bind the original create evidence and fresh exact metadata/source, transparently distinguish the failed attempt, and complete the missing workflow and reverse cleanup.

Fresh GET-only inspection at 08:48 UTC confirmed the exact retained metadata/source, typed 404s for the four deleted owners and expected reference class, and the inactive inventory. Explicit `version=active` requests for the unactivated SRVD still return its inactive metadata/source; the query parameter alone proves no active state. Fresh actual SM12 searches at 08:44:52.329 (MARIAN) and 08:45:07.506 (fixture suffix across users) both showed zero locks. An earlier expired WebGUI result is retained as invalid evidence and excluded.

Private protocol root: `~/.local/state/arc1-qualification/pr1142-native-declarative-v5`.
Operator inspection and controls: `~/.local/state/arc1-review/pr1142-native-v5-execution-20261103`.

| Receipt | SHA-256 |
| --- | --- |
| Intent | `84eb9ccf0466d48d1c4072aa7190ea85ea1c9950e86cf455655b6d4a64374e93` |
| Attempt manifest | `f97c3ab712941c242b377dbda8488616fd0f69d3040f77eafdfa12c50a5f8648` |
| Attempt result | `36da5677a1a68a509941a0fc6c2ed613b78b036228f41be6d307273abbe6732b` |

The original five-minute preconditions were valid at the first actual mutation, with no overlapping active CI observed immediately before execution. Session cleanup reports and raw HTTP bodies remain in the private packet for independent audit. No new permission, destination, XSUAA or deployed application change occurred in this run.
