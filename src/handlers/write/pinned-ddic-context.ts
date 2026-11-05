/** Private qualification entry for native DDIC and server-driven CRUD; public routes stay closed. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { pinnedDdicSelection, resolvePinnedTableType } from '../../adt/pinned-ddic-owner.js';
import { parseTableIndexName } from '../../adt/table-index.js';
import type { ServerConfig } from '../../server/types.js';
import {
  isDomainsEndpointAvailable,
  isLockObjectsEndpointAvailable,
  isTablesEndpointAvailable,
  isTableTypesEndpointAvailable,
} from '../feature-cache.js';
import {
  DOMA_WRITE_UNAVAILABLE_HINT,
  ENQU_WRITE_UNAVAILABLE_HINT,
  TTYP_WRITE_UNAVAILABLE_HINT,
} from '../write-helpers.js';
import { PINNED_METADATA_INPUTS } from './pinned-metadata-write.js';
import { createPinnedSourceContext } from './pinned-source-context.js';

const HASH = /^[a-f0-9]{64}$/;
const MAX_ROWS = 1000;

function assertRows(value: unknown, field: string, required: string): void {
  if (
    !Array.isArray(value) ||
    value.length > MAX_ROWS ||
    value.some(
      (row) => !row || typeof row !== 'object' || typeof (row as Record<string, unknown>)[required] !== 'string',
    )
  )
    throw new AdtSafetyError(`${field} must be a bounded array of objects with a text ${required}.`);
}

function validateMetadataInput(args: Record<string, unknown>, creating: boolean): void {
  if (args.fixedValues !== undefined) assertRows(args.fixedValues, 'fixedValues', 'low');
  if (args.messages !== undefined) assertRows(args.messages, 'messages', 'number');
  if (args.type === 'ENQU' && (creating || args.source !== undefined)) {
    if (typeof args.source !== 'string' || !args.source.trim())
      throw new AdtSafetyError('A lock-object definition requires JSON source.');
    let definition: unknown;
    try {
      definition = JSON.parse(args.source);
    } catch {
      definition = undefined;
    }
    if (!definition || typeof definition !== 'object' || Array.isArray(definition))
      throw new AdtSafetyError('A lock-object definition requires a JSON object source.');
  }
  if (creating && args.type === 'TTYP' && (typeof args.rowType !== 'string' || !args.rowType.trim()))
    throw new AdtSafetyError('Creating a table type requires rowType.');
  if (
    !creating &&
    !PINNED_METADATA_INPUTS[args.type as string]!.some((field) => args[field] !== undefined) &&
    args.description === undefined
  )
    throw new AdtSafetyError('Select at least one metadata field to update.');
}

function fieldsFor(kind: string, type: string, action: unknown): Set<string> {
  const fields = new Set(['action', 'type', 'name', 'transport']);
  if (action === 'delete') return fields;
  const creating = action === 'create';
  if (creating) fields.add('package');
  if (kind === 'metadata') {
    fields.add('description');
    for (const field of PINNED_METADATA_INPUTS[type]!) fields.add(field);
    if (!creating) fields.add('expectedMetadataHash');
    return fields;
  }
  fields.add('source');
  if (kind === 'table-settings') {
    fields.delete('package');
    fields.add('expectedMetadataHash');
    return fields;
  }
  if (creating) fields.add('description');
  else fields.add('expectedSourceHash');
  return fields;
}

function assertEndpointAvailable(type: string, creating: boolean): void {
  if (!creating) return;
  if (type === 'DOMA' && isDomainsEndpointAvailable() === false) throw new AdtSafetyError(DOMA_WRITE_UNAVAILABLE_HINT);
  if (type === 'TTYP' && isTableTypesEndpointAvailable() === false)
    throw new AdtSafetyError(TTYP_WRITE_UNAVAILABLE_HINT);
  if (type === 'ENQU' && isLockObjectsEndpointAvailable() === false)
    throw new AdtSafetyError(ENQU_WRITE_UNAVAILABLE_HINT);
  if (type === 'TABL/DT' && isTablesEndpointAvailable() === false)
    throw new AdtSafetyError(
      'Transparent table creation needs /sap/bc/adt/ddic/tables/, which this release does not advertise.',
    );
}

/**
 * A bare TABL means transparent table on create; everywhere else the subtype is resolved from native
 * evidence so a mismatched assertion can neither reach the wrong collection nor flip the table class.
 */
