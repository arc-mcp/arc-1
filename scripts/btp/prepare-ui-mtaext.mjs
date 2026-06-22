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

  return merged;
}

const source = existsSync(inputPath) ? YAML.parse(readFileSync(inputPath, 'utf8')) : fallback;
const output = YAML.stringify(withUiExtension(source), { lineWidth: 120 });
writeFileSync(outputPath, output);
console.error(`Wrote ${outputPath} for UI-enabled BTP deploy.`);
