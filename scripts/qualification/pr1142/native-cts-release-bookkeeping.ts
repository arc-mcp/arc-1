/** V5-only inert release-comment proof. No repository/package authority or native mutation. */
import { createHash } from 'node:crypto';
import { type NativeXmlElement, nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import type { CtsTree } from '../../../src/adt/pinned-cts-evidence.js';
import { assertCtsOwnedTree } from './native-cts-evidence.js';
import { CTS_BASE, type CtsGraph, type CtsOwnedRequest, type CtsStep } from './native-cts-fixtures.js';

const TM = 'http://www.sap.com/cts/adt/tm',
  CORE = 'http://www.sap.com/adt/core',
  ATOM = 'http://www.w3.org/2005/Atom';
const CHECK = 'http://www.sap.com/adt/checkrun';
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
export interface CtsReleaseWitness {
  parent: string;
  task: string;
  timestamp: string;
  reportTimestamp: string;
  reportHash: string;
  taskHash: string;
  maxNativeSeconds: number;
}
export const CTS_A_RELEASE_WITNESS: Readonly<CtsReleaseWitness> = Object.freeze({
  parent: 'A4HK906607',
  task: 'A4HK906608',
  timestamp: '20261105014315',
  reportTimestamp: '20261105014314 ',
  reportHash: '612e2aa6c6d171efedc1d89efd7905053b667027e6108675605364720f3c6469',
  taskHash: 'ef4429efdbb5e696487aa57af58eb06b1510fcbfe090c254c2ead601084af1e1',
  maxNativeSeconds: 240,
});
export function nativeCtsTime(value: string): number {
  if (!/^\d{14}$/.test(value) || value.startsWith('0000')) throw Error('Invalid native release timestamp.');
  const parts = [
    value.slice(0, 4),
    value.slice(4, 6),
    value.slice(6, 8),
    value.slice(8, 10),
    value.slice(10, 12),
    value.slice(12, 14),
  ].map(Number);
  const d = new Date(0);
  d.setUTCFullYear(parts[0]!, parts[1]! - 1, parts[2]!);
  d.setUTCHours(parts[3]!, parts[4]!, parts[5]!, 0);
  if (
    [
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
    ].some((x, i) => x !== parts[i])
  )
    throw Error('Invalid native release calendar.');
  return d.getTime();
}
function validateWitness(w: CtsReleaseWitness) {
  if (
    JSON.stringify(Object.keys(w).sort()) !==
    JSON.stringify(
      ['parent', 'task', 'timestamp', 'reportTimestamp', 'reportHash', 'taskHash', 'maxNativeSeconds'].sort(),
    )
  )
    throw Error('Unknown release witness shape.');
  if (
    !/^A4HK\d{6}$/.test(w.parent) ||
    !/^A4HK\d{6}$/.test(w.task) ||
    w.parent === w.task ||
    !/^\d{14} ?$/.test(w.reportTimestamp) ||
    !Number.isInteger(w.maxNativeSeconds) ||
    w.maxNativeSeconds < 1 ||
    w.maxNativeSeconds > 240 ||
    ![w.reportHash, w.taskHash].every((x) => /^[a-f0-9]{64}$/.test(x))
  )
    throw Error('Invalid owned release witness.');
  const delta = nativeCtsTime(w.timestamp) - nativeCtsTime(w.reportTimestamp.slice(0, 14));
  if (delta < 0 || delta > w.maxNativeSeconds * 1000) throw Error('Native release chronology outside bounded attempt.');
}
export const releaseCommentName = (w: CtsReleaseWitness) =>
  `${w.task} ${w.timestamp.slice(0, 8)} ${w.timestamp.slice(8)} MARIAN`;
function expectedComment(w: CtsReleaseWitness, released = false) {
  const name = releaseCommentName(w);
  return nativeXmlRoot(
    `<t:abap_object xmlns:t="${TM}" xmlns:a="${ATOM}" t:pgmid="CORR" t:type="RELE" t:name="${name}" t:dummy_uri="${CTS_BASE}reference?obj_name=${encodeURIComponent(name)}&amp;obj_wbtype=RELE&amp;pgmid=CORR" t:obj_info="Comment Entry: Released" t:position="000001" t:lock_status="" t:img_activity="">${(released
      ? []
      : [
          ['removeobject', '', 'Transport Organizer Remove Locked Object'],
          ['lockobject', '/lockobject', 'Transport Request Editor Lock Objects'],
          ['moveobjects', '/moveobjects', 'Transport Organizer Move Objects'],
        ]
    )
      .map(
        ([rel, suffix, title]) =>
          `<a:link href="${CTS_BASE}${w.parent}${suffix}" rel="http://www.sap.com/cts/relations/${rel}" type="application/xml" title="${title}"/>`,
      )
      .join('')}</t:abap_object>`,
    'abap_object',
    TM,
    true,
  ).canonicalValue({});
}
const taskElement = (root: NativeXmlElement) => {
  const request = root.child('request', TM);
  const tasks = [...(request?.children('task', TM) ?? []), ...root.children('task', TM)];
  if (tasks.length > 1) throw Error('Ambiguous own task view.');
  return tasks[0];
};
export class CtsReleaseBookkeeping {
  private readonly proofs = new Map<string, CtsReleaseWitness>();
  private readonly pending = new Map<
    string,
    { parent: string; maxNativeSeconds: number; reportTimestamp?: string; reportHash?: string }
  >();
  constructor(
    private readonly graph: CtsGraph,
    prior: readonly CtsReleaseWitness[] = [],
    owners: readonly CtsOwnedRequest[] = [],
    private readonly commentMode: 'modifiable-parent' | 'native-parent-state' = 'modifiable-parent',
  ) {
    if (prior.length > 2 || new Set(prior.map((w) => w.task)).size !== prior.length)
      throw Error('Bounded distinct release proof required.');
    for (const w of [CTS_A_RELEASE_WITNESS, ...prior]) {
      validateWitness(w);
      if (
        w.task !== CTS_A_RELEASE_WITNESS.task &&
        !owners.some((o) => o.round === 'B' && o.parent === w.parent && o.task === w.task)
      )
        throw Error('Release proof outside owned graph.');
      const existing = this.proofs.get(w.task);
      if (existing && JSON.stringify(existing) !== JSON.stringify(w)) throw Error('Release proof changed.');
      this.proofs.set(w.task, Object.freeze({ ...w }));
    }
  }
  witnesses() {
    return [...this.proofs.values()].map((w) => ({ ...w }));
  }
  dispatch(path: string, own: CtsOwnedRequest, step: CtsStep | undefined, deadline: number) {
    if (path !== `${CTS_BASE}${own.task}/newreleasejobs`) return;
    if (own.round !== 'B' || step !== 'release-recursive' || this.pending.has(own.task) || this.proofs.has(own.task))
      throw Error('Task release replay or wrong graph.');
    const maxNativeSeconds = Math.min(240, Math.ceil((deadline - Date.now()) / 1000));
    if (maxNativeSeconds < 1) throw Error('Release deadline elapsed.');
    this.pending.set(own.task, { parent: own.parent, maxNativeSeconds });
  }
  report(body: string, status: number, path: string, own: CtsOwnedRequest) {
    if (path !== `${CTS_BASE}${own.task}/newreleasejobs`) return;
    const pending = this.pending.get(own.task);
    if (!pending || pending.reportHash || status !== 200)
      throw Error('Missing or duplicate task release acknowledgement.');
    const root = nativeXmlRoot(body, 'root', TM, true),
      reports = root.child('releasereports', TM)?.children('checkReport', CHECK) ?? [];
    const timestamp = root.attribute('releasetimestamp', TM);
    if (
      root.attribute('useraction', TM) !== 'newreleasejobs' ||
      root.attribute('number', TM) !== own.task ||
      !timestamp ||
      !/^\d{14} ?$/.test(timestamp) ||
      reports.length !== 1 ||
      reports[0]!.attribute('reporter', CHECK) !== 'transportrelease' ||
      reports[0]!.attribute('triggeringUri', CHECK) !== CTS_BASE + own.task ||
      reports[0]!.attribute('status', CHECK) !== 'released'
    )
      throw Error('Exact acknowledged task release report required.');
    const expected = nativeXmlRoot(
      `<t:root xmlns:t="${TM}" xmlns:a="${ATOM}" xmlns:c="${CHECK}" t:useraction="newreleasejobs" t:releasetimestamp="${timestamp}" t:number="${own.task}"><a:link href="${CTS_BASE}${own.task}/displayatcfindings" rel="http://www.sap.com/cts/relations/displayatcfindings" type="application/xml" title="Diplay ATC Findings"/><t:releasereports><c:checkReport c:reporter="transportrelease" c:triggeringUri="${CTS_BASE}${own.task}" c:status="released" c:statusText="Transport request/task ${own.task} was successfully released"/></t:releasereports></t:root>`,
      'root',
      TM,
      true,
    );
    if (JSON.stringify(root.canonicalValue({})) !== JSON.stringify(expected.canonicalValue({})))
      throw Error('Unqualified release report shape.');
    nativeCtsTime(timestamp.slice(0, 14));
    pending.reportTimestamp = timestamp;
    pending.reportHash = hash(body);
  }
  observe(body: string, path: string, tree: CtsTree, own: CtsOwnedRequest) {
    const root = nativeXmlRoot(body, 'root', TM, true),
      task = taskElement(root),
      node = tree.tasks[0];
    const proof = this.proofs.get(own.task),
      pending = this.pending.get(own.task);
    if (path === CTS_BASE + own.task && node?.status === 'R') {
      const timestamp = task?.attribute('lastchanged_timestamp', TM);
      if (
        root.attribute('object_type', TM) !== 'T' ||
        root.attribute('name', CORE) !== own.task ||
        node.id !== own.task ||
        node.owner !== 'MARIAN' ||
        node.target !== '' ||
        !timestamp
      )
        throw Error('Exact released selected task witness required.');
      nativeCtsTime(timestamp);
      if (proof) {
        if (proof.parent !== own.parent || proof.timestamp !== timestamp) throw Error('Latched task release changed.');
      } else {
        if (own.round !== 'B' || !pending?.reportHash || !pending.reportTimestamp)
          throw Error('Released task without own acknowledgement.');
        const w = {
          parent: own.parent,
          task: own.task,
          timestamp,
          reportTimestamp: pending.reportTimestamp,
          reportHash: pending.reportHash,
          taskHash: hash(body),
          maxNativeSeconds: pending.maxNativeSeconds,
        };
        validateWitness(w);
        this.proofs.set(own.task, Object.freeze(w));
      }
    }
    const w = this.proofs.get(own.task);
    if (w && node && node.status !== 'R') throw Error('Observed released task regressed.');
    if (w && task && task.attribute('lastchanged_timestamp', TM) !== w.timestamp)
      throw Error('Native task release timestamp changed.');
    const parent = root.child('request', TM);
    const comments = parent?.children('abap_object', TM).filter((r) => r.attribute('pgmid', TM) === 'CORR') ?? [];
    if (comments.length) {
      const released = this.commentMode === 'native-parent-state' && tree.parent?.status === 'R';
      if (this.commentMode === 'native-parent-state' && !['D', 'R'].includes(tree.parent?.status ?? ''))
        throw Error('Qualified native parent comment state required.');
      if (
        !w ||
        own.round === 'C' ||
        comments.length !== 1 ||
        path !== CTS_BASE + own.parent ||
        JSON.stringify(comments[0]!.canonicalValue({})) !== JSON.stringify(expectedComment(w, released))
      )
        throw Error('Unproven native release comment.');
      if (root.attribute('object_type', TM) !== 'R' || root.attribute('name', CORE) !== own.parent)
        throw Error('Full parent release view required.');
      if (node?.status !== 'R' && !(node === undefined && ['R', 'N'].includes(tree.parent?.status ?? '')))
        throw Error('Comment lacks current released task proof.');
    }
    if (w && path === CTS_BASE + own.parent && tree.parent && comments.length !== 1)
      throw Error('Released parent comment disappeared.');
    // A direct task view is a projection: it cannot supply, delete or replace parent rows.
    if (w && path === CTS_BASE + own.task && tree.parent?.objects.length)
      throw Error('Ambiguous selected task parent inventory.');
  }
  assertTree(tree: CtsTree, own: CtsOwnedRequest, step?: CtsStep) {
    const w = this.proofs.get(own.task),
      p = tree.parent;
    const comments = p?.objects.filter((r) => r.pgmid === 'CORR') ?? [];
    if (comments.length) {
      const c = comments[0]!;
      if (
        !w ||
        comments.length !== 1 ||
        w.parent !== own.parent ||
        c.type !== 'RELE' ||
        c.name !== releaseCommentName(w) ||
        c.position !== '000001' ||
        !c.lockKnown ||
        c.locked
      )
        throw Error('Unknown bookkeeping ownership.');
    }
    const cleaned = {
      ...tree,
      ...(p ? { parent: { ...p, objects: p.objects.filter((r) => r.pgmid !== 'CORR') } } : {}),
    };
    const rows = assertCtsOwnedTree(cleaned, own, this.graph, step);
    if (w) {
      if (p?.objects.length && (p.objects.length !== 2 || cleaned.parent?.objects[0]?.position !== '000002'))
        throw Error('Released parent record positions changed.');
      if (
        tree.tasks.length &&
        (tree.tasks[0]!.objects.length !== 1 ||
          tree.tasks[0]!.objects[0]!.position !== '000001' ||
          tree.tasks[0]!.objects[0]!.locked)
      )
        throw Error('Released task record/lock changed.');
    }
    return rows;
  }
}
