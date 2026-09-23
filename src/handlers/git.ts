/**
 * SAPGit handler — abapGit + gCTS version control (clone, pull, push, branches, commits, repo
 * info).
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  checkRepo as abapGitCheckRepo,
  createBranch as abapGitCreateBranch,
  createRepo as abapGitCreateRepo,
  enforceRepoPackageAllowed as abapGitEnforceRepoPackage,
  getExternalInfo as abapGitGetExternalInfo,
  listRepos as abapGitListRepos,
  pullRepo as abapGitPullRepo,
  pushRepo as abapGitPushRepo,
  stageRepo as abapGitStageRepo,
  switchBranch as abapGitSwitchBranch,
  unlinkRepo as abapGitUnlinkRepo,
  redactGitUrl,
  validateGitRemoteUrl,
} from '../adt/abapgit.js';
import type { AdtClient } from '../adt/client.js';
import {
  enforceGctsMutationQuarantine,
  getCommitHistory as gctsGetCommitHistory,
  getConfig as gctsGetConfig,
  getUserInfo as gctsGetUserInfo,
  listBranches as gctsListBranches,
  listRepoObjects as gctsListRepoObjects,
  listRepos as gctsListRepos,
  redactGctsValue,
} from '../adt/gcts.js';
import type { AbapGitObject, AbapGitRepo, AbapGitStagingObject } from '../adt/types.js';
import { getActionPolicy } from '../authz/policy.js';
import { getCachedFeatures } from './feature-cache.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

// ─── SAPGit Handler ──────────────────────────────────────────────────

type SapGitBackend = 'gcts' | 'abapgit';

function gitToolResult(backend: SapGitBackend, result: unknown, isError = false): ToolResult {
  const payload = redactGctsValue({ backend, result });
  return isError ? errorResult(toolJson(payload)) : textResult(toolJson(payload));
}

function repositoryEvidence(repo: AbapGitRepo | undefined): Record<string, unknown> | null {
  if (!repo) return null;
  return {
    key: repo.key,
    package: repo.package,
    url: repo.url,
    branchName: repo.branchName,
    selectedBranch: repo.selectedBranch,
    writeProtected: repo.writeProtected,
  };
}

function abapGitMutationEvidence(
  operation: 'clone' | 'pull',
  objects: AbapGitObject[],
  repo: AbapGitRepo | undefined,
): Record<string, unknown> {
  const incomplete = objects.length === 0;
  return {
    outcome: incomplete ? 'incomplete' : 'bridge_evidence',
    verified: false,
    operation,
    objects,
    repository: repositoryEvidence(repo),
    message: incomplete
      ? 'The abapGit bridge returned an empty object wrapper. Repository linkage/readback does not prove that objects were imported or activated. Do not retry blindly; inspect the repository and expected objects first.'
      : 'The bridge returned non-rejecting object rows and repository readback. Complete repository import and activation were not reconciled.',
  };
}

function sameGitUrl(left: string, right: string): boolean {
  return redactGitUrl(left) === redactGitUrl(right);
}

async function readBackCreatedAbapGitRepo(
  client: AdtClient,
  packageName: string,
  url: string,
): Promise<AbapGitRepo | undefined> {
  try {
    const repos = await abapGitListRepos(client.http, client.safety);
    return repos.find(
      (candidate) => candidate.package.toUpperCase() === packageName.toUpperCase() && sameGitUrl(candidate.url, url),
    );
  } catch {
    // The mutation already ran. Preserve an honest incomplete/unverified result rather than masking
    // it with a secondary readback failure (repository:null records the missing evidence).
    return undefined;
  }
}

async function tryReadBackAbapGitRepo(client: AdtClient, repoId: string): Promise<AbapGitRepo | undefined> {
  try {
    return (await abapGitListRepos(client.http, client.safety)).find((candidate) => candidate.key === repoId);
  } catch {
    return undefined;
  }
}

/**
 * Narrow a staging result to the objects the caller asked for (`objects: [{name, type}]`).
 * Omitted or empty → every locally changed object. Type is matched only when given.
 */
