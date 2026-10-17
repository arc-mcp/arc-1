import { readFileSync } from 'node:fs';
import { mockResponse } from '../../helpers/mock-fetch.js';

const schema = readFileSync(new URL('../../fixtures/xml/dumps-schema-758.xml', import.meta.url), 'utf8');
const stamp = (value: string) => value.replace(/[-:T]/g, '').slice(0, 14);
const dumps = Array.from({ length: 120 }, (_, i) => ({
  id: `D${String(i).padStart(3, '0')}`,
  date: new Date(Date.UTC(2026, 9, 17, 12, 0, 0) - i * 60_000).toISOString(),
  error: [79, 113].includes(i) ? 'TIME_OUT' : 'RAISE_EXCEPTION',
}));

// Only flat AND terms from the advertised schema are needed by these tasks.
function queryPredicates(query: string) {
  if (!query) return [];
  const terms = [...query.matchAll(/([a-zA-Z]+)\(([^()]*)\)/g)];
  if (`and(${terms.map((t) => t[0]).join(',')})` !== query) throw new Error('Unmodeled query shape');
  return terms.map((term) => {
    const operator = term[1]!;
    const [attribute, ...values] = term[2]!.split(',');
    if (!['runtimeError', 'datetime', 'user'].includes(attribute!)) throw new Error('Unmodeled attribute');
    if (
      ![
        'equals',
        'notEquals',
        'contains',
        'notContains',
        'between',
        'greaterOrEquals',
        'lessOrEquals',
        'greater',
        'less',
      ].includes(operator)
    )
      throw new Error('Unmodeled operator');
    if (values.some((v) => /[*?]/.test(v))) throw new Error('Unmodeled wildcard semantics');
    return (dump: (typeof dumps)[number]) => {
      const value =
        attribute === 'runtimeError' ? dump.error : attribute === 'datetime' ? stamp(dump.date) : 'EVAL_USER';
      const expected = values[0]!;
      switch (operator) {
        case 'equals':
          return value === expected;
        case 'notEquals':
          return value !== expected;
        case 'contains':
          return value.includes(expected);
        case 'notContains':
          return !value.includes(expected);
        case 'between':
          return value >= expected && value <= values[1]!;
        case 'greaterOrEquals':
          return value >= expected;
        case 'lessOrEquals':
          return value <= expected;
        case 'greater':
          return value > expected;
        case 'less':
          return value < expected;
        default:
          return false;
      }
    };
  });
}

