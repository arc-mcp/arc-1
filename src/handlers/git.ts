/**
 * SAPGit handler — abapGit + gCTS version control (clone, pull, push, branches, commits, repo
 * info). Extracted from intent.ts (Stage B; moved verbatim).
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
} from '../adt/abapgit.js';
import type { AdtClient } from '../adt/client.js';
import {
  type GctsCloneParams,
  cloneRepo as gctsCloneRepo,
  commitRepo as gctsCommitRepo,
  createBranch as gctsCreateBranch,
  deleteRepo as gctsDeleteRepo,
  getCommitHistory as gctsGetCommitHistory,
  getConfig as gctsGetConfig,
  getUserInfo as gctsGetUserInfo,
  listBranches as gctsListBranches,
  listRepoObjects as gctsListRepoObjects,
  listRepos as gctsListRepos,
  pullRepo as gctsPullRepo,
  switchBranch as gctsSwitchBranch,
} from '../adt/gcts.js';
import { getActionPolicy } from '../authz/policy.js';
import { cachedFeatures } from './feature-cache.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

// ─── SAPGit Handler ──────────────────────────────────────────────────

type SapGitBackend = 'gcts' | 'abapgit';

function resolveSapGitBackend(args: Record<string, unknown>): { backend?: SapGitBackend; error?: string } {
  const forced = args.backend as SapGitBackend | undefined;
  const hasGcts = Boolean(cachedFeatures?.gcts?.available);
  const hasAbapGit = Boolean(cachedFeatures?.abapGit?.available);

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
  const limit = Number(args.limit ?? 20);

  const gctsOnlyActions = new Set(['whoami', 'config', 'branches', 'history', 'objects', 'commit']);
  const abapGitOnlyActions = new Set(['external_info', 'check', 'stage', 'push']);
  if (backend === 'abapgit' && gctsOnlyActions.has(action)) {
    return errorResult(`Action '${action}' is only supported by gCTS; this system uses abapGit.`);
  }
  if (backend === 'gcts' && abapGitOnlyActions.has(action)) {
    return errorResult(`Action '${action}' is only supported by abapGit; this system uses gCTS.`);
  }

  let result: unknown;
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
      result = await abapGitGetExternalInfo(client.http, client.safety, url, user, password);
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
      result = await abapGitCheckRepo(client.http, client.safety, repo);
      break;
    }
    case 'stage': {
      if (!repoId) return errorResult('SAPGit(action="stage") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      result = await abapGitStageRepo(client.http, client.safety, repo);
      break;
    }
    case 'clone':
      if (!url) return errorResult('SAPGit(action="clone") requires url.');
      if (backend === 'gcts') {
        const params: GctsCloneParams = {
          rid: repoId || undefined,
          name: repoId || undefined,
          url,
          ...(packageName ? { package: packageName } : {}),
          user,
          password,
          token,
        };
        result = await gctsCloneRepo(client.http, client.safety, params, client.getPackageHierarchyResolver());
      } else {
        if (!packageName) return errorResult('SAPGit(action="clone", backend="abapgit") requires package.');
        result = await abapGitCreateRepo(
          client.http,
          client.safety,
          {
            package: packageName,
            url,
            branchName: branch || undefined,
            transportRequest: String(args.transport ?? '').trim() || undefined,
            user,
            password,
          },
          client.getPackageHierarchyResolver(),
        );
      }
      break;
    case 'pull':
      if (!repoId) return errorResult('SAPGit(action="pull") requires repoId.');
      if (backend === 'gcts') {
        result = await gctsPullRepo(client.http, client.safety, repoId, String(args.commit ?? '').trim() || undefined);
      } else {
        // R9: a pull deserializes remote content into the repo's server-bound package, which is
        // NOT the caller-supplied `package` (abapGit ignores that for an existing repo). Gate the
        // real binding against the allowlist before writing.
        const repo = await loadAbapGitRepo(client, repoId);
        await abapGitEnforceRepoPackage(
          client.safety,
          repo.package,
          client.getPackageHierarchyResolver(),
          'SAPGit(action="pull")',
        );
        result = await abapGitPullRepo(client.http, client.safety, repoId, {
          ...(packageName ? { package: packageName } : {}),
          ...(url ? { url } : {}),
          ...(branch ? { branchName: branch } : {}),
          transportRequest: String(args.transport ?? '').trim() || undefined,
          user,
          password,
        });
      }
      break;
    case 'push': {
      if (!repoId) return errorResult('SAPGit(action="push") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      // R9: push exports the repo's bound-package source to a remote git; gate that package
      // against the allowlist (the read-side mirror of the pull gate above).
      await abapGitEnforceRepoPackage(
        client.safety,
        repo.package,
        client.getPackageHierarchyResolver(),
        'SAPGit(action="push")',
      );
      const staging =
        Array.isArray(args.objects) && args.objects.length > 0
          ? { repoKey: repo.key, branchName: repo.branchName, objects: args.objects as Array<Record<string, unknown>> }
          : await abapGitStageRepo(client.http, client.safety, repo);
      await abapGitPushRepo(client.http, client.safety, repo, staging);
      result = { ok: true };
      break;
    }
    case 'commit':
      if (!repoId) return errorResult('SAPGit(action="commit") requires repoId.');
      result = await gctsCommitRepo(client.http, client.safety, repoId, {
        message: String(args.message ?? '').trim() || undefined,
        description: String(args.description ?? '').trim() || undefined,
        objects: Array.isArray(args.objects) ? (args.objects as Array<{ type?: string; name?: string }>) : undefined,
      });
      break;
    case 'switch_branch':
      if (!repoId || !branch) return errorResult('SAPGit(action="switch_branch") requires repoId and branch.');
      if (backend === 'gcts') {
        result = await gctsSwitchBranch(client.http, client.safety, repoId, branch);
      } else {
        await abapGitSwitchBranch(client.http, client.safety, repoId, branch, false);
        result = { ok: true };
      }
      break;
    case 'create_branch':
      if (!repoId || !branch) return errorResult('SAPGit(action="create_branch") requires repoId and branch.');
      if (backend === 'gcts') {
        result = await gctsCreateBranch(
          client.http,
          client.safety,
          repoId,
          {
            branch,
            ...(packageName ? { package: packageName } : {}),
          },
          client.getPackageHierarchyResolver(),
        );
      } else {
        await abapGitCreateBranch(client.http, client.safety, repoId, branch);
        result = { ok: true };
      }
      break;
    case 'unlink':
      if (!repoId) return errorResult('SAPGit(action="unlink") requires repoId.');
      if (backend === 'gcts') {
        await gctsDeleteRepo(client.http, client.safety, repoId);
      } else {
        await abapGitUnlinkRepo(client.http, client.safety, repoId);
      }
      result = { ok: true };
      break;
    default:
      return errorResult(`Unknown SAPGit action: ${action}`);
  }

  const payload = backend === 'gcts' || backend === 'abapgit' ? { backend, result } : result;
  return textResult(JSON.stringify(payload, null, 2));
}
