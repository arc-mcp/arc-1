/**
 * SAPDiagnose handler — runtime diagnostics: short dumps (ST22), traces, gateway errors, object
 * state, ATC, unit tests, CDS test cases.
 */

import type { AdtClient } from '../adt/client.js';
import {
  applyFixProposal,
  getCdsTestCases,
  getFixProposals,
  runAtcCheck,
  runUnitTests,
  supportsCdsTestCases,
  syntaxCheck,
} from '../adt/devtools.js';
import {
  createTraceRequest,
  deleteTraceRequest,
  getCdsCreateStatements,
  getDump,
  getGatewayErrorDetail,
  getObjectState,
  getSqlTraceDirectory,
  getSqlTraceState,
  getTraceDbAccesses,
  getTraceHitlist,
  getTraceStatements,
  listDumps,
  listGatewayErrors,
  listSystemMessages,
  listTraceRequests,
  listTraces,
  probeODataPerformance,
  setSqlTraceState,
} from '../adt/diagnostics.js';
import type {
  DumpDetail,
  FixAffectedObject,
  TracedObjectType,
  TracedProcessType,
  TraceRequestCreateOptions,
} from '../adt/types.js';
import { isBtpSystem } from './feature-cache.js';
import { classIncludeUrl, normalizeObjectType, objectUrlForType, sourceUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

export async function handleSAPDiagnose(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const name = String(args.name ?? '');
  const type = normalizeObjectType(String(args.type ?? ''));

  switch (action) {
    case 'syntax': {
      const objectUrl = objectUrlForType(type, name);
      const version = args.version === 'inactive' ? 'inactive' : args.version === 'active' ? 'active' : undefined;
      const content = typeof args.source === 'string' ? (args.source as string) : undefined;
      const opts: { version?: 'active' | 'inactive'; content?: string } = {};
      if (version) opts.version = version;
      if (content !== undefined) opts.content = content;
      const result = await syntaxCheck(
        client.http,
        client.safety,
        objectUrl,
        Object.keys(opts).length > 0 ? opts : undefined,
      );
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'unittest': {
      const objectUrl = objectUrlForType(type, name);
      const coverage = args.coverage === true;
      const result = await runUnitTests(client.http, client.safety, objectUrl, { coverage });
      // Default (no coverage) keeps the historical array output; coverage requested → {tests, coverage}.
      if (!coverage) return textResult(JSON.stringify(result.tests, null, 2));
      const out: Record<string, unknown> = { tests: result.tests };
      if (result.coverage) out.coverage = result.coverage;
      else
        out.coverageNote =
          'Coverage unavailable on this system (the coverage-measurement endpoint or measurement result was not available).';
      return textResult(JSON.stringify(out, null, 2));
    }
    case 'atc': {
      const objectUrl = objectUrlForType(type, name);
      const variant = args.variant as string | undefined;
      const result = await runAtcCheck(client.http, client.safety, objectUrl, variant);
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'cds_testcases': {
      // SAP-suggested ABAP Unit test cases for a CDS entity (CDS Test Double Framework).
      // The CDS name goes straight into the ?ddlsourceName= query param — no object URL.
      if (!name) {
        return errorResult('"name" (the CDS entity / DDLS source name) is required for "cds_testcases".');
      }
      // Discovery-gate: the endpoint exists only on SAP_BASIS 8.16+ (ABAP Platform 2025).
      // `false` = discovery loaded and the collection is absent (7.5x / 758) → clear message.
      // `undefined` = discovery not loaded → attempt and let a 404/400 surface normally.
      if (supportsCdsTestCases(client.http) === false) {
        return errorResult(
          'CDS test-case scaffolding requires SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025). ' +
            'This system does not expose /sap/bc/adt/aunit/dbtestdoubles/cds/testcases.',
        );
      }
      const result = await getCdsTestCases(client.http, client.safety, name);
      const payload = {
        ...result,
        hint:
          `Scaffold an ABAP Unit test class for ${result.cds}: ` +
          `cl_cds_test_environment=>create( i_for_entity = '${result.cds}' ) in class_setup, ` +
          'then implement one FOR TESTING method per case (insert_test_data for the doubled sources, ' +
          'assert with cl_abap_unit_assert). AI testdata/testmethod generation is not exposed.',
      };
      return textResult(JSON.stringify(payload, null, 2));
    }
    case 'object_state': {
      if (!name || !type) return errorResult('"name" and "type" are required for "object_state" action.');
      const sections =
        type === 'CLAS'
          ? [
              { section: 'main', uri: sourceUrlForType(type, name) },
              { section: 'definitions', uri: classIncludeUrl(name, 'definitions'), optional: true },
              { section: 'implementations', uri: classIncludeUrl(name, 'implementations'), optional: true },
              { section: 'macros', uri: classIncludeUrl(name, 'macros'), optional: true },
              { section: 'testclasses', uri: classIncludeUrl(name, 'testclasses'), optional: true },
            ]
          : [{ section: 'main', uri: sourceUrlForType(type, name) }];

      const result = await getObjectState(client.http, client.safety, { type, name, sections });
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'quickfix': {
      const source = args.source as string | undefined;
      const sourceUri = args.sourceUri as string | undefined;
      if (!name || !type) return errorResult('"name" and "type" are required for "quickfix" action.');
      if (!source) return errorResult('"source" is required for "quickfix" action.');
      if (args.line == null) return errorResult('"line" is required for "quickfix" action.');

      const line = Number(args.line);
      const column = Number(args.column ?? 0);
      if (!Number.isFinite(line)) return errorResult('"line" must be a number for "quickfix" action.');
      if (!Number.isFinite(column)) return errorResult('"column" must be a number for "quickfix" action.');

      const proposals = await getFixProposals(
        client.http,
        client.safety,
        sourceUri ?? sourceUrlForType(type, name),
        source,
        line,
        column,
      );
      return textResult(JSON.stringify(proposals, null, 2));
    }
    case 'apply_quickfix': {
      const source = args.source as string | undefined;
      const sourceUri = args.sourceUri as string | undefined;
      const proposalUri = args.proposalUri as string | undefined;
      const proposalUserContent = args.proposalUserContent as string | undefined;
      const proposalAffectedObjects = args.proposalAffectedObjects as FixAffectedObject[] | undefined;
      if (!name || !type) return errorResult('"name" and "type" are required for "apply_quickfix" action.');
      if (!source) return errorResult('"source" is required for "apply_quickfix" action.');
      if (args.line == null) return errorResult('"line" is required for "apply_quickfix" action.');
      if (!proposalUri) return errorResult('"proposalUri" is required for "apply_quickfix" action.');
      if (proposalUserContent === undefined)
        return errorResult('"proposalUserContent" is required for "apply_quickfix" action.');

      const line = Number(args.line);
      const column = Number(args.column ?? 0);
      if (!Number.isFinite(line)) return errorResult('"line" must be a number for "apply_quickfix" action.');
      if (!Number.isFinite(column)) return errorResult('"column" must be a number for "apply_quickfix" action.');

      const deltas = await applyFixProposal(
        client.http,
        client.safety,
        {
          uri: proposalUri,
          type: 'quickfix/proposal',
          name: '',
          description: '',
          userContent: proposalUserContent,
          ...(proposalAffectedObjects ? { affectedObjects: proposalAffectedObjects } : {}),
        },
        sourceUri ?? sourceUrlForType(type, name),
        source,
        line,
        column,
      );
      return textResult(JSON.stringify(deltas, null, 2));
    }
    case 'dumps': {
      const id = args.id as string | undefined;
      if (id) {
        const detail = await getDump(client.http, client.safety, id);
        const includeFullText = args.includeFullText === true || String(args.includeFullText ?? '') === 'true';
        const selectedSections = selectDumpSections(detail, args.sections);

        const payload: Record<string, unknown> = {
          id: detail.id,
          error: detail.error,
          exception: detail.exception,
          program: detail.program,
          user: detail.user,
          timestamp: detail.timestamp,
          chapters: detail.chapters,
          terminationUri: detail.terminationUri,
          sections: selectedSections,
          selectedSectionIds: Object.keys(selectedSections),
          availableSections: detail.chapters.map((chapter) => ({
            id: chapter.name,
            title: chapter.title,
            line: chapter.line,
          })),
        };
        if (includeFullText) {
          payload.formattedText = detail.formattedText;
        }
        return textResult(JSON.stringify(payload, null, 2));
      }

      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const dumps = await listDumps(client.http, client.safety, { user, maxResults });
      return textResult(JSON.stringify(dumps, null, 2));
    }
    case 'traces': {
      const id = args.id as string | undefined;
      if (id) {
        // Get trace analysis
        const analysis = String(args.analysis ?? 'hitlist');
        switch (analysis) {
          case 'hitlist': {
            const hitlist = await getTraceHitlist(client.http, client.safety, id);
            return textResult(JSON.stringify(hitlist, null, 2));
          }
          case 'statements': {
            const statements = await getTraceStatements(client.http, client.safety, id);
            return textResult(JSON.stringify(statements, null, 2));
          }
          case 'dbAccesses': {
            const dbAccesses = await getTraceDbAccesses(client.http, client.safety, id);
            return textResult(JSON.stringify(dbAccesses, null, 2));
          }
          default:
            return errorResult(`Unknown trace analysis type: ${analysis}. Supported: hitlist, statements, dbAccesses`);
        }
      }
      // List traces
      const traces = await listTraces(client.http, client.safety);
      return textResult(JSON.stringify(traces, null, 2));
    }
    case 'trace_start': {
      const opts: TraceRequestCreateOptions = {};
      if (args.traceUser !== undefined) opts.traceUser = String(args.traceUser);
      if (args.processType !== undefined) opts.processType = args.processType as TracedProcessType;
      if (args.objectType !== undefined) opts.objectType = args.objectType as TracedObjectType;
      if (args.maxExecutions !== undefined) opts.maxExecutions = Number(args.maxExecutions);
      if (args.expiresHours !== undefined) opts.expiresHours = Number(args.expiresHours);
      if (args.sqlTrace !== undefined) opts.sqlTrace = args.sqlTrace === true;
      if (args.aggregate !== undefined) opts.aggregate = args.aggregate === true;
      if (args.description !== undefined) opts.description = String(args.description);
      const request = await createTraceRequest(client.http, client.safety, client.username, client.sapClient, opts);
      return textResult(
        JSON.stringify(
          {
            armed: true,
            request,
            next: 'Reproduce the slow action (e.g. the OData call) as this user PROMPTLY — an http request captures the user\'s very next matching HTTP call, so avoid other ARC-1 calls in between (they would consume it). Then SAPDiagnose(action="traces") with no id to list recorded traces, find the new trace id, and read it with analysis="dbAccesses". Note: for an HTTP/OData trace, dbAccesses lists the tables the request touched but SAP returns no per-statement SQL text/timing here (hitlist/statements are usually empty); for the actual slow SQL + duration + plan use ST05 in SAP GUI. The profiler trace is richest for dialog/report/RFC traces of ABAP-side code.',
          },
          null,
          2,
        ),
      );
    }
    case 'trace_requests': {
      const user = (args.traceUser as string | undefined) ?? (args.user as string | undefined) ?? client.username;
      const requests = await listTraceRequests(client.http, client.safety, user);
      return textResult(JSON.stringify(requests, null, 2));
    }
    case 'trace_cancel': {
      const id = args.id as string | undefined;
      if (!id) return errorResult('trace_cancel requires "id" (from trace_start or trace_requests).');
      await deleteTraceRequest(client.http, client.safety, id);
      return textResult(JSON.stringify({ cancelled: true, id }, null, 2));
    }
    case 'system_messages': {
      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const from = args.from as string | undefined;
      const to = args.to as string | undefined;
      const messages = await listSystemMessages(client.http, client.safety, { user, maxResults, from, to });
      return textResult(JSON.stringify(messages, null, 2));
    }
    case 'gateway_errors': {
      if (isBtpSystem()) {
        return errorResult(
          'SAP Gateway error log is not available on BTP ABAP Environment. Use this action on on-prem systems.',
        );
      }

      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const from = args.from as string | undefined;
      const to = args.to as string | undefined;
      const detailUrl = args.detailUrl as string | undefined;
      const id = args.id as string | undefined;
      const errorType = args.errorType as string | undefined;

      if (detailUrl || id) {
        const detail = await getGatewayErrorDetail(client.http, client.safety, { detailUrl, id, errorType });
        return textResult(JSON.stringify(detail, null, 2));
      }

      const errors = await listGatewayErrors(client.http, client.safety, { user, maxResults, from, to });
      return textResult(JSON.stringify(errors, null, 2));
    }
    case 'odata_perf': {
      const url = String(args.url ?? '').trim();
      if (!url) {
        return errorResult(
          'SAPDiagnose action="odata_perf" requires a "url" — the host-relative OData path from the Fiori app\'s Network tab (e.g. "/sap/opu/odata4/sap/.../Entity?$filter=..." or "/sap/opu/odata/sap/<SRV>/<EntitySet>?$top=20"). ARC-1 GETs it with ?sap-statistics=true and a wall-clock timer, then returns the server-side timing split + a routing verdict.',
        );
      }
      const perf = await probeODataPerformance(client.http, client.safety, url);
      return textResult(JSON.stringify(perf, null, 2));
    }
    case 'cds_sql': {
      if (!name) {
        return errorResult(
          'SAPDiagnose action="cds_sql" requires a "name" — the CDS DDL source (DDLS), e.g. "I_CURRENCY". Returns the native SQL CREATE VIEW statements the CDS view compiles to.',
        );
      }
      const cdsSql = await getCdsCreateStatements(client.http, client.safety, name);
      return textResult(JSON.stringify(cdsSql, null, 2));
    }
    case 'sql_trace_state': {
      const states = await getSqlTraceState(client.http, client.safety);
      return textResult(JSON.stringify(states, null, 2));
    }
    case 'set_sql_trace_state': {
      if (args.sqlOn === undefined) {
        return errorResult(
          'SAPDiagnose action="set_sql_trace_state" requires "sqlOn" (true to arm the ST05 SQL trace, false to disarm). Optional "user" filters the trace to one SAP user. After arming, reproduce the slow request, then call action="sql_trace_directory" for the record-viewer link. Needs SAP_ALLOW_WRITES.',
        );
      }
      const sqlOn = args.sqlOn === true || String(args.sqlOn) === 'true';
      const traceUser = args.user !== undefined ? String(args.user) : undefined;
      const states = await setSqlTraceState(client.http, client.safety, { sqlOn, traceUser });
      return textResult(
        JSON.stringify(
          {
            states,
            next: sqlOn
              ? 'SQL trace armed. Reproduce the slow request, then call SAPDiagnose(action="sql_trace_directory") for the SQL Trace Analysis link, or read the generated SQL with SAPDiagnose(action="cds_sql").'
              : 'SQL trace disarmed.',
          },
          null,
          2,
        ),
      );
    }
    case 'sql_trace_directory': {
      const dir = await getSqlTraceDirectory(client.http, client.safety);
      return textResult(JSON.stringify(dir, null, 2));
    }
    default:
      return errorResult(
        `Unknown SAPDiagnose action: ${action}. Supported: syntax, unittest, atc, cds_testcases, object_state, quickfix, apply_quickfix, dumps, traces, trace_start, trace_requests, trace_cancel, system_messages, gateway_errors, odata_perf, cds_sql, sql_trace_state, set_sql_trace_state, sql_trace_directory`,
      );
  }
}

function selectDumpSections(detail: DumpDetail, requestedSections: unknown): Record<string, string> {
  const availableSections = detail.sections ?? {};
  const availableIds = Object.keys(availableSections);
  if (availableIds.length === 0) return {};

  const requestedIds = resolveRequestedDumpSectionIds(detail, requestedSections);
  const selectedIds = requestedIds.length > 0 ? requestedIds : pickDefaultDumpSectionIds(detail);
  const finalIds = selectedIds.length > 0 ? selectedIds : availableIds.slice(0, 5);

  return Object.fromEntries(finalIds.map((id) => [id, availableSections[id] ?? '']));
}

function resolveRequestedDumpSectionIds(detail: DumpDetail, requestedSections: unknown): string[] {
  if (!Array.isArray(requestedSections)) return [];
  const availableIds = new Set(Object.keys(detail.sections ?? {}));
  const resolved = requestedSections
    .map((entry) => resolveDumpSectionId(detail, String(entry ?? '')))
    .filter((entry): entry is string => typeof entry === 'string' && availableIds.has(entry));
  return Array.from(new Set(resolved));
}

function resolveDumpSectionId(detail: DumpDetail, candidate: string): string | undefined {
  const normalizedCandidate = normalizeDumpSectionKey(candidate);
  if (!normalizedCandidate) return undefined;

  const direct = detail.chapters.find((chapter) => normalizeDumpSectionKey(chapter.name) === normalizedCandidate)?.name;
  if (direct) return direct;

  const exactTitle = detail.chapters.find(
    (chapter) => normalizeDumpSectionKey(chapter.title) === normalizedCandidate,
  )?.name;
  if (exactTitle) return exactTitle;

  const fuzzyTitle = detail.chapters.find((chapter) =>
    normalizeDumpSectionKey(chapter.title).includes(normalizedCandidate),
  )?.name;
  return fuzzyTitle;
}

function pickDefaultDumpSectionIds(detail: DumpDetail): string[] {
  const wanted = ['short text', 'what happened', 'error analysis', 'source code extract', 'active calls', 'call stack'];
  const selected: string[] = [];

  for (const pattern of wanted) {
    const found = detail.chapters.find(
      (chapter) => normalizeDumpSectionKey(chapter.title).includes(normalizeDumpSectionKey(pattern)) && chapter.name,
    );
    if (found?.name && !selected.includes(found.name) && detail.sections[found.name]) {
      selected.push(found.name);
    }
  }

  if (selected.length > 0) return selected;

  const ordered = [...detail.chapters]
    .sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.chapterOrder - b.chapterOrder;
    })
    .map((chapter) => chapter.name)
    .filter((name) => Boolean(name) && Boolean(detail.sections[name]));
  return Array.from(new Set(ordered)).slice(0, 5);
}

function normalizeDumpSectionKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
