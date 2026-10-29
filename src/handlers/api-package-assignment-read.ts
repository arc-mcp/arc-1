/**
 * SAPRead type=SOD2: API package assignment metadata, its ORD document and its resource definitions
 * (the "ORD Document" and "Resource Definition" buttons of the Eclipse editor). Read-only.
 *
 * Documents come back with ignorable whitespace added (src/context/document-lines.ts) so that grep and
 * lineStart/lineEnd work on SAP's single-line EDMX/WSDL/ORD output; a document above
 * SOD2_MAX_DOCUMENT_CHARS needs one of the two instead of a full read.
 */
import {
  getApiPackageAssignment,
  getOrdDocument,
  getResourceDefinitions,
  type ResourceDefinition,
  SOD2_INCLUDES,
} from '../adt/api-package-assignment.js';
import { apiCatalogAvailable, apiCatalogUnavailableMessage, getApiPackage } from '../adt/api-packages.js';
import type { AdtClient } from '../adt/client.js';
import { isNotFoundError } from '../adt/errors.js';
import { breakJsonLines, breakXmlLines, needsLineBreaks } from '../context/document-lines.js';
import { grepSource } from '../context/grep.js';
import { readLineRange } from '../context/line-range.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

/** About 25k tokens. A SEGW OData V2 EDMX reaches ~500 KB, a generated OData V4 OpenAPI ~200 KB. */
export const SOD2_MAX_DOCUMENT_CHARS = 100_000;

const GREP_EXAMPLES: Record<string, string> = {
  ord: '"ordId"',
  openapi: '"summary"',
  edmx: 'EntityType Name=',
  wsdl: 'operation name=',
  asyncapi: '"channels"',
  sqlapi: '"name"',
  rfc: 'FUNCTIONNAME',
};

const UNSUPPORTED_OPTIONS = ['action', 'method', 'version', 'expand_includes', 'includeSignature'] as const;

function withLineBreaks(content: string, mediaType: ResourceDefinition['mediaType']): string {
  if (!needsLineBreaks(content)) return content;
  if (mediaType === 'application/json') return breakJsonLines(content);
  if (mediaType === 'application/xml') return breakXmlLines(content);
  return content;
}

function documentResult(
  args: Record<string, unknown>,
  label: string,
  include: string,
  content: string,
  mediaType: ResourceDefinition['mediaType'],
): ToolResult {
  const document = withLineBreaks(content, mediaType);
  if (args.grep !== undefined) {
    const g = grepSource(document, String(args.grep));
    return g.invalidPattern ? errorResult(g.output) : textResult(g.output);
  }
  if (args.lineStart !== undefined) {
    const range = readLineRange(document, Number(args.lineStart), Number(args.lineEnd));
    return range.invalidRange ? errorResult(range.output) : textResult(range.output);
  }
  if (document.length > SOD2_MAX_DOCUMENT_CHARS) {
    const example = GREP_EXAMPLES[include];
    return textResult(
      `${label} has ${document.length} characters on ${document.split('\n').length} lines, above the ` +
        `${SOD2_MAX_DOCUMENT_CHARS}-character limit for a full read. Read it in parts with grep` +
        `${example ? ` (e.g. grep="${example}")` : ''} or lineStart/lineEnd.`,
    );
  }
  return textResult(document);
}

export async function readApiPackageAssignment(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const name = String(args.name ?? '').trim();
  if (!name) return errorResult('"name" is required for SAPRead type=SOD2.');
  for (const option of UNSUPPORTED_OPTIONS) {
    if (args[option] !== undefined) return errorResult(`${option} is not supported for SAPRead type=SOD2.`);
  }
  if (args.format !== undefined && args.format !== 'text')
    return errorResult(`format="${String(args.format)}" is not supported for SAPRead type=SOD2.`);
  const include = args.include === undefined ? undefined : String(args.include).toLowerCase();
  if (include !== undefined && !(SOD2_INCLUDES as readonly string[]).includes(include))
    return errorResult(
      `Invalid include value "${String(args.include)}" for type SOD2. Valid values: ${SOD2_INCLUDES.join(', ')}`,
    );
  if ((args.grep !== undefined || args.lineStart !== undefined) && (include === undefined || include === 'specs'))
    return errorResult('For type SOD2, grep and lineStart/lineEnd need include="ord" or a resource definition kind.');
  if (!apiCatalogAvailable(client.http, 'SOD2')) return errorResult(apiCatalogUnavailableMessage('SOD2'));

  try {
    if (include === undefined) {
      const info = await getApiPackageAssignment(client.http, client.safety, name);
      // The tool schema only lists the type; the follow-up reads are announced in the answer.
      return textResult(toolJson({ ...info, next: ['include="ord"', 'include="specs"'] }));
    }
    if (include === 'ord') {
      const ord = await getOrdDocument(client.http, client.safety, name);
      if (!ord) return textResult(`SAP returned no ORD document for API package assignment ${name}.`);
      return documentResult(args, `The ORD document of ${name}`, include, ord, 'application/json');
    }
    const definitions = await getResourceDefinitions(client.http, client.safety, name);
    if (definitions.length === 0)
      return textResult(`SAP returned no resource definition for API package assignment ${name}.`);
    if (include === 'specs') {
      return textResult(
        toolJson({
          name,
          resourceDefinitions: definitions.map((d) => {
            const document = withLineBreaks(d.content, d.mediaType);
            return {
              kind: d.kind,
              version: d.version,
              mediaType: d.mediaType,
              bytes: Buffer.byteLength(d.content, 'utf8'),
              lines: document.split('\n').length,
              lineBreaksAdded: document !== d.content,
              eclipseTab: d.slot,
              ...(d.otherSlotDiffers
                ? { note: `The ${d.slot === 'JSON' ? 'EDMX' : 'JSON'} tab holds a different ${d.kind} variant.` }
                : {}),
            };
          }),
          next: `SAPRead(type="SOD2", name="${name}", include="<kind>")`,
        }),
      );
    }
    const definition = definitions.find((d) => d.kind === include);
    if (!definition)
      return errorResult(
        `API package assignment ${name} has no ${include} resource definition. Available: ${definitions.map((d) => d.kind).join(', ')}.`,
      );
    return documentResult(
      args,
      `The ${include} document of ${name}`,
      include,
      definition.content,
      definition.mediaType,
    );
  } catch (err) {
    if (isNotFoundError(err)) return errorResult(`API package assignment (SOD2) ${name} not found.`);
    throw err;
  }
}

/** SAPRead type=SOD1: the API package with the assignments that point to it. */
export async function readApiPackage(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const name = String(args.name ?? '').trim();
  if (!name) return errorResult('"name" is required for SAPRead type=SOD1.');
  for (const option of [...UNSUPPORTED_OPTIONS, 'include', 'grep', 'lineStart'] as const) {
    if (args[option] !== undefined) return errorResult(`${option} is not supported for SAPRead type=SOD1.`);
  }
  if (args.format !== undefined && args.format !== 'text')
    return errorResult(`format="${String(args.format)}" is not supported for SAPRead type=SOD1.`);
  if (!apiCatalogAvailable(client.http, 'SOD1')) return errorResult(apiCatalogUnavailableMessage('SOD1'));
  try {
    return textResult(toolJson(await getApiPackage(client.http, client.safety, name)));
  } catch (err) {
    if (isNotFoundError(err)) return errorResult(`API package (SOD1) ${name} not found.`);
    throw err;
  }
}