function selectStagingObjects(objects: AbapGitStagingObject[], requested: unknown): AbapGitStagingObject[] {
  if (!Array.isArray(requested) || requested.length === 0) return objects;
  const wanted = requested.map((entry) => {
    const item = (entry ?? {}) as { name?: unknown; type?: unknown };
    return { name: String(item.name ?? '').toUpperCase(), type: String(item.type ?? '').toUpperCase() };
  });
  return objects.filter((object) =>
    wanted.some(
      (want) =>
        want.name === (object.name ?? '').toUpperCase() &&
        (!want.type || want.type === (object.type ?? '').toUpperCase()),
    ),
  );
}

function resolveSapGitBackend(args: Record<string, unknown>): { backend?: SapGitBackend; error?: string } {
  const forced = args.backend as SapGitBackend | undefined;
  const hasGcts = Boolean(getCachedFeatures()?.gcts?.available);
  const hasAbapGit = Boolean(getCachedFeatures()?.abapGit?.available);

  if (!hasGcts && !hasAbapGit) {
    return {
      error:
        'Neither gCTS nor abapGit is available on this SAP system. Run SAPManage(action="probe") to refresh feature detection.',
    };
  }

  if (forced) {
    if (forced === 'gcts' && !hasGcts) return { error: 'gCTS backend is not available on this SAP system.' };
    if (forced === 'abapgit' && !hasAbapGit) return { error: 'abapGit backend is not available on this SAP system.' };
    return { backend: forced };
  }

  return { backend: hasGcts ? 'gcts' : 'abapgit' };
}

async function loadAbapGitRepo(client: AdtClient, repoId: string) {
  const repos = await abapGitListRepos(client.http, client.safety);
  const repo = repos.find((candidate) => candidate.key === repoId);
  if (!repo) {
    throw new Error(
      `abapGit repository "${repoId}" was not found. Run SAPGit(action="list_repos", backend="abapgit").`,
    );
  }
  return repo;
}

