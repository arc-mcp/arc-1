/**
 * Research probes: observations against the ARC-1 source checkout supplied as argv[2].
 * Run from that checkout with a supported Node and installed dependencies:
 *   node --import tsx /path/to/arc1-transport-diff-probes.mts "$PWD"
 * Calls pure functions and mocked clients only; makes no SAP/network requests.
 * These are observations, not a replacement for regression assertions.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Usage: node --import tsx /path/to/arc1-transport-diff-probes.mts /absolute/path/to/arc-1');
const repository = resolve(process.argv[2]);
const loadSource = (relativePath) => import(pathToFileURL(resolve(repository, relativePath)).href);
const { baselineStatusFor, selectTransportRevisionPair, diffTransportObject, rollupTransportObjects } = await loadSource('src/adt/transport-diff.ts');
const { AdtApiError } = await loadSource('src/adt/errors.ts');
const { parseRevisionFeed } = await loadSource('src/adt/xml-parser.ts');

const tr = 'DEVK900002';
const rev = (id, timestamp, transport, part='main') => ({ id, timestamp, transport, author:'DEMO', uri:`/sap/bc/adt/oo/classes/zcl_demo/includes/${part}/versions/20261017090000/${id}/content` });
const ids = new Set([tr]);
const obj = (type='CLAS', components=[]) => ({pgmid:'R3TR', type, name:'ZCL_DEMO', description:'', taskIds:[tr], components});
const records = [];
function record(caseName, evidence) { records.push({caseName, evidence}); }

const undatedActive = [rev('00002','2026-10-16T12:00:00Z','DEVK900001'), rev('00000','',tr)];
const p = selectTransportRevisionPair(undatedActive, ids);
record('undated matching active despite known released history', {current:p.current?.id, previous:p.previous?.id ?? null, baseline:baselineStatusFor(p, undatedActive)});

const draft = [rev('99999','2026-10-17T12:00:00Z',tr), rev('00000','2026-10-17T11:00:00Z',tr), rev('00001','2026-10-16T12:00:00Z','DEVK900001')];
const dp = selectTransportRevisionPair(draft, ids);
record('newer inactive draft competes with active source', {current:dp.current?.id, previous:dp.previous?.id, baseline:baselineStatusFor(dp,draft)});

const client = {
  async getRevisions(type, name, {include}={}) {
    const part=include ?? 'main';
    if(part==='main') return {revisions:[rev('00002','2026-10-17T12:00:00Z',tr,part),rev('00001','2026-10-16T12:00:00Z','DEVK900001',part)]};
    if(part==='implementations') return {revisions:[rev('00002','2026-10-17T12:00:00Z',undefined,part),rev('00001','2026-10-16T12:00:00Z',undefined,part)]};
    throw new AdtApiError('Not found',404,'/sap/bc/adt/demo');
  },
  async getRevisionSource(uri) { return uri.includes('/00002/') ? 'WRITE: / 2.\n' : 'WRITE: / 1.\n'; }
};
const whole = await diffTransportObject(client, obj('CLAS',[{pgmid:'R3TR',type:'CLAS',name:'ZCL_DEMO',wbtype:'CLAS/OC',taskId:tr}]), ids);
record('whole class with unattributed changed sibling and three missing feeds', whole);

const mixed = {...client, async getRevisions(type,name,{include}={}) { if(include!=='main') throw new AdtApiError('Not found',404,'/sap/bc/adt/demo'); return client.getRevisions(type,name,{include}); }};
const comp = ['METH','CINC'].map(type=>({pgmid:'LIMU',type,name:'ZCL_DEMO'.padEnd(30,type==='CINC'?'=':' ')+(type==='CINC'?'CCIMP':'METHOD'),wbtype:type==='METH'?'CLAS/OM':'CLAS/OC',taskId:tr}));
record('CTS-selected include returns 404 while main succeeds', await diffTransportObject(mixed,obj('CLAS',comp),ids));

const textOnly = rollupTransportObjects([{id:tr,objects:[{pgmid:'LIMU',type:'REPT',name:'ZDEMO',wbtype:'PROG/P',description:'Text change',locked:true,position:'1'}]}])[0];
const textClient = {...client, async getRevisionSource(){return 'REPORT zdemo.\nWRITE text-001.\n';}};
record('text-pool-only transport with identical source', await diffTransportObject(textClient,textOnly,ids));

const longClient = {...client, async getRevisionSource(uri){return uri.includes('/00002/') ? 'x'.repeat(300000)+'\n' : '';}};
const longResult=await diffTransportObject(longClient,obj('PROG'),ids);
record('one huge changed line bypasses line cap', {diffCharacters:longResult.parts[0].diff.length, diffTruncated:longResult.parts[0].diffTruncated ?? false});

const pagedXml='<feed xmlns="http://www.w3.org/2005/Atom"><title>Version List of ZDEMO (PROG)</title><link rel="next" href="/sap/bc/adt/demo?page=2"/><entry><id>00003</id><updated>2026-10-17T12:00:00Z</updated><content type="text/plain" src="/sap/bc/adt/demo/versions/20261017120000/00003/content"/></entry></feed>';
record('revision parser ignores continuation metadata',parseRevisionFeed(pagedXml));

const taggedXml='<feed xmlns="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core"><title>Version List of ZDEMO (PROG)</title>'+[
  ['00003','2026-10-17T12:00:00Z',tr,false],
  ['00002','2026-10-16T12:00:00Z','DEVK900099',true],
  ['00001','2026-10-15T12:00:00Z','DEVK900001',false]
].map(([id,ts,transport,test])=>`<entry adtcore:isTestTransport="${test}"><id>${id}</id><updated>${ts}</updated><link rel="http://www.sap.com/adt/relations/transport/request" adtcore:name="${transport}" href="/sap/bc/adt/cts/transportrequests/${transport}"/><content type="text/plain" src="/sap/bc/adt/demo/versions/20261017120000/${id}/content"/></entry>`).join('')+'</feed>';
const taggedFeed=parseRevisionFeed(taggedXml).revisions;
const taggedPair=selectTransportRevisionPair(taggedFeed,ids);
record('test-transport attribute is discarded and intervening snapshot becomes baseline',{parsedTestEntry:taggedFeed[1],current:taggedPair.current?.id,previous:taggedPair.previous?.id});

console.log(JSON.stringify({referenceBaseline:'9775645400fdb27f37aff486f14fe9845ecf8639',sourceRepository:repository,method:'Synthetic inputs against unmodified source; no SAP calls',records},null,2));
