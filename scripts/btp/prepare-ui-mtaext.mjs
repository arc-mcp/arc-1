#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';

const inputPath = process.argv[2] ?? 'mta-overrides.mtaext';
const outputPath = process.argv[3] ?? 'mta-ui-deploy.mtaext';

const fallback = {
  '_schema-version': '3.1',
  ID: 'arc1-mcp-ui-deploy',
  extends: 'arc1-mcp',
};

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureModule(descriptor, name) {
  descriptor.modules = ensureArray(descriptor.modules);
  let module = descriptor.modules.find((entry) => entry && entry.name === name);
  if (!module) {
    module = { name };
    descriptor.modules.push(module);
  }
  return module;
}

function ensureNamedEntry(owner, key, name) {
  owner[key] = ensureArray(owner[key]);
  let entry = owner[key].find((candidate) => candidate && candidate.name === name);
  if (!entry) {
    entry = { name };
    owner[key].push(entry);
  }
  return entry;
}

function withUiExtension(descriptor) {
  const merged = descriptor ?? {};
  merged['_schema-version'] ??= '3.1';
  merged.extends ??= 'arc1-mcp';
  merged.ID = merged.ID?.includes('ui') ? merged.ID : `${merged.ID ?? 'arc1-mcp-overrides'}-ui`;

  const server = ensureModule(merged, 'arc1-mcp-server');
  server.properties = { ...(server.properties ?? {}), ARC1_UI: 'web' };

  const router = ensureModule(merged, 'arc1-ui-router');
  router['build-parameters'] = {
    ...(router['build-parameters'] ?? {}),
    'supported-platforms': ['CF'],
  };
  // Read the shipped descriptors so callback defaults have one source.
  const base = YAML.parse(readFileSync(new URL('../../mta.yaml', import.meta.url), 'utf8'));
  const ui = YAML.parse(readFileSync(new URL('../../mta-ui-approuter.mtaext', import.meta.url), 'utf8'));
  const baseOauth = base.resources.find((entry) => entry.name === 'arc1-xsuaa').parameters.config['oauth2-configuration'];
  const uiXsuaa = ui.resources.find((entry) => entry.name === 'arc1-xsuaa');
  const uiRouter = ui.modules.find((entry) => entry.name === 'arc1-ui-router');
  router.parameters ??= {};
  const params = router.parameters;
  // CF prefers routes over host/domain, and plural values over singular ones.
  // Never introduce a default host alongside an operator's routes or hosts.
  if (params.routes == null && params.hosts == null && params.host == null && !params['no-hostname']) {
    params.host = uiRouter.parameters.host;
  }
  const hosts = params['no-hostname'] ? [''] : (params.hosts ?? [params.host]);
  const domains = params.domains ?? [params.domain ?? '${default-domain}'];
  const routes = params['no-route'] ? [] : (params.routes ?? domains.flatMap((domain) =>
    hosts.map((host) => `${host ? `${host}.` : ''}${domain}${params['route-path'] ?? ''}`),
  ));
  const uiRedirects = routes.map((entry) => {
    const route = typeof entry === 'string' ? entry : entry.route;
    if (
      typeof route !== 'string' || !route || route.startsWith('http://') || /[?#*]/.test(route) ||
      /\$\{(?:default-url|default-uri|default-host|app-name)\}/.test(route)
    ) {
      throw new Error('UI routes must use explicit hostnames (or space/space-guid/default-domain placeholders).');
    }
    return `${(route.startsWith('https://') ? route : `https://${route}`).replace(/\/$/, '')}/login/callback`;
  });
  const xsuaa = ensureNamedEntry(merged, 'resources', 'arc1-xsuaa');
  const xsuaaConfig = xsuaa.parameters?.config ?? {};
  const existingOauth = xsuaaConfig['oauth2-configuration'] ?? {};
  xsuaa.parameters = {
    ...(xsuaa.parameters ?? {}),
    config: {
      ...xsuaaConfig,
      'oauth2-configuration': {
        ...existingOauth,
        'redirect-uris': [
          ...new Set([
            ...(existingOauth['redirect-uris'] ?? baseOauth['redirect-uris']),
            ...uiRedirects,
          ]),
        ],
      },
    },
  };
  for (const requirement of uiXsuaa.requires) ensureNamedEntry(xsuaa, 'requires', requirement.name);

  return merged;
}

const source = existsSync(inputPath) ? YAML.parse(readFileSync(inputPath, 'utf8')) : fallback;
const output = YAML.stringify(withUiExtension(source), { lineWidth: 120 });
writeFileSync(outputPath, output);
console.error(`Wrote ${outputPath} for UI-enabled BTP deploy.`);