export async function handleSAPGit(
  client: AdtClient,
  args: Record<string, unknown>,
  _authInfo?: AuthInfo,
): Promise<ToolResult> {
  // Scope enforcement happens at handleToolCall level via ACTION_POLICY.
  // This handler only dispatches action logic.
  const action = String(args.action ?? '');
  if (!getActionPolicy('SAPGit', action)) {
    return errorResult(`Unknown SAPGit action: ${action}`);
  }

  const resolved = resolveSapGitBackend(args);
  if (!resolved.backend) {
    return errorResult(resolved.error ?? 'Unable to resolve SAPGit backend.');
  }

  const backend = resolved.backend;
  const repoId = String(args.repoId ?? '').trim();
  const url = String(args.url ?? '').trim();
  const branch = String(args.branch ?? '').trim();
  const packageName = String(args.package ?? '').trim();
  const user = String(args.user ?? '').trim() || undefined;
  const password = String(args.password ?? '').trim() || undefined;
  const token = String(args.token ?? '').trim() || undefined;
  const abapGitUser = user ?? (token ? 'x-access-token' : undefined);
  const abapGitPassword = password ?? token;
  const limit = Number(args.limit ?? 20);

  if (url) validateGitRemoteUrl(url, { rejectPrivateLiteral: action === 'external_info' });

  const gctsOnlyActions = new Set(['whoami', 'config', 'branches', 'history', 'objects']);
  const abapGitOnlyActions = new Set(['external_info', 'check', 'stage', 'push']);
  if (backend === 'abapgit' && gctsOnlyActions.has(action)) {
    return errorResult(`Action '${action}' is only supported by gCTS; this system uses abapGit.`);
  }
  if (backend === 'gcts' && abapGitOnlyActions.has(action)) {
    return errorResult(`Action '${action}' is only supported by abapGit; this system uses gCTS.`);
  }
  if (backend === 'gcts') enforceGctsMutationQuarantine(client.safety, action);

  let result: unknown;
  let incomplete = false;
  switch (action) {
    case 'list_repos':
      result =
        backend === 'gcts'
          ? await gctsListRepos(client.http, client.safety)
          : await abapGitListRepos(client.http, client.safety);
      break;
    case 'whoami':
      result = await gctsGetUserInfo(client.http, client.safety);
      break;
    case 'config':
      result = await gctsGetConfig(client.http, client.safety, repoId || undefined);
      break;
    case 'branches':
      if (!repoId) return errorResult('SAPGit(action="branches") requires repoId.');
      result = await gctsListBranches(client.http, client.safety, repoId);
      break;
    case 'external_info':
      if (!url) return errorResult('SAPGit(action="external_info") requires url.');
      result = await abapGitGetExternalInfo(client.http, client.safety, url, abapGitUser, abapGitPassword);
      break;
    case 'history':
      if (!repoId) return errorResult('SAPGit(action="history") requires repoId.');
      result = await gctsGetCommitHistory(client.http, client.safety, repoId, Number.isFinite(limit) ? limit : 20);
      break;
    case 'objects':
      if (!repoId) return errorResult('SAPGit(action="objects") requires repoId.');
      result = await gctsListRepoObjects(client.http, client.safety, repoId);
      break;
    case 'check': {
      if (!repoId) return errorResult('SAPGit(action="check") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      result = await abapGitCheckRepo(client.http, client.safety, repo, abapGitUser, abapGitPassword);
      break;
    }
    case 'stage': {
      if (!repoId) return errorResult('SAPGit(action="stage") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      result = await abapGitStageRepo(client.http, client.safety, repo, abapGitUser, abapGitPassword);
      break;
    }
    case 'clone': {
      if (!url) return errorResult('SAPGit(action="clone") requires url.');
      if (!packageName) return errorResult('SAPGit(action="clone", backend="abapgit") requires package.');
      const objects = await abapGitCreateRepo(
        client.http,
        client.safety,
        {
          package: packageName,
          url,
          branchName: branch || undefined,
          transportRequest: String(args.transport ?? '').trim() || undefined,
          user: abapGitUser,
          password: abapGitPassword,
        },
        client.getPackageHierarchyResolver(),
      );
      const repo = await readBackCreatedAbapGitRepo(client, packageName, url);
      const evidence = abapGitMutationEvidence('clone', objects, repo);
      if (objects.length === 0) {
        return gitToolResult('abapgit', evidence, true);
      }
      result = evidence;
      break;
    }
    case 'pull': {
      if (!repoId) return errorResult('SAPGit(action="pull") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      const objects = await abapGitPullRepo(
        client.http,
        client.safety,
        repoId,
        {
          ...(packageName ? { package: packageName } : {}),
          ...(url ? { url } : {}),
          ...(branch ? { branchName: branch } : {}),
          transportRequest: String(args.transport ?? '').trim() || undefined,
          user: abapGitUser,
          password: abapGitPassword,
        },
        client.getPackageHierarchyResolver(),
        repo.package,
      );
      const refreshedRepo = await tryReadBackAbapGitRepo(client, repoId);
      const evidence = abapGitMutationEvidence('pull', objects, refreshedRepo ?? repo);
      if (objects.length === 0) {
        return gitToolResult('abapgit', evidence, true);
      }
      result = evidence;
      break;
    }
    case 'push': {
      if (!repoId) return errorResult('SAPGit(action="push") requires repoId.');
      const message = String(args.message ?? '').trim();
      if (!message) {
        return errorResult('SAPGit(action="push", backend="abapgit") requires message (the commit message).');
      }
      const repo = await loadAbapGitRepo(client, repoId);
      // Staging is Update-scoped and runs before pushRepo's sink-local gate, so gate the bound package first.
      await abapGitEnforceRepoPackage(
        client.safety,
        repo.package,
        client.getPackageHierarchyResolver(),
        'SAPGit(action="push")',
      );
      // The bridge only pushes what the client stages, and it pre-fills author/committer on the stage
      // response — so always stage first, then send back the selected objects with the commit comment.
      const staging = await abapGitStageRepo(client.http, client.safety, repo, abapGitUser, abapGitPassword);
      const selected = selectStagingObjects(staging.objects, args.objects);
      if (selected.length === 0) {
        result = { ok: true, pushed: [], message: 'Nothing to push — no matching local changes.' };
        break;
      }
      await abapGitPushRepo(
        client.http,
        client.safety,
        repo,
        { ...staging, objects: selected, comment: { ...staging.comment, comment: message } },
        abapGitUser,
        abapGitPassword,
        client.getPackageHierarchyResolver(),
      );
      incomplete = true;
      result = {
        ok: false,
        outcome: 'incomplete',
        accepted: true,
        verified: false,
        pushed: selected.map(({ name, type }) => ({ name, type })),
        message:
          'The bridge accepted the push request, but ARC-1 has no authoritative remote-commit postcondition. ' +
          'Do not retry blindly; inspect the remote repository before deciding whether to retry.',
      };
      break;
    }
    case 'switch_branch': {
      if (!repoId || !branch) return errorResult('SAPGit(action="switch_branch") requires repoId and branch.');
      const repo = await loadAbapGitRepo(client, repoId);
      await abapGitSwitchBranch(
        client.http,
        client.safety,
        repoId,
        branch,
        false,
        abapGitUser,
        abapGitPassword,
        client.getPackageHierarchyResolver(),
        repo.package,
      );
      const refreshedRepo = await tryReadBackAbapGitRepo(client, repoId);
      incomplete = true;
      result = {
        ok: false,
        outcome: 'incomplete',
        accepted: true,
        verified: false,
        repository: repositoryEvidence(refreshedRepo ?? repo),
        message:
          'Branch switch was accepted, but repository readback does not prove imported objects or activation. ' +
          'Do not retry blindly.',
      };
      break;
    }
    case 'create_branch': {
      if (!repoId || !branch) return errorResult('SAPGit(action="create_branch") requires repoId and branch.');
      const repo = await loadAbapGitRepo(client, repoId);
      await abapGitCreateBranch(
        client.http,
        client.safety,
        repoId,
        branch,
        abapGitUser,
        abapGitPassword,
        client.getPackageHierarchyResolver(),
        repo.package,
      );
      const refreshedRepo = await tryReadBackAbapGitRepo(client, repoId);
      incomplete = true;
      result = {
        ok: false,
        outcome: 'incomplete',
        accepted: true,
        verified: false,
        repository: repositoryEvidence(refreshedRepo ?? repo),
        message:
          'Branch creation was accepted, but repository readback does not prove imported objects or activation. ' +
          'Do not retry blindly.',
      };
      break;
    }
    case 'unlink': {
      if (!repoId) return errorResult('SAPGit(action="unlink") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      await abapGitUnlinkRepo(client.http, client.safety, repoId, client.getPackageHierarchyResolver(), repo.package);
      let remaining: AbapGitRepo | undefined;
      try {
        remaining = (await abapGitListRepos(client.http, client.safety)).find((candidate) => candidate.key === repoId);
      } catch {
        incomplete = true;
        result = {
          ok: false,
          outcome: 'incomplete',
          accepted: true,
          verified: false,
          message:
            'The bridge accepted unlink, but repository readback failed. Do not retry blindly; inspect the repository list first.',
        };
        break;
      }
      if (remaining) {
        incomplete = true;
        result = {
          ok: false,
          outcome: 'incomplete',
          accepted: true,
          verified: false,
          repository: repositoryEvidence(remaining),
          message: 'The bridge accepted unlink, but the repository is still present on readback. Do not retry blindly.',
        };
      } else {
        result = { ok: true, verified: true, repositoryAbsent: true };
      }
      break;
    }
    default:
      return errorResult(`Unknown SAPGit action: ${action}`);
  }

  return gitToolResult(backend, result, incomplete);
}
