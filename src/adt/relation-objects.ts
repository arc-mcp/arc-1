/** Live-verified identity adapters, not a registry of everything SAP can display. */
export const RELATION_OBJECTS = [
  ['CLAS', 'CLAS/OC', 'oo/classes', 'abapClass'],
  ['INTF', 'INTF/OI', 'oo/interfaces', 'abapInterface'],
  ['DDLS', 'DDLS/DF', 'ddic/ddl/sources', 'ddlSource'],
  ['DCLS', 'DCLS/DL', 'acm/dcl/sources', 'dclSource'],
  ['BDEF', 'BDEF/BDO', 'bo/behaviordefinitions', 'blueSource'],
  ['SRVD', 'SRVD/SRV', 'ddic/srvd/sources', 'srvdSource'],
  ['TABL', 'TABL/DT', 'ddic/tables', 'blueSource'],
  ['TABL', 'TABL/DS', 'ddic/structures', 'blueSource'],
  ['TTYP', 'TTYP/DA', 'ddic/tabletypes', 'tableType'],
  ['DTEL', 'DTEL/DE', 'ddic/dataelements', 'wbobj'],
  ['DOMA', 'DOMA/DD', 'ddic/domains', 'domain'],
  ['PROG', 'PROG/P', 'programs/programs', 'abapProgram'],
  ['INCL', 'PROG/I', 'programs/includes', 'abapInclude'],
  ['FUGR', 'FUGR/F', 'functions/groups', 'abapFunctionGroup'],
  ['FUNC', 'FUGR/FF', 'functions/groups', 'abapFunctionModule'],
  ['VIEW', 'VIEW/DV', 'vit/wb/object_type/viewdv/object_name', 'mainObject'],
  ['ENHO', 'ENHO/XHB', 'enhancements/enhoxhb', 'objectData'],
  ['MSAG', 'MSAG/N', 'messageclass', 'messageClass'],
] as const;
export const RELATION_ROOT_TYPES = [...new Set(RELATION_OBJECTS.map(([type]) => type))];
export const RELATION_NAME = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_$]+$/i;

export class RelationProtocolError extends Error {
  constructor(message: string) {
    super(`Experimental live relations: ${message}`);
    this.name = 'RelationProtocolError';
  }
}

export function relationObjectSpec(type: string) {
  return RELATION_OBJECTS.find(([root, native]) => native === type || root === type);
}

function validName(name: string): string {
  if (name.length > 120 || !RELATION_NAME.test(name)) throw new RelationProtocolError('invalid object name.');
  return name;
}

/** Reconstruct a fixed read-only object path; never follow arbitrary SAP-returned hrefs. */
export function relationObjectUri(type: string, name: string, group?: string): string {
  const spec = relationObjectSpec(type);
  if (!spec) throw new RelationProtocolError('unsupported relation object type.');
  const encoded = encodeURIComponent(validName(name)[spec[0] === 'VIEW' ? 'toUpperCase' : 'toLowerCase']());
  const base = `/sap/bc/adt/${spec[2]}`;
  if (spec[0] === 'FUNC') {
    if (!group) throw new RelationProtocolError('function module requires a resolved function group.');
    return `${base}/${encodeURIComponent(validName(group).toLowerCase())}/fmodules/${encoded}`;
  }
  return `${base}/${encoded}`;
}

/** Group/name can be decoded only after the caller canonicalizes the host-relative ADT URI. */
export function relationFunctionIdentity(uri: string) {
  const match = /^\/sap\/bc\/adt\/functions\/groups\/([^/]+)\/fmodules\/([^/]+)$/.exec(uri);
  if (!match) throw new RelationProtocolError('invalid function module URI.');
  const group = validName(decodeURIComponent(match[1]!)).toUpperCase();
  const name = validName(decodeURIComponent(match[2]!)).toUpperCase();
  if (relationObjectUri('FUNC', name, group) !== uri) throw new RelationProtocolError('function URI mismatch.');
  return { group, name };
}

/** SAP 7.58 returns a 40-character function-pool prefix followed by the module name. */
export function relationReferenceName(name: string, type: string, uri: string): string {
  if (type !== 'FUGR/FF') return name;
  const identity = relationFunctionIdentity(uri);
  const pool = identity.group.startsWith('/')
    ? identity.group.replace(/^(\/[^/]+\/)/, '$1SAPL')
    : `SAPL${identity.group}`;
  if (
    ![identity.name, `${pool.padEnd(40)}${identity.name}`, `${identity.group.padEnd(40)}${identity.name}`].includes(
      name.toUpperCase(),
    )
  ) {
    throw new RelationProtocolError('function reference name/URI mismatch.');
  }
  return identity.name;
}
