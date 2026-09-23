# abapGit ADT bridge — the real wire contract (2026-07-29)

Why this exists: ARC-1's abapGit client was written against XML shapes **invented from a third-party
client**, not against abapGit's own ADT backend. The FEAT-22 plan says so
([2026-04-18](../plans/completed/2026-04-18-feat-22-gcts-abapgit-integration.md) §134: abapGit fixtures
"constructed to match the documented response shapes in marcellourbani/abap-adt-api"), and the a4h trial
could never contradict them because every remote-touching call dies on STRUST. Result: the request
namespaces, the push payload, and the clone/pull/stage response parsers were all wrong, and the unit
tests locked the wrong shapes in.

**Source of truth**: [abapGit/ADT_Backend](https://github.com/abapGit/ADT_Backend) — the ST
transformations and REST resources that actually serialize/deserialize these payloads.

## Media types and namespaces

| Call | Request body | Response body |
|---|---|---|
| `GET /abapgit/repos` | — | `abapgitrepo:repositories`, ns `…/abapgit/repositories`, `application/abapgit.adt.repos.v2+xml` (ZABAPGIT_ST_REPOS) |
| `POST /abapgit/repos` (clone) | `abapgitrepo:repository`, ns `…/abapgit/repositories`, `…repo.v3+xml` (ZABAPGIT_ST_REPO_POST) | `abapObjects:abapObjects`, `…repo.object.v2+xml` (ZABAPGIT_ST_REPO_POST_RES) |
| `POST /abapgit/repos/{k}/pull` | same repository shape, minus package/url (ZABAPGIT_ST_REPO_PULL) | same `abapObjects` list |
| `GET /abapgit/repos/{k}/stage` | — | `abapgitstaging:abapgitstaging`, ns `…/abapgit/staging`, `…repo.stage.v1+xml` (ZABAPGIT_ST_REPO_STAGE) |
| `POST /abapgit/repos/{k}/push` | the same `abapgitstaging` shape | empty 200 |
| `POST /abapgit/externalrepoinfo` | `abapgitexternalrepo:externalRepoInfoRequest`, ns `…/abapgit/externalRepo` | `…externalRepoInfo`, `…info.ext.response.v2+xml` |

Note the namespace is **plural** (`…/abapgit/repositories`) while the element is singular
(`abapgitrepo:repository`). That mismatch is what ARC-1 got wrong.

The repo payload's fields sit in a `<tt:group>`, so element order is free. `tt:extensible="deep"` on the
pull template is why the extra `package`/`url` ARC-1 sends there are ignored rather than fatal.

## Live A/B probes (a4h, S/4HANA 2023, SAP_BASIS 758)

Deliberately invalid package / unreachable remote, so nothing is created or pushed.

**1. Clone payload namespace** — `POST /sap/bc/adt/abapgit/repos`, identical body, namespace varied:

```
…/abapgit/repository   → 400  com.sap.adt / ExceptionInvalidData
                              "System expected the element '{http://www.sap.com/adt/abapgit/repositories}repository'"
…/abapgit/repositories → 500  org.abapgit.adt  "Transport request  does not exists or is already released"
```

The second error is business validation — the body deserialized. **Every ARC-1 abapGit clone and pull
before this fix was rejected at deserialization.**

**2. Push payload** — `POST /sap/bc/adt/abapgit/repos/000000000001/push`:

```
<abapgitrepo:objects xmlns=…/abapgit/repository>  → 400  "System expected the element
                                                          '{http://www.sap.com/adt/abapgit/staging}abapgitstaging'"
<abapgitstaging:abapgitstaging …>                 → 500  org.abapgit.adt HTTP 421 SSL handshake …
```

The bridge deserializes the body *before* it touches the remote, so the 421 proves the payload was
accepted. **ARC-1's push had never reached SAP's business logic.**

**3. Accept is enforced** — `GET /sap/bc/adt/abapgit/repos`:

```
application/abapgit.adt.repos.v2+xml       → 200
application/abapgit.adt.repo.stage.v1+xml  → 406
application/nonsense+xml                   → 406
*/*                                        → 200
comma list incl. the rendered type         → 200
```

So the mismatched `Accept` ARC-1 sent on clone (`repo.v3`) and pull (`repo.stage.v1`) would 406 a
*successful* response. Both now ask for `repo.object.v2` and keep `repo.v3` in the list for older bridges.

**4. Not verifiable here** — the trial's repos point at `github.tools.sap`, which is not in STRUST:
`GET …/stage` returns `org.abapgit.adt … SSSLERR_PEER_CERT_UNTRUSTED (-102)`. So the staging *response*
shape and an end-to-end push are derived from the transformations, not captured live. The fixtures say so.

## Credentials for private repositories

`Username` + base64 `Password` request headers, read by the bridge in:

| Resource | Behaviour |
|---|---|
| `zcl_abapgit_res_repo_stage` | `IF NOT INITIAL` → `zcl_abapgit_default_auth_info=>set_auth_info` |
| `zcl_abapgit_res_repo_push` | same |
| `zcl_abapgit_res_repo_checks` | same |
| `zcl_abapgit_res_repo_switch` | `refresh( )` then **unconditional** `set_auth_info` |
| `zcl_abapgit_res_repo_pull` | header-free — credentials ride the XML body (`remoteUser` / `remotePassword`) |

`cl_http_utility->decode_base64` on the `Password` header confirms the base64 encoding ARC-1 already used.

## Staging round-trip

`GET …/stage` returns locally changed objects under `unstaged_objects` (ignored ones under
`ignored_objects`), each `abapgitobject` carrying `adtcore:` object-reference attributes plus
`abapgitstaging:wbkey`, with `abapgitstaging:abapgitfile` children (`name`, `path`, `localState`,
`remoteState`). It also pre-fills `abapgit_comment/author` and `/committer` from abapGit's stored git user
(`zcl_abapgit_res_repo_stage->get`: repo git user → default git user).

`POST …/push` takes the same document back with the objects to export moved into `staged_objects` and the
commit text in `abapgitstaging:comment`. `zcl_abapgit_res_repo_push->transform_request_data` reads only the
object reference, each file's `filename`/`path`/`localState`, and the comment — everything else is
decoration. That is why ARC-1's push stages first and echoes the selection back: the caller only supplies
a `message` (and optionally which objects), never an identity.

## What this means for ARC-1

- Fixtures for a bridge we cannot exercise live must be derived from ADT_Backend's transformations, never
  from another client's TypeScript. Each fixture now carries its provenance in an XML comment.
- `Accept` is not cosmetic on this bridge — it 406s. Any new abapGit call must name the media type the
  resource's response content handler declares.
- The remaining unverified step is an end-to-end clone/pull/push against a reachable remote. That needs a
  system with the Git host's CA in STRUST (see [INFRASTRUCTURE.md](../../INFRASTRUCTURE.md)).
