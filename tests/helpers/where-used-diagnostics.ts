import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { AdtHttpClient } from '../../src/adt/http.js';

export const WHERE_USED_DIAGNOSTIC_PATH = 'test-results/where-used-diagnostics.json';
const REFERENCES = '/sap/bc/adt/repository/informationsystem/usageReferences';
const BODY_LIMIT = 64 * 1024;
const WARNING = 'Where-used diagnostic artifact could not be written.';
const XML_ROOTS = new Set(['usageReferenceRequest', 'usageReferenceResult', 'usageScopeRequest', 'usageScopeResult']);
const NAMESPACES = new Set(['http://www.sap.com/adt/ris/usageReferences', 'http://www.sap.com/adt/core']);
const TYPES = new Set(['CLAS', 'CLAS/OC', 'CLAS/OM', 'PROG/1P', 'PROG/1F', 'PROG/1T', 'TABL/DS', 'DEVC/K']);
const FLAGS = new Set([
  'isResult',
  'canHaveChildren',
  'definitions',
  'elements',
  'indirectReferences',
  'isSelected',
  'isDefault',
]);
const GRADES = new Set(['gradeDirect', 'gradeIndirect', 'gradeComponent', 'includeProductive', 'includeNonProductive']);

interface BodyCapture {
  bytes: number;
  hmac: string;
  rawStringEvidence: { rootPresent: boolean; consumerPresent: boolean; referencedObjectOpeningTags: number };
  raw?: string;
}

interface Exchange {
  phase: 'ordinary' | 'scoped';
  path: string;
  startedUtc: string;
  startedMsAfterActivation: number;
  finishedUtc?: string;
  finishedMsAfterActivation?: number;
  statusCode?: number;
  rejected?: boolean;
  request: BodyCapture;
  response?: BodyCapture;
}

