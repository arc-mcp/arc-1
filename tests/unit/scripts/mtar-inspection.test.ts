import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectMtar } from '../../../scripts/btp/mtar-inspection.mjs';
import { LIMITS } from '../../../scripts/btp/mtar-zip.mjs';
import {
  DESCRIPTOR,
  MANIFEST,
  mtarEntries,
  ROUTER,
  SERVER,
  type ZipFixtureEntry,
  zipFixture,
} from '../../helpers/mtar-fixtures.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});
const realFs = await vi.importActual<typeof fs>('node:fs/promises');

let directory: string;
let archive: string;
const cli = resolve('scripts/btp/inspect-mtar.mjs');
const npmrc = await fs.readFile('btp/approuter/.npmrc');
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'arc1-mtar-'));
  archive = join(directory, 'selected archive.mtar');
});
afterEach(async () => {
  vi.mocked(fs.open).mockImplementation(realFs.open);
  vi.clearAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

async function inspect(entries = mtarEntries(), limits = LIMITS) {
  await fs.writeFile(archive, zipFixture(entries));
  return inspectMtar(archive, { limits });
}
async function payload(entries: ZipFixtureEntry[], module = SERVER) {
  return inspect(
    mtarEntries({ [SERVER]: zipFixture([{ name: 'dist/index.js', data: 'code' }]), [module]: zipFixture(entries) }),
  );
}
function failure(result: Awaited<ReturnType<typeof inspectMtar>>, code?: string) {
  expect(result.outcome).toBe('FAIL');
  expect(result.findings).toHaveLength(1);
  if (code) expect(result.findings[0]?.code).toBe(code);
}

describe('explicit MTAR inspection', () => {
  it('identifies the exact base archive, ignoring a newer unsafe archive', async () => {
    const buffer = zipFixture(mtarEntries());
    await fs.writeFile(archive, buffer);
    await fs.writeFile(join(directory, 'newer.mtar'), 'not a zip');
    const before = await fs.readdir(directory);
    const result = await inspectMtar(archive);
    expect(result.outcome).toBe('PASS');
    expect(result.artifact).toEqual({
      name: 'selected archive.mtar',
      sizeBytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
    expect(result.checkedPayloads).toEqual([{ module: SERVER, member: `${SERVER}/data.zip`, files: 1 }]);
    expect(result.members).toContainEqual({ archive: SERVER, path: 'dist/index.js', bytes: 4 });
    expect(await fs.readdir(directory)).toEqual(before);
    expect(await fs.readFile(archive)).toEqual(buffer);
  });

  it('checks every UI payload and permits only the exact reviewed root npmrc', async () => {
    const result = await payload(
      [
        { name: '.npmrc', data: npmrc },
        { name: 'xs-app.json', data: '{}' },
      ],
      ROUTER,
    );
    expect(result.outcome).toBe('PASS');
    expect(result.checkedPayloads).toHaveLength(2);
  });

  it.each([
    '.env',
    'sub/.env.production',
    'key.PEM',
    'key.der',
    'my-service-key.json',
    '.arc1/token',
    '.mcp.json',
    'cookies.txt',
    'customer.mtaext',
    'customer.mtaext.backup',
    'scripts/deploy.mjs',
    'tests/a.ts',
    '.git/config',
    '.codex/token.json',
  ])('rejects forbidden module path %s without contents', async (name) => {
    const result = await payload([{ name, data: 'DO_NOT_DISCLOSE_SECRET' }]);
    failure(result, 'PROHIBITED_PATH');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_DISCLOSE_SECRET');
  });

  it('does not mistake the runtime cookies helper for a credential export', async () => {
    expect((await payload([{ name: 'dist/adt/cookies.js', data: 'code' }])).outcome).toBe('PASS');
  });

  it('accepts stored files and UTF-8 names without shell expansion', async () => {
    expect((await payload([{ name: 'assets/ümlaut space.txt', method: 0, data: 'content' }])).outcome).toBe('PASS');
  });

  it('rejects conflicting Unicode filename metadata that could hide a prohibited path', async () => {
    const replacement = Buffer.from('safe-name');
    const extra = Buffer.alloc(9 + replacement.length);
    extra.writeUInt16LE(0x7075, 0);
    extra.writeUInt16LE(5 + replacement.length, 2);
    extra[4] = 1;
    extra.writeUInt32LE(crc32(Buffer.from('.env')), 5);
    replacement.copy(extra, 9);
    failure(await payload([{ name: '.env', extra, data: 'hidden' }]), 'UNSUPPORTED_ENTRY');
  });

  it('stops excess expansion inside a tiny compressed nested module', async () => {
    const entries = mtarEntries({ [SERVER]: zipFixture([{ name: 'large', data: 'x'.repeat(20_000) }]) });
    failure(await inspect(entries, { ...LIMITS, expandedBytes: 5_000 }), 'LIMIT');
    failure(await inspect(entries, { ...LIMITS, entryBytes: 5_000 }), 'LIMIT');
  });

  it('has no direct network/child-process surface in the repository inspector', async () => {
    const allowed = new Set([
      'node:crypto',
      'node:fs',
      'node:fs/promises',
      'node:path',
      'node:util',
      'node:zlib',
      'yaml',
      'yauzl',
      './mtar-inspection.mjs',
      './mtar-zip.mjs',
    ]);
    for (const file of ['inspect-mtar.mjs', 'mtar-inspection.mjs', 'mtar-zip.mjs']) {
      const source = await fs.readFile(`scripts/btp/${file}`, 'utf8');
      for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) expect(allowed.has(match[1]!)).toBe(true);
      expect(source).not.toMatch(/\b(?:fetch|import|require|execFile|spawn)\s*\(/);
    }
  });

  it.each(['.env', 'service-key.json', '.npmrc'])('rejects credential paths in the wrapper: %s', async (name) => {
    failure(await inspect([...mtarEntries(), { name, data: 'hidden' }]), 'PROHIBITED_PATH');
  });

  it.each([
    [SERVER, '.npmrc', 'install-links=true\n', 'PROHIBITED_PATH'],
    [ROUTER, 'sub/.npmrc', 'install-links=true\n', 'PROHIBITED_PATH'],
    [ROUTER, '.npmrc', 'install-links=false\n', 'NPMRC'],
    [ROUTER, 'package.json', '{}', 'NPMRC'],
  ])('fails misplaced/missing/altered npmrc in %s/%s', async (module, name, data, code) => {
    failure(await payload([{ name, data }], module), code);
  });

  it.each([MANIFEST, DESCRIPTOR, `${SERVER}/data.zip`, 'xs-security.json'])(
    'fails a missing required member: %s',
    async (name) => {
      failure(await inspect(mtarEntries().filter((entry) => entry.name !== name)));
    },
  );

  it.each([
    Buffer.from('not ZIP'),
    zipFixture([]),
    zipFixture([{ name: 'dir/', mode: 0o040755 }]),
    zipFixture([{ name: 'x', data: 'y' }]).subarray(0, 35),
  ])('fails missing/corrupt/empty payload', async (data) => {
    failure(await inspect(mtarEntries({ [SERVER]: data })));
  });

  it.each([
    '../escape',
    '/absolute',
    'C:/absolute',
    'dir\\file',
    './alias',
    'a//b',
    'a/../b',
    'control\u001bname',
    'file.',
  ])('rejects unsafe archive member %j', async (name) => {
    failure(await payload([{ name, data: 'bad' }]));
    expect(await fs.readdir(directory)).toEqual(['selected archive.mtar']);
  });

  it.each(
    [
      [{ name: 'x' }, { name: 'x' }],
      [{ name: 'X' }, { name: 'x' }],
      [{ name: 'x' }, { name: 'x/a' }],
      [{ name: 'x/a' }, { name: 'x' }],
    ].map((entries) => ({ entries })),
  )('rejects duplicate/colliding member names', async ({ entries }) =>
    failure(await payload(entries), 'DUPLICATE_PATH'),
  );

  it.each([
    [{ name: 'link', data: '/etc/passwd', mode: 0o120777 }, 'UNSUPPORTED_ENTRY'],
    [{ name: 'pipe', mode: 0o010644 }, 'UNSUPPORTED_ENTRY'],
    [{ name: 'encrypted', flags: 1 }, 'ENCRYPTED'],
    [{ name: 'unsupported', method: 12 }, 'COMPRESSION'],
    [{ name: 'bad-crc', data: 'data', crc: 123 }, 'INTEGRITY'],
    [{ name: 'safe', localName: '.env', data: 'data' }, 'INTEGRITY'],
  ] as const)('rejects unsupported/inconsistent entry %#', async (entry, code) =>
    failure(await payload([entry]), code),
  );

  it('fails a forged expanded size during decompression', async () => {
    failure(await payload([{ name: 'x', data: 'more than declared', declaredSize: 1 }]));
  });

  it.each(['archiveBytes', 'entryBytes', 'expandedBytes', 'metadataBytes', 'entries', 'nameBytes'] as const)(
    'fails closed at the %s resource limit',
    async (limit) => {
      failure(await inspect(mtarEntries(), { ...LIMITS, [limit]: 1 }), limit === 'nameBytes' ? 'UNSAFE_PATH' : 'LIMIT');
    },
  );

  it('does not descend into arbitrary nested application ZIPs', async () => {
    expect((await payload([{ name: 'assets/something.zip', data: 'not ZIP, application content' }])).outcome).toBe(
      'PASS',
    );
  });

  it.each([
    (entries: ZipFixtureEntry[]) => [...entries, { name: 'undeclared/data.zip', data: zipFixture([{ name: 'x' }]) }],
    (entries: ZipFixtureEntry[]) =>
      entries.map((entry) =>
        entry.name === MANIFEST
          ? { ...entry, data: String(entry.data).replace('MTA-Module: arc1-mcp-server', 'MTA-Module: wrong') }
          : entry,
      ),
    (entries: ZipFixtureEntry[]) =>
      entries.map((entry) =>
        entry.name === MANIFEST
          ? { ...entry, data: `${entry.data}\n\nName: xs-security.json\nMTA-Resource: arc1-xsuaa` }
          : entry,
      ),
    (entries: ZipFixtureEntry[]) =>
      entries.map((entry) => (entry.name === DESCRIPTOR ? { ...entry, data: 'modules: [\nbad' } : entry)),
    (entries: ZipFixtureEntry[]) =>
      entries.map((entry) =>
        entry.name === DESCRIPTOR
          ? { ...entry, data: String(entry.data).replace('"path":"arc1-mcp-server"', '"path":"wrong"') }
          : entry,
      ),
  ])('rejects ambiguous or inconsistent manifest/descriptor layouts %#', async (change) =>
    failure(await inspect(change(mtarEntries()))),
  );

  it('accepts CRLF and manifest continuation lines', async () => {
    const entries = mtarEntries().map((entry) =>
      entry.name === MANIFEST
        ? {
            ...entry,
            data: String(entry.data)
              .replace('arc1-mcp-server/data.zip', 'arc1-mcp-\n server/data.zip')
              .replaceAll('\n', '\r\n'),
          }
        : entry,
    );
    expect((await inspect(entries)).outcome).toBe('PASS');
  });

  it('detects archive replacement between snapshot and final verification', async () => {
    await fs.writeFile(archive, zipFixture(mtarEntries()));
    let opens = 0;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      if (String(args[0]) === archive && ++opens === 2)
        await fs.writeFile(
          archive,
          zipFixture(mtarEntries({ [SERVER]: zipFixture([{ name: 'different', data: 'x' }]) })),
        );
      return realFs.open(...args);
    });
    failure(await inspectMtar(archive), 'ARTIFACT_CHANGED');
  });

  it('returns ERROR for missing/unreadable input, not a misleading PASS', async () => {
    const result = await inspectMtar(archive);
    expect(result.outcome).toBe('ERROR');
    expect(result.artifact.sha256).toBeNull();
    expect(JSON.stringify(result)).not.toContain(directory);
  });

  it('rejects a directory as the selected archive', async () => {
    failure(await inspectMtar(directory), 'NOT_FILE');
  });

  it('treats an I/O failure during the final verification as ERROR without raw exception disclosure', async () => {
    await fs.writeFile(archive, zipFixture(mtarEntries()));
    vi.mocked(fs.open).mockImplementationOnce(realFs.open).mockRejectedValueOnce(new Error('DO_NOT_DISCLOSE_SECRET'));
    const result = await inspectMtar(archive);
    expect(result.outcome).toBe('ERROR');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_DISCLOSE_SECRET');
  });
});

describe('inspection command', () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      cwd: directory,
      env: { ...process.env, PATH: directory },
    });

  it.each(
    [
      [],
      ['--archive', '*.mtar'],
      ['--archive', 'a', '--archive', 'b'],
      ['--archive', 'a', 'b'],
      ['--archive', 'a', '--format', 'xml'],
      ['--deploy'],
    ].map((args) => ({ args })),
  )('rejects invalid arguments $args', ({ args }) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
    expect(result.stdout).toBe('');
  });

  it('runs without CF/unzip/shell helpers, emits matching text/JSON, and lists inert names', async () => {
    await inspect();
    const json = run(['--archive', archive, '--format', 'json']);
    expect(json.status).toBe(0);
    expect(json.stderr).toBe('');
    const result = JSON.parse(json.stdout);
    const text = run(['--archive', archive, '--list']);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain(result.artifact.sha256);
    expect(text.stdout).toContain(`${SERVER}:dist/index.js`);
    expect(text.stdout).toContain('no deployment is performed');
    expect(result.artifact.name).toBe('selected archive.mtar');
    expect(await fs.readdir(directory)).toEqual(['selected archive.mtar']);
  });

  it('reports archive FAIL as exit 1 and I/O ERROR as exit 2', async () => {
    await fs.writeFile(archive, 'not zip');
    const bad = run(['--archive', archive, '--format', 'json']);
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).outcome).toBe('FAIL');
    await fs.rm(archive);
    const missing = run(['--archive', archive, '--format', 'json']);
    expect(missing.status).toBe(2);
    expect(JSON.parse(missing.stdout).outcome).toBe('ERROR');
  });
});
