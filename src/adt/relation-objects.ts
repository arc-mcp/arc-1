/** Live-verified identity adapters, not a registry of everything SAP can display. */
export const RELATION_OBJECTS = [
  {
    type: 'CLAS',
    native: 'CLAS/OC',
    path: 'oo/classes',
    metadataRoot: 'abapClass',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'INTF',
    native: 'INTF/OI',
    path: 'oo/interfaces',
    metadataRoot: 'abapInterface',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DDLS',
    native: 'DDLS/DF',
    path: 'ddic/ddl/sources',
    metadataRoot: 'ddlSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DCLS',
    native: 'DCLS/DL',
    path: 'acm/dcl/sources',
    metadataRoot: 'dclSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'BDEF',
    native: 'BDEF/BDO',
    path: 'bo/behaviordefinitions',
    metadataRoot: 'blueSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'SRVD',
    native: 'SRVD/SRV',
    path: 'ddic/srvd/sources',
    metadataRoot: 'srvdSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'TABL',
    native: 'TABL/DT',
    path: 'ddic/tables',
    metadataRoot: 'blueSource',
    resolve: 'quickSearch',
    nameCase: 'lower',
  },
  {
    type: 'TABL',
    native: 'TABL/DS',
    path: 'ddic/structures',
    metadataRoot: 'blueSource',
    resolve: 'quickSearch',
    nameCase: 'lower',
  },
  {
    type: 'TTYP',
    native: 'TTYP/DA',
    path: 'ddic/tabletypes',
    metadataRoot: 'tableType',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DTEL',
    native: 'DTEL/DE',
    path: 'ddic/dataelements',
    metadataRoot: 'wbobj',
    resolve: 'path',
    nameCase: 'lower',
  },
  { type: 'DOMA', native: 'DOMA/DD', path: 'ddic/domains', metadataRoot: 'domain', resolve: 'path', nameCase: 'lower' },
  {
    type: 'PROG',
    native: 'PROG/P',
    path: 'programs/programs',
    metadataRoot: 'abapProgram',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'INCL',
    native: 'PROG/I',
    path: 'programs/includes',
    metadataRoot: 'abapInclude',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'FUGR',
    native: 'FUGR/F',
    path: 'functions/groups',
    metadataRoot: 'abapFunctionGroup',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'FUNC',
    native: 'FUGR/FF',
    path: 'functions/groups',
    metadataRoot: 'abapFunctionModule',
    resolve: 'quickSearch',
    nameCase: 'lower',
  },
  {
    type: 'VIEW',
    native: 'VIEW/DV',
    path: 'vit/wb/object_type/viewdv/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'ENHO',
    native: 'ENHO/XHB',
    path: 'enhancements/enhoxhb',
    metadataRoot: 'objectData',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'MSAG',
    native: 'MSAG/N',
    path: 'messageclass',
    metadataRoot: 'messageClass',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'TRAN',
    native: 'TRAN/T',
    path: 'vit/wb/object_type/trant/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'SOBJ',
    native: 'SOBJ/MO',
    path: 'vit/wb/object_type/sobjmo/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'SHLP',
    native: 'SHLP/DH',
    path: 'vit/wb/object_type/shlpdh/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'SKTD',
    native: 'SKTD/TYP',
    path: 'documentation/ktd/documents',
    metadataRoot: 'docu',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'ENHS',
    native: 'ENHS/XSB',
    path: 'enhancements/enhsxsb',
    metadataRoot: 'objectData',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'ENQU',
    native: 'ENQU/DL',
    path: 'ddic/lockobjects/sources',
    metadataRoot: 'lockobject',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'TYPE',
    native: 'TYPE/DG',
    path: 'ddic/typegroups',
    metadataRoot: 'abapTypeGroup',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'EVTB',
    native: 'EVTB/EVB',
    path: 'businessservices/evtbevb',
    metadataRoot: 'blueSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DSFD',
    native: 'DSFD/SCF',
    path: 'ddic/dsfd/sources',
    metadataRoot: 'blueSource',
    resolve: 'path',
    nameCase: 'lower',
  },
] as const;
export const RELATION_ROOT_TYPES = [...new Set(RELATION_OBJECTS.map(({ type }) => type))];
export const RELATION_NAME = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_$]+$/i;

export class RelationProtocolError extends Error {
  constructor(message: string) {
    super(`Experimental live relations: ${message}`);
    this.name = 'RelationProtocolError';
  }
}

export function relationObjectSpec(type: string) {
  return RELATION_OBJECTS.find((spec) => spec.native === type || spec.type === type);
}

function validName(name: string): string {
  if (name.length > 120 || !RELATION_NAME.test(name)) throw new RelationProtocolError('invalid object name.');
  return name;
}

/** Reconstruct a fixed read-only object path; never follow arbitrary SAP-returned hrefs. */
export function relationObjectUri(type: string, name: string, group?: string): string {
  const spec = relationObjectSpec(type);
  if (!spec) throw new RelationProtocolError('unsupported relation object type.');
  const encoded = encodeURIComponent(validName(name)[spec.nameCase === 'upper' ? 'toUpperCase' : 'toLowerCase']());
  const base = `/sap/bc/adt/${spec.path}`;
  if (spec.type === 'FUNC') {
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

/** SAP 7.58 may prefix the module with its group or function pool, padded to 40 chars.
 * Example: group /ACME/GROUP → pool /ACME/SAPLGROUP; either prefix + spaces + ZFUNCTION.
 * Validate the entire prefix, not just the module suffix: a different parent is not this object.
 */
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
