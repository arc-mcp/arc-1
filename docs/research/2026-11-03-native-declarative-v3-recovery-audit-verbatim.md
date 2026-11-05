# Independent offline audit of the completed DDLS recovery

**Outcome: the preserved evidence supports successful cleanup of the one retained DDLS, with no remaining owned fixture or lock shown by the recorded postconditions.** This is Basic-native cleanup evidence only. It does not turn the failed six-owner lifecycle into a successful lifecycle or qualify PP/public admission, merge, or a future v4 attempt.

The permanent recovery root is `pr1142-native-declarative-v3-recovery-v1`. Its intent and manifest bind exact revision `9c103ab74852d75db5f518e4d0f93e777d5cf8ca`, Node 22.21.1 and execution checkout `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`. The intent hash is `18b83ddd9969d15f8d5da78987c39c73abd7975bdd754125dca9ea3e58ec1293`; the result hash is `31f1bd4a81643f79adfdc6a19ca816e1aeb6a4eb855a59e3a18b2738a23e3130`. The saved result reports no failure, confirmed deletion and cleanup, and empty remaining/inspection lists. All claims and the original failed attempt remain permanently preserved.

## What was independently verified

The journal has exactly **61 consecutive rows**, from **2026-11-03 01:07:17.576Z through 01:07:24.640Z**. All retained response bodies (29) match their recorded UTF-8 byte counts and SHA-256 hashes. All 67 recovery files and the three separate post-control files were hashed; their bytes remained unchanged during this audit. All **117 original failed-v3 files** still have their previously recorded exact names and hashes.

- Rows 1–4 establish the inactive updated and active original versions. Rows 26–29 repeat those exact bytes after the successful owning lock at rows 20–21 and before deletion. Namespace-bound metadata identifies `ZARC1_V2V_F4C656905A65AA61`, type `DDLS/DF`, package `$TMP`, MARIAN as createdBy/changedBy/responsible, the exact fixture marker, correct active/inactive state and exact opposite-state owned relative links. The source hashes are the approved original `62e1dfa3ccbfc456e91338019fbb2e03c25c2a595de264e3dc23742e4c6c2a8a` and update `06b0b8832019beef3310cf3b4e3d05d908a191c7aac67be5eb892f32fa4b2d5f`. Rows 15 and 40 bind the approved full metadata hashes and five other owner absences.
- **Exactly one recorded DELETE** targets `/sap/bc/adt/ddic/ddl/sources/zarc1_v2v_f4c656905a65aa61` at row 41, 01:07:20.699Z. Row 42 returns HTTP 200 with an empty body. No create, PUT, activation or foreign-owner mutation is recorded. The other POSTs are the two existing-owner recording checks and the one owning LOCK/UNLOCK pair.
- The adapter's immediate owner GET returns native typed absence at row 44. The owning UNLOCK at rows 45–46 returns HTTP 200. Row 47 reports `state: deleted`, no error and `cleanupConfirmed: true`. In the independently reviewed exact driver, this flag requires successful owning unlock, no unknown locks and `sessionClosed === true`. Session closure is therefore callback-derived confirmation; a separate unredacted session-close exchange is not stored in this journal.
- Independent final GETs at rows 48–59 establish **typed native 404 absence of all six original owners**. The saved bodies were parsed and checked for the communication-framework exception root, `com.sap.adt` namespace and `ExceptionResourceNotFound`, paired with each exact owner URI. The five uncreated owners also have typed absence before the lock and immediately before DELETE. This is not an inference from generic HTTP 404.
- Rows 60–61 record a successful native inactive-object inventory, 21,127 bytes, SHA-256 `a41870c2e23e759bcd4ff35091334a204a359cdc8af5e5f834b1c796708bfff8`, and no fixture reference. The raw inventory is intentionally omitted to avoid retaining unrelated draft names. This audit validates the matching hash/size and the reviewed harness's clean-inventory report; it does not claim a second parse of an unavailable payload.

## Prerequisites and visual post-controls

The new intent was created at **01:05:26.873Z**. The baseline receipt binds the exact intent, revision and original failed result. It records the suffix search at **01:05:54.558Z** and MARIAN search at **01:06:09.981Z**: both after intent creation and within five minutes at the recorded DELETE. Both saved baseline files have raw JPEG signatures and receipt-matching hashes.

I independently opened and visually inspected **both actual saved post-control JPEGs** in `pr1142-native-declarative-v3-recovery-post-20261103T010724`. Both show the A4H (001) Enqueue Administration screen, empty `Lock Table (0)`, green “0 locks have been displayed” status, and no error:

| Post image | Exact visible search | Receipt time (UTC) | SHA-256 |
| --- | --- | --- | --- |
| `sm12-user.jpg` | Client 001, user MARIAN, table `*`, argument `*` | 01:08:08.993 | `796669c9a6ff7610b9f041cbbee2b7ce737b9d634176fad2162aa33f1e2a78dc` |
| `sm12-suffix.jpg` | Client 001, user `*`, table `*`, argument `*F4C656905A65AA61*` | 01:08:48.885 | `eeecab595761ee6628ced400a40becbfebe7725cb1a118c28e0a561f87aa0fe4` |

The post receipt binds the exact successful result hash and revision. Its recorded observations follow the final journal row. Raw JPEG signatures and image hashes match. The unchanged zero-lock views naturally have byte-identical images to earlier captures; pixel/hash equality does not independently prove or disprove capture time. Fresh search/capture provenance comes from the executing operator's observed actions and receipt, while this audit independently verifies the saved pixels and bindings.

The operator reports a successful non-claiming offline check, empty GitHub in-progress/queued/pending lists, an awake-host hold, offline agents, one execution with exit 0, and normal renewed UI sign-in before the fresh searches. Those operational actions were not independently replayed during this offline audit. Historical zero-lock images are not substituted for current controls.

## Scope and preservation

No phase, retry, SAP/network request, browser action, credential read, source edit or repository command was performed during this audit. Only saved JSON/byte evidence and the two saved post images were inspected. No private inventory contents or native lock handles are copied here. The small companion `pr1142-native-declarative-v3-recovery-audit.json` records the hashes, row references and limitations; its SHA-256 is `e1e81cf8686dfeeef5e34b19e83631284da079f3c71481827cc64dbcbc06bb13`.

The retained DDLS cleanup can be treated as complete on this evidence. A later corrected lifecycle still requires its own exact-source review, new protocol/claim, fresh prerequisites and separate bounded approval. This audit neither authors nor authorizes that next run.