/** Passive, bounded evidence for this one owned-class integration test. Never log HTTP arguments. */
export function recordWhereUsed(
  http: Pick<AdtHttpClient, 'post'>,
  options: { root: string; consumer: string; activatedAt: number; artifactPath?: string },
) {
  const artifactPath = options.artifactPath ?? WHERE_USED_DIAGNOSTIC_PATH;
  const key = randomBytes(32); // Artifact equality only; the key never leaves this closure.
  const hmac = (value: string) => createHmac('sha256', key).update(value).digest('hex');
  const marker = (value: unknown) => `[redacted:${hmac(JSON.stringify(value))}]`;
  const names = [options.root, options.consumer];
  const rootUri = `/sap/bc/adt/oo/classes/${options.root.toLowerCase()}`;
  const ownedValues = new Set([
    ...names.flatMap((name) => [
      name,
      name.toLowerCase(),
      `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
      `/sap/bc/adt/oo/classes/${name.toLowerCase()}/source/main`,
    ]),
    '$TMP',
    'CALCULATE',
    'calculate',
    'package:$TMP',
    '/sap/bc/adt/packages/%24tmp',
  ]);
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const exchanges: Exchange[] = [];
  const handlerRows: Record<string, unknown> = {};
  const originalPost = http.post;

  // Unknown values are always HMAC markers, including errors, user identifiers and free text.
  function sanitize(value: unknown, field = ''): unknown {
    const local = field.replace(/^@_/, '').split(':').at(-1)!;
    if (['payload', 'objectIdentifier', 'referencedObjectIdentifier'].includes(local)) {
      const textOnly =
        Array.isArray(value) &&
        value.every((node) => node && Object.keys(node).length === 1 && typeof node['#text'] === 'string');
      const opaque = textOnly ? value.map((node) => node['#text']).join('') : value;
      return {
        redacted: marker(opaque),
        valueBytes: Buffer.byteLength(typeof opaque === 'string' ? opaque : JSON.stringify(opaque), 'utf8'),
      };
    }
    if (Array.isArray(value)) return value.map((item) => sanitize(item, field));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, sanitize(child, name)]));
    const text = String(value);
    if (ownedValues.has(text)) return value;
    if (field.startsWith('@_xmlns') && NAMESPACES.has(text)) return value;
    if (FLAGS.has(local) && ['true', 'false'].includes(text)) return value;
    if (['numberOfResults', 'count'].includes(local) && /^\d{1,9}$/.test(text)) return value;
    if (['type', 'globalType', 'name', 'value'].includes(local) && TYPES.has(text)) return value;
    if (local === 'usageInformation' && text.split(',').every((token) => GRADES.has(token))) return value;
    if (field === '#text' && /^\s*$/.test(text)) return value;
    return marker(value);
  }

  function captureBody(raw: string): BodyCapture {
    const upper = raw.toUpperCase();
    const bytes = Buffer.byteLength(raw, 'utf8');
    return {
      bytes,
      hmac: hmac(raw),
      rawStringEvidence: {
        rootPresent: upper.includes(options.root.toUpperCase()),
        consumerPresent: upper.includes(options.consumer.toUpperCase()),
        referencedObjectOpeningTags: [...raw.matchAll(/<(?:[\w.-]+:)?referencedObject(?=[\s/>])/g)].length,
      },
      ...(bytes <= BODY_LIMIT ? { raw } : {}),
    };
  }

  function sanitizedBody(body: BodyCapture) {
    const { raw, ...metadata } = body;
    if (raw === undefined) return { ...metadata, omitted: 'body-limit' };
    if (XMLValidator.validate(raw) !== true) return { ...metadata, omitted: 'malformed-xml' };
    try {
      const tree = parser.parse(raw) as Record<string, unknown>[];
      if (!tree.some((node) => Object.keys(node).some((name) => XML_ROOTS.has(name.split(':').at(-1)!))))
        return { ...metadata, omitted: 'unknown-xml' };
      const sanitizedTree = sanitize(tree);
      if (Buffer.byteLength(JSON.stringify(sanitizedTree), 'utf8') > BODY_LIMIT)
        return { ...metadata, omitted: 'sanitized-limit' };
      return { ...metadata, sanitizedTree };
    } catch {
      return { ...metadata, omitted: 'unreadable-xml' };
    }
  }

  const recorder = {
    phase: 'ordinary' as 'ordinary' | 'scoped',
    recordResult(phase: 'ordinary' | 'scoped', result: { references?: Record<string, unknown>[] }) {
      try {
        handlerRows[phase] = (result.references ?? [])
          .filter((row) => names.includes(String(row.name)))
          .slice(0, 20)
          .map((row) =>
            sanitize(
              Object.fromEntries(
                ['name', 'type', 'uri', 'parentUri', 'packageName', 'isResult', 'canHaveChildren']
                  .filter((field) => row[field] !== undefined)
                  .map((field) => [field, row[field]]),
              ),
            ),
          );
      } catch {
        /* Evidence must never change the test outcome. */
      }
    },
    restore() {
      http.post = originalPost;
    },
    writeFailure() {
      try {
        const artifact = {
          evidenceMeaning:
            'Raw string matches and opening-tag counts, not parsed object membership. Owned handler rows capped at 20 per call. No later visibility probe.',
          handlerRows,
          exchanges: exchanges.map(({ request, response, ...metadata }) => ({
            ...metadata,
            request: sanitizedBody(request),
            ...(response ? { response: sanitizedBody(response) } : {}),
          })),
        };
        mkdirSync(dirname(artifactPath), { recursive: true });
        writeFileSync(artifactPath, JSON.stringify(artifact));
      } catch {
        console.warn(WARNING);
      }
    },
  };
  try {
    rmSync(artifactPath, { force: true });
  } catch {
    console.warn(WARNING);
  }

  http.post = async function (...args) {
    let entry: Exchange | undefined;
    try {
      const url = new URL(args[0], 'https://capture.invalid');
      if (
        args[0].startsWith('/') &&
        [REFERENCES, `${REFERENCES}/scope`].includes(url.pathname) &&
        url.searchParams.get('uri')?.toLowerCase() === rootUri &&
        exchanges.length < 3
      ) {
        const now = Date.now();
        entry = {
          phase: recorder.phase,
          path: url.pathname,
          startedUtc: new Date(now).toISOString(),
          startedMsAfterActivation: now - options.activatedAt,
          request: captureBody(args[1] ?? ''),
        };
        exchanges.push(entry);
      }
    } catch {
      /* The request still runs if evidence capture fails. */
    }
    try {
      const response = await originalPost.apply(this, args);
      try {
        if (entry) {
          const now = Date.now();
          entry.finishedUtc = new Date(now).toISOString();
          entry.finishedMsAfterActivation = now - options.activatedAt;
          entry.statusCode = response.statusCode;
          entry.response = captureBody(response.body);
        }
      } catch {
        /* Keep the exact response object even if capture fails. */
      }
      return response;
    } catch (error) {
      try {
        if (entry) {
          const now = Date.now();
          entry.finishedUtc = new Date(now).toISOString();
          entry.finishedMsAfterActivation = now - options.activatedAt;
          entry.rejected = true;
        }
      } catch {
        /* Keep the exact original rejection. */
      }
      throw error;
    }
  };
  return recorder;
}
