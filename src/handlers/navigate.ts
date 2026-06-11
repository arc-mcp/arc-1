/**
 * SAPNavigate handler — code navigation (go-to-definition, references, where-used, completion,
 * interface implementers, method surgery). Extracted from intent.ts (Stage B; moved verbatim).
 */

import type { AdtClient } from '../adt/client.js';
import {
  findDefinition,
  findInterfaceImplementersViaSeoMetaRel,
  findReferences,
  findWhereUsed,
  getCompletion,
  type ReferenceResult,
  type WhereUsedResult,
} from '../adt/codeintel.js';
import { AdtApiError } from '../adt/errors.js';
import { isOperationAllowed, OperationType } from '../adt/safety.js';
import type { ClassHierarchy } from '../adt/types.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

// ─── SAPNavigate Handler ─────────────────────────────────────────────

export async function handleSAPNavigate(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');
  let uri = String(args.uri ?? '');
  const line = Number(args.line ?? 1);
  const column = Number(args.column ?? 1);
  const source = String(args.source ?? '');

  // Allow symbolic type+name as alternative to uri for references
  if (!uri && args.type && args.name) {
    const symType = normalizeObjectType(String(args.type));
    const symName = String(args.name);
    if (symType === 'FUNC') {
      // FUNC needs group to build URL — auto-resolve it
      const group = await client.resolveFunctionGroup(symName);
      if (group) {
        uri = `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodeURIComponent(symName)}`;
      } else {
        return errorResult(
          `Cannot resolve function group for "${symName}". Provide the full uri parameter, or use SAPSearch("${symName}") to find the ADT URI.`,
        );
      }
    } else if (symType === 'TABL') {
      // DDIC TABL: where-used and other navigate paths must use the canonical
      // object URL — `/sap/bc/adt/ddic/tables/{name}` for transparent tables,
      // `/sap/bc/adt/ddic/structures/{name}` for DDIC structures. NW 7.50
      // returns 500 from usageReferences for /tables/ URLs even for transparent
      // tables, so we always resolve before building. resolveTablObjectUrl
      // caches on the AdtClient, so this is one HTTP probe per cold name.
      uri = await client.resolveTablObjectUrl(symName);
    } else {
      uri = objectUrlForType(symType, symName);
    }
  }

  switch (action) {
    case 'definition': {
      if (!uri) {
        return errorResult('Provide uri (or type+name) and line+column for definition lookup.');
      }
      const result = await findDefinition(client.http, client.safety, uri, line, column, source);
      if (!result) {
        return textResult('No definition found at this position.');
      }
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'references': {
      if (!uri) {
        return errorResult('Provide uri or type+name to find references.');
      }
      // objectType is passed to SAP's where-used scope API which expects slash format (CLAS/OC, PROG/P).
      // Do NOT normalize it — the slash suffix is semantically meaningful for the SAP filter.
      const objectType = args.objectType ? String(args.objectType) : undefined;
      let results: WhereUsedResult[] | ReferenceResult[];
      try {
        results = await findWhereUsed(client.http, client.safety, uri, objectType);
      } catch (err) {
        // Only fall back for HTTP errors indicating the endpoint is not available (older SAP systems)
        if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
          results = await findReferences(client.http, client.safety, uri);
          if (results.length === 0) {
            return textResult('No references found.');
          }
          const json = JSON.stringify(results, null, 2);
          if (objectType) {
            return textResult(
              JSON.stringify(
                {
                  note: `This SAP system does not support scope-based Where-Used. The objectType filter "${objectType}" was ignored — results below are unfiltered.`,
                  results,
                },
                null,
                2,
              ),
            );
          }
          return textResult(json);
        } else {
          throw err;
        }
      }

      // Augment interface where-used with implementing classes from SEOMETAREL.
      // SAP's scope-based usageReferences endpoint sometimes does NOT surface
      // interface→implementing-class links — the implementations sit inside a
      // `canHaveChildren="true"` Interface Section node, and the snippet
      // expansion endpoint returns 404 on every release we've probed (NW 7.50,
      // S/4HANA 2023). SEOMETAREL is the canonical OO-relation table and is
      // always populated, so this augmentation makes references reliable for
      // interfaces. Silently skipped when SQL/data access isn't available.
      const intfMatch = uri.match(/\/sap\/bc\/adt\/oo\/interfaces\/([^/?]+)/i);
      if (intfMatch && (!objectType || /^CLAS/i.test(objectType))) {
        const interfaceName = decodeURIComponent(intfMatch[1]).toUpperCase();
        const canFreeSQL = isOperationAllowed(client.safety, OperationType.FreeSQL);
        const canQuery = isOperationAllowed(client.safety, OperationType.Query);
        try {
          let implementers: WhereUsedResult[] = [];
          if (canFreeSQL) {
            implementers = await findInterfaceImplementersViaSeoMetaRel(
              (sql, max) => client.runQuery(sql, max),
              interfaceName,
            );
          } else if (canQuery) {
            implementers = await findInterfaceImplementersViaSeoMetaRel(
              (_sql, max) =>
                client.getTableContents('SEOMETAREL', max, `REFCLSNAME = '${interfaceName}' AND RELTYPE = '1'`),
              interfaceName,
            );
          }
          // Dedupe: don't add an implementer if SAP already returned it
          const existingNames = new Set(
            (results as WhereUsedResult[]).map((r) => r.name?.toUpperCase()).filter(Boolean),
          );
          const augmented = implementers.filter((r) => !existingNames.has(r.name.toUpperCase()));
          if (augmented.length > 0) {
            (results as WhereUsedResult[]).push(...augmented);
          }
        } catch {
          // SEOMETAREL augmentation is best-effort; if SQL fails, fall back to
          // whatever the where-used HTTP endpoint returned. Don't block the response.
        }
      }

      if (results.length === 0) {
        return textResult('No references found.');
      }
      return textResult(JSON.stringify(results, null, 2));
    }
    case 'completion': {
      const proposals = await getCompletion(client.http, client.safety, uri, line, column, source);
      return textResult(JSON.stringify(proposals, null, 2));
    }
    case 'hierarchy': {
      const className = String(args.name ?? '').toUpperCase();
      if (!className) {
        return errorResult('Provide name (class name) for hierarchy lookup.');
      }
      // Sanitize to prevent SQL injection — class names are alphanumeric + underscore + namespace slash
      const safeName = className.replace(/[^A-Z0-9_/]/g, '');
      if (safeName !== className) {
        return errorResult(
          `Invalid class name: "${className}". Only alphanumeric characters, underscores, and slashes are allowed.`,
        );
      }

      const canFreeSQL = isOperationAllowed(client.safety, OperationType.FreeSQL);
      const canQuery = isOperationAllowed(client.safety, OperationType.Query);

      if (!canFreeSQL && !canQuery) {
        return errorResult(
          'Class hierarchy requires data access permissions. ' +
            'Enable free SQL (SAP_ALLOW_FREE_SQL=true / --allow-free-sql=true) or table preview ' +
            '(SAP_ALLOW_DATA_PREVIEW=true / --allow-data-preview=true), and grant the matching sql/data scope in HTTP auth mode.',
        );
      }

      try {
        let ownRels: { columns: string[]; rows: Record<string, string>[] };
        let subRels: { columns: string[]; rows: Record<string, string>[] };

        if (canFreeSQL) {
          ownRels = await client.runQuery(
            `SELECT CLSNAME, REFCLSNAME, RELTYPE FROM SEOMETAREL WHERE CLSNAME = '${safeName}'`,
            100,
          );
          subRels = await client.runQuery(
            `SELECT CLSNAME FROM SEOMETAREL WHERE REFCLSNAME = '${safeName}' AND RELTYPE = '2'`,
            100,
          );
        } else {
          // Fall back to named table preview (Query op type)
          ownRels = await client.getTableContents('SEOMETAREL', 100, `CLSNAME = '${safeName}'`);
          subRels = await client.getTableContents('SEOMETAREL', 100, `REFCLSNAME = '${safeName}' AND RELTYPE = '2'`);
        }

        let superclass: string | null = null;
        const interfaces: string[] = [];
        for (let i = 0; i < ownRels.rows.length; i++) {
          const row = ownRels.rows[i]!;
          const reltype = String(row.RELTYPE ?? '').trim();
          const refName = String(row.REFCLSNAME ?? '').trim();
          if (reltype === '2') {
            superclass = refName;
          } else if (reltype === '1') {
            interfaces.push(refName);
          }
        }

        const subclasses: string[] = [];
        for (let i = 0; i < subRels.rows.length; i++) {
          subclasses.push(String(subRels.rows[i]!.CLSNAME ?? '').trim());
        }

        const result: ClassHierarchy = { className: safeName, superclass, interfaces, subclasses };
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if (err instanceof AdtApiError && err.statusCode === 404) {
          return errorResult('Cannot query SEOMETAREL — table may not be accessible on this system.');
        }
        throw err;
      }
    }
    default:
      return errorResult(
        `Unknown SAPNavigate action: ${action}. Supported: definition, references, completion, hierarchy`,
      );
  }
}
