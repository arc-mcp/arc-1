import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function cfJson(path, args = []) {
  const result = JSON.parse(
    execFileSync('cf', ['curl', path, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 4_000_000,
    }),
  );
  if (result.errors) throw new Error('CF API request failed; inspect the selected resource separately');
  return result;
}

export function assertFreeCapacity({ environment, plan, offering, quota, usage, memoryMb, routes, activeWork }) {
  const freeDatabase =
    (offering?.name === 'postgresql-db' && plan?.name === 'free') ||
    (offering?.name === 'hana-cloud' && plan?.name === 'hana-free');
  if (
    environment?.planName !== 'free' ||
    environment?.serviceName !== 'cloudfoundry' ||
    environment?.state !== 'OK' ||
    plan?.free !== true ||
    !freeDatabase
  ) {
    throw new Error(
      'Verified Cloud Foundry free and PostgreSQL free/HANA hana-free plans are required; no paid fallback',
    );
  }
  if (
    !Number.isInteger(memoryMb) ||
    memoryMb < 0 ||
    memoryMb > 4096 ||
    !Number.isInteger(routes) ||
    routes < 0 ||
    routes > 2
  )
    throw new Error('Invalid capacity request');
  if (activeWork) throw new Error('Wait for current builds/tasks before checking free capacity');
  if (
    !Number.isFinite(quota.apps?.total_memory_in_mb) ||
    !Number.isFinite(usage.memory_in_mb) ||
    usage.memory_in_mb + memoryMb > Math.min(4096, quota.apps.total_memory_in_mb)
  )
    throw new Error('Insufficient free memory; include staging/tasks');
  if (
    !Number.isFinite(quota.routes?.total_routes) ||
    !Number.isFinite(usage.routes) ||
    usage.routes + routes > quota.routes.total_routes
  )
    throw new Error('Insufficient free route quota');
}

/** Read-only, fail-closed check. It never creates, upgrades, stops or deletes resources. */
export function preflight(subaccount, database, memoryMb = 1024, routes = 0) {
  if (!/^[a-f0-9-]{36}$/i.test(subaccount ?? '') || !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? ''))
    throw new Error('Subaccount UUID and database service name required');
  const config = JSON.parse(readFileSync(join(process.env.CF_HOME ?? homedir(), '.cf/config.json'), 'utf8'));
  const org = config.OrganizationFields?.GUID;
  const space = config.SpaceFields?.GUID;
  if (!org || !space) throw new Error('Log in and target a CF org/space first');
  const environments = JSON.parse(
    execFileSync('btp', ['--format', 'json', 'list', 'accounts/environment-instance', '--subaccount', subaccount], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const environment = environments.environmentInstances?.find((item) => item.platformId === org);
  const organization = cfJson(`/v3/organizations/${org}`);
  const quota = cfJson(`/v3/organization_quotas/${organization.relationships.quota.data.guid}`);
  const usage = cfJson(`/v3/organizations/${org}/usage_summary`).usage_summary;
  const instances = cfJson(
    `/v3/service_instances?space_guids=${space}&names=${encodeURIComponent(database)}`,
  ).resources;
  if (instances?.length !== 1 || instances[0].type !== 'managed')
    throw new Error('Exactly one selected managed database required in this space');
  const instance = instances[0];
  const plan = cfJson(`/v3/service_plans/${instance.relationships.service_plan.data.guid}`);
  const offering = cfJson(`/v3/service_offerings/${plan.relationships.service_offering.data.guid}`);
  // Conservatively refuse any visible active work, including work in another accessible space.
  const activeWork =
    cfJson('/v3/builds?states=STAGING').pagination.total_results +
    cfJson('/v3/tasks?states=RUNNING,PENDING').pagination.total_results;
  assertFreeCapacity({ environment, plan, offering, quota, usage, memoryMb, routes, activeWork });
  return {
    status: 'free-preflight-passed',
    org,
    space,
    databaseGuid: instance.guid,
    databaseOffering: offering.name,
    databasePlan: plan.name,
    usedMemoryMb: usage.memory_in_mb,
    maximumMemoryMb: Math.min(4096, quota.apps.total_memory_in_mb),
    reservedExtraMemoryMb: memoryMb,
    usedRoutes: usage.routes,
    maximumRoutes: quota.routes.total_routes,
    createdAt: instance.created_at,
    checkedAt: new Date().toISOString(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(
      JSON.stringify(
        preflight(process.argv[2], process.argv[3], Number(process.argv[4] ?? 1024), Number(process.argv[5] ?? 0)),
      ),
    );
  } catch (error) {
    console.error(
      error.message?.startsWith('Command failed') ? 'BTP/CF preflight failed; check login and target' : error.message,
    );
    process.exitCode = 1;
  }
}