/** Offline at the fetch boundary: production dispatch, serialization, parsing and budgets still run. */
export function createWorld(caseId: string) {
  const requests: Array<{ method: string; path: string; body: string; status: number; response: string }> = [];
  const unsupported: string[] = [];
  async function fetch(url: string | URL, options?: RequestInit) {
    const u = new URL(String(url));
    const method = options?.method ?? 'GET';
    const body = String(options?.body ?? '');
    let response = '';
    let status = 200;
    if (new Headers(options?.headers).get('x-csrf-token')?.toLowerCase() === 'fetch') {
      response = '<service/>';
    } else if (
      /^\/sap\/bc\/adt\/programs\/programs\/ZEVAL_[ABCD](\/source\/main)?$/i.test(u.pathname) &&
      method === 'GET'
    ) {
      const name = u.pathname.match(/ZEVAL_[ABCD]/i)![0].toUpperCase();
      if (u.searchParams.get('version') === 'inactive') {
        status = 404;
        response = 'No inactive source in this fixture.';
      } else
        response = u.pathname.endsWith('/source/main')
          ? `REPORT ${name.toLowerCase()}.\n${name === 'ZEVAL_B' ? 'WRITE totalx.' : "WRITE / 'Hello'."}`
          : `<program name="${name}" type="PROG/P"><packageRef name="$TMP"/></program>`;
    } else if (u.pathname === '/sap/bc/adt/repository/informationsystem/search' && method === 'GET') {
      const query = (u.searchParams.get('query') ?? '').toUpperCase();
      const matches = ['A', 'B', 'C', 'D']
        .map((letter) => `ZEVAL_${letter}`)
        .filter((name) =>
          new RegExp(
            `^${query
              .split('*')
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('.*')}$`,
          ).test(name),
        );
      response = `<objectReferences>${matches.map((name) => `<objectReference name="${name}" type="PROG/P" uri="/sap/bc/adt/programs/programs/${name}"/>`).join('')}</objectReferences>`;
    } else if (u.pathname === '/sap/bc/adt/checkruns' && body.includes('<chkrun:artifacts>')) {
      unsupported.push('Syntax with supplied source is not modeled by these stored-source tasks.');
      status = 400;
      response = 'Supplied-source syntax response not modeled; do not infer an SAP verdict.';
    } else if (u.pathname === '/sap/bc/adt/checkruns' && method === 'POST') {
      const uris = [...body.matchAll(/adtcore:uri="([^"]+)"/g)].map((match) => match[1]!);
      response = `<checkRunReports>${uris
        .map((uri) => {
          const name = uri.split('/').at(-1)!.toUpperCase();
          if (!/^\/sap\/bc\/adt\/programs\/programs\/ZEVAL_[ABCD]$/i.test(uri))
            return `<checkReport reporter="abapCheckRun" triggeringUri="${uri}" status="notProcessed"><checkMessage type="E" shortText="Resource does not exist."/></checkReport>`;
          if (caseId === 'syntax-missing' && name === 'ZEVAL_D') return '';
          if (!/^ZEVAL_[ABCD]$/.test(name)) return '';
          const message = name === 'ZEVAL_B' ? '<checkMessage type="E" shortText="Unknown field TOTALX."/>' : '';
          return `<checkReport reporter="abapCheckRun" triggeringUri="${uri}" status="processed">${message}</checkReport>`;
        })
        .join('')}</checkRunReports>`;
    } else if (u.pathname === '/sap/bc/adt/feeds' && method === 'GET') {
      response = schema;
    } else if (u.pathname === '/sap/bc/adt/runtime/dumps' && method === 'GET') {
      const query = u.searchParams.get('$query') ?? '';
      let predicates: ReturnType<typeof queryPredicates> = [];
      try {
        predicates = queryPredicates(query);
      } catch {
        unsupported.push(`${u.pathname}?${u.searchParams}`);
        status = 400;
      }
      const from = u.searchParams.get('from') ?? '';
      const to = u.searchParams.get('to') ?? '99999999999999';
      const rows = dumps
        .filter((d) => stamp(d.date) >= from && stamp(d.date) <= to && predicates.every((matches) => matches(d)))
        .slice(0, Math.min(100, Number(u.searchParams.get('$top') ?? 50)));
      response = `<feed>${rows.map((d) => `<entry><id>/sap/bc/adt/runtime/dumps/${d.id}</id><published>${d.date}</published><author><name>EVAL_USER</name></author><category label="Runtime Error" term="${d.error}"/><category label="Program" term="ZEVAL_JOB"/></entry>`).join('')}</feed>`;
    } else if (/^\/sap\/bc\/adt\/runtime\/dump\/D\d{3}(\/formatted)?$/.test(u.pathname) && method === 'GET') {
      const id = u.pathname.match(/D\d{3}/)![0];
      const dump = dumps.find((d) => d.id === id);
      if (!dump) {
        status = 404;
        response = 'Dump does not exist.';
      } else
        response = u.pathname.endsWith('/formatted')
          ? `Runtime Error: ${dump.error}\nProgram: ZEVAL_JOB\nDate: ${dump.date}`
          : `<dump error="${dump.error}" author="EVAL_USER" terminatedProgram="ZEVAL_JOB" datetime="${stamp(dump.date)}"/>`;
    } else if (u.pathname.toLowerCase() === '/sap/bc/adt/ddic/domains/zeval_domain' && method === 'GET') {
      const link =
        caseId === 'log-unsupported'
          ? ''
          : '<link rel="http://www.sap.com/adt/relations/ddic/activationlog" type="application/vnd.sap.adt.logs+xml" href="/sap/bc/adt/ddic/logs/db/ACTDOMAZEVAL_DOMAIN"/>';
      response = `<domain name="ZEVAL_DOMAIN">${link}<description>Evaluation domain</description></domain>`;
    } else if (u.pathname === '/sap/bc/adt/ddic/logs/db/ACTDOMAZEVAL_DOMAIN' && method === 'GET') {
      response =
        '<log><name>ZEVAL_DOMAIN</name><type>DOMA</type><entry severity="error"><message><messageText>Fixed value range overlaps at value 42.</messageText></message></entry></log>';
    } else {
      unsupported.push(`${method} ${u.pathname}`);
      status = 404;
      response = 'Endpoint not modeled by this offline evaluation; do not infer SAP availability.';
    }
    requests.push({ method, path: `${u.pathname}${u.search}`, body, status, response });
    return mockResponse(status, response, { 'x-csrf-token': 'offline-token' });
  }
  return { fetch, requests, unsupported };
}
