# SKTD native reference labels after a saved RAP document

The third fixed RAP documentation run acknowledged its one update PUT and retained the new inactive document. The qualifier stopped because SAP added descriptions to two direct operation references. The default and inactive bodies changed; the explicit active counterpart and all 35 other inspected views remained byte-identical. The two added labels are derived reference metadata, not missing or changed document text. The consumed run remains failed; this source correction does not authorize replay or a native phase.

## Evidence and native contract

The sealed operator packet contains 695 files. Its ledger SHA-256 is `7a02de13b16686d5688ecb9a8a5a64dc6b8f3f1c832d0504fb3c6f27c81afc1a`; the operator report is `b91084315de58429f91eae9d6b129da8f4dcad1292e08d26043917918ac0b93f`. The actual outgoing body is `d1644344b7cd422e9f7485ebe3193fb9036b10503fd467549adbfc96071a14e7`, and the stored default/inactive body is `fc10e52833148c8f946d92a5816761a8948c478afe27ba70a2ea886e4bd09380`. Independent XML-tree comparison excludes only the already recognized root volatile fields, state link and Base64 wrapping; its only two differences are the direct create/update reference description attributes. Post-lock controls were delayed about seven minutes and do not prove the absence of transient locks in that interval. This remains Basic-native evidence, not PP qualification.

Separate read-only captures of active standard code establish the bounded contract on A4H SAP_BASIS 758:

| Source | Body SHA-256 | Relevant behavior |
| --- | --- | --- |
| `CL_KTD_UTILITY` | `9c7df4a89a9e85911a93fec45f919c9b60f405e6a2981731d4d69fc981682fed` | Maps document header and text/short-text components into persistence; does not persist each element's reference description. |
| `CL_KTD_ADT_API` | `cf434dc91b0eb536109a9d5c39fef9dc668606e607a605f9d279b6d6dbcd87c4` | Reads the stored header/content through the DB API. |
| `CL_KTD_OBJECT_DATA` | `abb7d61c9e7cdca04a744507d55dce68aca14bf66a7a7eaf64bae712c271a1ce` | Keeps reference metadata and long/short text as distinct fields in the ADT model. |
| `CL_KTD_OBJECT_PERSIST` | `8766bfe54eb1b2cb397de3bd34eb20540e12d78f6f7fbc20ad078fc19815d78c` | Reconstructs the response through its local tree builder after reading the selected stored version. |
| `CL_KTD_WB_ACCESS` | `a087c387fdba45f8ded144aa9039a44da2bdd8938da323f624e361eeb39903d7` | Uses the same mapper and native persistence/read machinery. |
| `CL_KTD_OBJECT_PERSIST` local implementations | `de8532278d4680d099f03fb71e53c5dffaebe9780f129a9f052cfd880e793722` | Rebuilds each element reference from the referenced object's version-specific documentation structure; reads document texts separately from the stored components. |

The implementation include's `get_element_tree`/`create_sub_element` assigns the provider's element reference independently of `get_text` and `get_shorttext`. This proves a derived reference field, not a universal rule that its description must equal the inline short text. Native source and full receipts remain in private evidence storage; no proprietary source is copied into this repository.

## Correction boundary

The stable content comparison removes only the ADT-core `description` attribute of a direct native SKTD element's single object reference when all of the following match: an exact BDEF parent, the selected owner, a unique native element ID, the literal owned source-fragment URI, the BDEF entity parent ID, and a supported standard operation/action type and name. Root, parent-reference and root-node descriptions remain compared. Foreign namespaces, nested or ambiguous references, unsupported identities and unknown URI spellings receive no exemption. No URL decoding or broad namespace-level description exclusion is introduced.

Full metadata hashes still include these descriptions, so stale requests and changes appearing under the owning lock refuse before PUT. Submitted XML bytes are unchanged; native labels are neither rewritten nor supplied as new tool input. Long/short text values, native state, identity/type/name/URI, other attributes, links and opaque descendants retain their existing comparisons. Create/update/activation continue using the shared stable projection and native lifecycle; ordinary single-target routing is unchanged.

## Verification and remaining work

Two guarded before-fix failures reproduce the actual raw saved response, including the real private handler and HTTP adapter, byte-exact outgoing PUT, one submission and owning cleanup. The corrected replay passes. Focused regressions exercise derived-label addition/change/removal, full-hash stale and under-lock checks, namespace aliases, foreign/nested/ambiguous identities, retained unknown fields, and truthful post-save failures without replay. Initial test-helper escaping and nesting errors are preserved in the private author logs; they were test setup errors, not further native observations.

A separately reviewed fixed continuation must bind this consumed history and freshly verify the already stored requested content. It may continue the remaining activation/service graph and reverse cleanup, without another document PUT. Other native reference shapes/releases, full current-build PP coverage and overall PR readiness remain separate requirements. FEAT-93 retains those gaps.