async function resolveTableType(
  client: AdtClient,
  context: PinnedMutationContext,
  type: unknown,
  name: unknown,
  creating: boolean,
): Promise<unknown> {
  if (type !== 'TABL' && type !== 'TABL/DT' && type !== 'TABL/DS') return type;
  if (creating) return type === 'TABL' ? 'TABL/DT' : type;
  pinnedDdicSelection('TABL/DT', name);
  return resolvePinnedTableType(mutationClient(client, context), type, name as string, isTablesEndpointAvailable());
}

export async function createPinnedDdicContext(
  client: AdtClient,
  input: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
) {
  assertMutationContext(client.safety, context);
  const { action } = input;
  if (action !== 'create' && action !== 'update' && action !== 'delete')
    throw new AdtSafetyError('The private DDIC profile admits exact-owner create, update and delete only.');
  const creating = action === 'create';
  // Validate the static selection and inputs before any native evidence request.
  const requestedType = input.type === 'TABL' ? 'TABL/DT' : input.type;
  const profile = pinnedDdicSelection(requestedType, input.name);
  const fields = fieldsFor(profile.kind, profile.type, action);
  if (Object.keys(input).some((key) => input[key] !== undefined && !fields.has(key)))
    throw new AdtSafetyError('The private DDIC profile received an input outside its reviewed allowlist.');
  if (profile.kind === 'table-settings' && action !== 'update')
    throw new AdtSafetyError('TABL/DTT supports update only; create or delete the parent TABL instead.');
  if (input.transport !== undefined && (typeof input.transport !== 'string' || !input.transport.trim()))
    throw new AdtSafetyError('An explicitly provided CTS request must not be empty.');
  if (input.description !== undefined && typeof input.description !== 'string')
    throw new AdtSafetyError('The description must be text when provided.');
  if (input.source !== undefined && typeof input.source !== 'string')
    throw new AdtSafetyError('The source must be text when provided.');
  const hash = input.expectedMetadataHash;
  if (hash !== undefined && (typeof hash !== 'string' || !HASH.test(hash)))
    throw new AdtSafetyError('expectedMetadataHash must be a 64-character SHA-256 from an earlier native result.');
  assertEndpointAvailable(profile.type, creating);
  if (profile.kind === 'metadata' && action !== 'delete') validateMetadataInput(input, creating);
  if (profile.kind === 'table-settings' && (typeof input.source !== 'string' || !input.source.trim()))
    throw new AdtSafetyError('TABL/DTT source must be a partial JSON object of technical settings.');
  const indexChild = profile.type === 'TABL/DTI';
  if (indexChild) parseTableIndexName(profile.name);
  let args = input;
  if (creating && !indexChild) {
    if (typeof args.package !== 'string' || !args.package.trim())
      throw new AdtSafetyError('Creation requires an explicit package.');
    args = { ...args, package: args.package.trim().toUpperCase() };
  } else if (creating && typeof args.package === 'string') {
    args = { ...args, package: args.package.trim().toUpperCase() };
  }
  if (action === 'update' && profile.kind !== 'metadata' && profile.kind !== 'table-settings') {
    if (typeof args.source !== 'string' || !args.source.trim())
      throw new AdtSafetyError('A non-empty source is required.');
    if (typeof args.expectedSourceHash !== 'string' || !HASH.test(args.expectedSourceHash))
      throw new AdtSafetyError('Read the exact native source and supply its expectedSourceHash.');
  }
  if (creating && profile.kind === 'table-source' && typeof args.source === 'string' && !args.source.trim())
    throw new AdtSafetyError('Creation source must not contain only whitespace.');
  const type = await resolveTableType(client, context, input.type, input.name, creating);
  return createPinnedSourceContext(client, { ...args, type }, config, context, { wholeIncludeReplacement: false });
}
