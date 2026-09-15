# SAPGit

Work with abapGit or gCTS repositories installed on SAP. ARC-1 prefers gCTS when available,
otherwise abapGit; set `backend` to choose explicitly. gCTS is read-only. abapGit mutations require
both `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_GIT_WRITES=true`.

```text
SAPGit(action="list_repos", backend="abapgit")
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `list_repos`, `whoami`, `config`, `branches`, `external_info`, `history`, `objects`, `check`, `stage`, `clone`, `pull`, `push`, `switch_branch`, `create_branch`, `unlink` |
| `backend` | string | No | Optional backend override: `gcts` or `abapgit` |
| `repoId` | string | No | Repository ID/key (required by most repo-scoped actions) |
| `url` | string | No | Remote Git URL (required for `clone`, and for abapGit `external_info`) |
| `branch` | string | No | Branch name (for switch/create branch) |
| `package` | string | No | ABAP package (required for clone/create on package-bound backends) |
| `transport` | string | No | Transport request (backend-dependent) |
| `commit` | string | No | Commit SHA (for gCTS `pull` by commit) |
| `message` | string | Yes for `push` | Commit message for abapGit `push` |
| `objects` | array | No | For abapGit `push`, the changed objects to commit (`[{type,name}]`); omit to push every local change |
| `user` | string | No | Remote Git username |
| `password` | string | No | Remote Git password |
| `token` | string | No | abapGit remote token, sent as basic auth with user `x-access-token` (GitHub convention) unless `user` is also given. gCTS mutations, including credential-bearing repository creation, are disabled. |
| `limit` | number | No | Limit for history queries (gCTS) |

## Backend support matrix

- **Both backends:** `list_repos`
- **gCTS reads:** `whoami`, `config`, `branches`, `history`, `objects`
- **abapGit only:** `external_info`, `check`, `stage`, `clone`, `pull`, `push`, `switch_branch`,
  `create_branch`, `unlink`
- **gCTS mutation names, currently disabled:** `clone`, `pull`, `switch_branch`,
  `create_branch`, `unlink`

## Safety and scope rules

- Repository/configuration reads require `read` scope (HTTP auth mode).
- abapGit mutations (`clone`, `pull`, `push`, `stage`, `switch_branch`, `create_branch`, `unlink`)
  require `git` scope, `SAP_ALLOW_WRITES=true`, and `SAP_ALLOW_GIT_WRITES=true`.
- `external_info` also requires those mutation gates. Although it returns metadata, SAP performs
  outbound network access to a caller-selected remote URL. All remote URLs must be absolute HTTPS
  without userinfo; `external_info` additionally rejects localhost and literal private/link-local
  addresses. It does not check DNS-resolved addresses or enforce a hostname allowlist.
- Package-bound clone and repository actions that import, export, change branch, or unlink enforce the
  configured allowlist against the real server-side package. A caller-supplied package cannot widen
  that boundary. The allowlist must contain the exact repository subtree pattern (`<ROOT>/**`) or
  `*`; an exact root entry or a broad prefix such as `Z*` is not sufficient for these subtree-wide
  operations.
- Every gCTS mutation is additionally disabled and returns an error before HTTP mutation, even when
  the write gates are enabled. Safe support is deferred until ARC-1 can stage without import, inventory
  affected objects, preflight authorization, deploy explicitly, confirm terminal state, and roll back.

**abapGit private repositories:** pass `user` + `password`, or just `token`. ARC-1 forwards them to the
bridge on every remote-touching call — `external_info`, `clone`, `pull`, `check`, `stage`, `push`,
`switch_branch`, `create_branch` — as the `Username` / base64 `Password` headers the abapGit ADT backend
reads. They are request-scoped: never stored, never logged (the `Password` header is redacted). In CLI
automation, load them from a protected JSON input or secret-backed workflow rather than literal argv.

<span id="mutation-evidence-and-retry-contract"></span>

## Mutation results and retries

- abapGit `clone`/`pull` responses report bridge object rows and repository readback, not complete
  import/activation reconciliation. Non-empty rows are returned with `verified:false`; an empty wrapper
  is an incomplete/error result, never proof that an import succeeded.
- `push` with no selected local changes is a verified no-op. After a selected push is accepted, ARC-1
  returns error/incomplete (`accepted:true`, `verified:false`) because the bridge exposes no
  authoritative remote-commit postcondition.
- `switch_branch` and `create_branch` likewise return error/incomplete after acceptance: repository
  readback does not prove imported objects or activation.
- `unlink` succeeds only after repository absence is read back. A failed readback or still-present
  repository is error/incomplete.

For the latter incomplete outcomes, the mutation may already have happened. **Do not retry blindly**;
inspect the remote/repository state first.

**abapGit push** stages first, then commits the objects you select: ARC-1 calls the stage endpoint, keeps
the objects (with their file lists) that match `objects`, and sends them back with your `message`. Author
and committer come from the git user abapGit has stored for the repo, so no identity parameters are needed.
A push with no matching local change is reported as a no-op instead of an empty commit; a selected push
returns `accepted:true`, `verified:false` as described above.

## Examples

The clone examples assume an existing `ZARC1` package and `SAP_ALLOWED_PACKAGES=ZARC1/**`,
in addition to the required scopes and write settings.

```
SAPGit(action="list_repos")
SAPGit(action="whoami", backend="gcts")
SAPGit(action="config", backend="gcts")
SAPGit(action="history", backend="gcts", repoId="ZARC1", limit=20)
SAPGit(action="external_info", backend="abapgit", url="https://github.com/abapGit-tests/CLAS.git")
SAPGit(action="switch_branch", repoId="000000000006", branch="main", backend="abapgit")
SAPGit(action="clone", backend="abapgit", package="ZARC1", url="https://github.com/org/repo.git")
SAPGit(action="clone", backend="abapgit", package="ZARC1", url="https://github.com/org/private.git", token="ghp_…")
SAPGit(action="stage", backend="abapgit", repoId="000000000001")
SAPGit(action="push", backend="abapgit", repoId="000000000001", message="Add order validation")
```

[All tools](../tools.md)
