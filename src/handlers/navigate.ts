/**
 * SAPNavigate handler — code navigation (go-to-definition, references, where-used, completion,
 * interface implementers, method surgery).
 */

import type { AdtClient } from '../adt/client.js';
import { findDefinition, getCompletion } from '../adt/codeintel.js';
import { AdtApiError } from '../adt/errors.js';
import { isOperationAllowed, OperationType } from '../adt/safety.js';
import type { ClassHierarchy } from '../adt/types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';
import { lookupLiveUsages, resolveWhereUsedUri } from './where-used.js';

// ─── SAPNavigate Handler ─────────────────────────────────────────────

export async function handleSAPNavigate(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');
  let uri = String(args.uri ?? '');
  const line = Number(args.line ?? 1);
  const column = Number(args.column ?? 1);
  const source = String(args.source ?? '');

  // Allow symbolic type+name as alternative to uri for references
  if (!uri && args.type && args.name) {
    const symName = String(args.name);
    uri = (await resolveWhereUsedUri(client, String(args.type), symName)) ?? '';
    if (!uri) {
      return errorResult(
        `Cannot resolve function group for "${symName}". Provide the full uri parameter, or use SAPSearch("${symName}") to find the ADT URI.`,
      );
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
      const lookup = await lookupLiveUsages(client, uri, objectType);
      const { results } = lookup;

      if (results.length === 0) {
        return textResult('No references found.');
      }
      if (lookup.ignoredObjectType) {
        return textResult(
          JSON.stringify(
            {
              note: `This SAP system does not support scope-based Where-Used. The objectType filter "${lookup.ignoredObjectType}" was ignored — results below are unfiltered.`,
              results,
            },
            null,
            2,
          ),
        );
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
