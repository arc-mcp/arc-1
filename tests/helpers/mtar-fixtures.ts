import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFixtureEntry {
  name: string;
  data?: Buffer | string;
  method?: number;
  flags?: number;
  mode?: number;
  crc?: number;
  declaredSize?: number;
  localName?: string;
  extra?: Buffer;
}

/** Tiny deterministic ZIP writer for adversarial fixtures, not application archive production. */
export function zipFixture(entries: ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    const name = Buffer.from(entry.name);
    const localName = Buffer.from(entry.localName ?? entry.name);
    const extra = entry.extra ?? Buffer.alloc(0);
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = entry.crc ?? crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? data.length, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(extra.length, 28);
    locals.push(local, localName, extra, compressed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(0x314, 4); // Unix, ZIP 2.0
    header.writeUInt16LE(20, 6);
    local.copy(header, 8, 6, 26);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name, extra);
    offset += local.length + localName.length + extra.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const SERVER = 'arc1-mcp-server';
export const ROUTER = 'arc1-ui-router';
export const MANIFEST = 'META-INF/MANIFEST.MF';
export const DESCRIPTOR = 'META-INF/mtad.yaml';

export function mtarEntries(
  modules: Record<string, Buffer> = { [SERVER]: zipFixture([{ name: 'dist/index.js', data: 'code' }]) },
): ZipFixtureEntry[] {
  const names = Object.keys(modules);
  const descriptor = {
    '_schema-version': '3.1',
    ID: 'arc1-mcp',
    version: '1.2.0',
    modules: names.map((name) => ({ name, type: 'javascript.nodejs', path: name })),
    resources: [{ name: 'arc1-xsuaa', parameters: { path: 'xs-security.json' } }],
  };
  const manifest = [
    'manifest-Version: 1.0\nCreated-By: synthetic fixture',
    ...names.map((name) => `Name: ${name}/data.zip\nMTA-Module: ${name}\nContent-Type: application/zip`),
    'Name: xs-security.json\nMTA-Resource: arc1-xsuaa\nContent-Type: application/json',
    `Name: ${DESCRIPTOR}\nContent-Type: text/plain`,
  ].join('\n\n');
  return [
    { name: MANIFEST, data: manifest },
    { name: DESCRIPTOR, data: JSON.stringify(descriptor) },
    ...names.map((name) => ({ name: `${name}/data.zip`, data: modules[name] })),
    { name: 'xs-security.json', data: '{"scopes":[]}' },
  ];
}
