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

function ensureResource(descriptor, name) {
  descriptor.resources = ensureArray(descriptor.resources);
  let resource = descriptor.resources.find((entry) => entry && entry.name === name);
  if (!resource) {
    resource = { name };
    descriptor.resources.push(resource);
  }
  return resource;
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
  router.parameters = { ...(router.parameters ?? {}), host: 'arc1-ui-${space-guid}' };

  const xsuaa = ensureResource(merged, 'arc1-xsuaa');
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
            ...ensureArray(existingOauth['redirect-uris']),
            'http://localhost:*/**',
            '~{arc1-mcp-api/url}/**',
            'https://arc1-ui-${space-guid}.${default-domain}/**',
          ]),
        ],
        'grant-types': [
          ...new Set([
            ...ensureArray(existingOauth['grant-types']),
            'authorization_code',
            'refresh_token',
            'urn:ietf:params:oauth:grant-type:jwt-bearer',
          ]),
        ],
        'token-validity': existingOauth['token-validity'] ?? 3600,
        'refresh-token-validity': existingOauth['refresh-token-validity'] ?? 2592000,
      },
    },
  };
  ensureNamedEntry(xsuaa, 'requires', 'arc1-mcp-api');

  return merged;
}

const source = existsSync(inputPath) ? YAML.parse(readFileSync(inputPath, 'utf8')) : fallback;
const output = YAML.stringify(withUiExtension(source), { lineWidth: 120 });
writeFileSync(outputPath, output);
console.error(`Wrote ${outputPath} for UI-enabled BTP deploy.`);
