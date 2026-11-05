import { Ajv2020 } from 'ajv/dist/2020.js';
import { currentFixtureSources, requireEvidence } from './current-workflow-contract.mjs';

// This fixed phase records into its existing exact request; CTS management is a separate qualification.
const managementActions = ['create', 'release', 'release_recursive', 'delete', 'reassign', 'remove_object'];

/** Check the actual refreshed catalogue before making any fixture; no guessed admission from scope alone. */
export function verifyCurrentCatalog(tools, actor, manifest) {
  requireEvidence(Array.isArray(tools), 'CURRENT_CATALOG_MISSING');
  for (const name of ['SAPWrite', 'SAPActivate'])
    requireEvidence(
      tools.filter((tool) => tool.name === name).length === (actor.write ? 1 : 0),
      'CURRENT_WRITE_CATALOG_MISMATCH',
    );
  const transports = tools.filter((tool) => tool.name === 'SAPTransport');
  const actions = transports[0]?.inputSchema?.properties?.action?.enum;
  requireEvidence(
    transports.length === 1 &&
      Array.isArray(actions) &&
      actions.every((action) => typeof action === 'string') &&
      new Set(actions).size === actions.length &&
      actions.includes('get') &&
      !actions.some((action) => managementActions.includes(action)),
    'CURRENT_RECORDING_ONLY_CATALOG_MISMATCH',
  );
  const validate = new Map();
  const accepts = (name, args) => {
    if (!validate.has(name)) {
      const matches = tools.filter((tool) => tool.name === name);
      requireEvidence(matches.length === 1 && matches[0].inputSchema, 'CURRENT_WORKFLOW_TOOL_UNAVAILABLE');
      validate.set(name, new Ajv2020({ strictTypes: false, allowUnionTypes: true }).compile(matches[0].inputSchema));
    }
    requireEvidence(validate.get(name)(args), 'CURRENT_WORKFLOW_SCHEMA_UNAVAILABLE');
  };
  if (!actor.write) return;
  for (const f of manifest.fixtures.filter((f) => f.actor === actor.label)) {
    const key = { type: f.type, name: f.name },
      sources = currentFixtureSources(f, manifest.marker, manifest.fixtures);
    const transport = actor.label === 'writerA' ? { transport: manifest.bindings.recording.task } : {};
    accepts('SAPRead', { ...key, format: 'editable' });
    accepts('SAPWrite', { ...key, ...transport, action: 'create', package: f.package, source: sources.initial });
    accepts('SAPWrite', {
      ...key,
      ...transport,
      action: 'update',
      source: sources.initial,
      expectedSourceHash: 'a'.repeat(64),
    });
    accepts('SAPWrite', { ...key, ...transport, action: 'delete' });
    accepts('SAPActivate', key);
    if (f.type === 'CLAS')
      accepts('SAPWrite', {
        ...key,
        ...transport,
        action: 'edit_method',
        method: 'get_value',
        source: 'rv_value = 2.',
        expectedSourceHash: 'a'.repeat(64),
      });
    if (f.type === 'CLAS' && actor.label === 'writerA') {
      accepts('SAPWrite', {
        ...key,
        ...transport,
        action: 'edit_class_definition',
        source: 'CLASS x DEFINITION. ENDCLASS.',
        expectedSourceHash: 'a'.repeat(64),
      });
      accepts('SAPWrite', { ...key, ...transport, action: 'update', include: 'testclasses', source: sources.tests });
      accepts('SAPRead', { ...key, include: 'testclasses', format: 'editable' });
    }
    if (f.type === 'PROG') {
      accepts('SAPWrite', {
        ...key,
        ...transport,
        action: 'edit_text_symbols',
        textPart: 'symbols',
        source: sources.symbols,
      });
      accepts('SAPRead', { type: 'TEXT_ELEMENTS', name: f.name, objectType: 'PROG', include: 'symbols' });
    }
  }
  if (actor.label === 'writerA') accepts('SAPTransport', { action: 'get', id: manifest.bindings.recording.request });
}
