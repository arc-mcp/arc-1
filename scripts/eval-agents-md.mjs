#!/usr/bin/env node
/**
 * Before/after check for edits to AGENTS.md (discussion #1206): does an agent still find the right
 * files and the main pitfall after the file was shortened?
 *
 * Asks the same routing questions in two checkouts — a baseline ref and the working tree — through
 * `claude -p` with read-only tools, and scores each answer by plain pattern matching.
 *
 *   node scripts/eval-agents-md.mjs [--base main] [--runs 1] [--model haiku]
 *
 * Needs the `claude` CLI, logged in. Not part of CI: answers vary between runs, so compare totals
 * over several runs, not single questions. Exits 1 when the working tree scores more than 5 points
 * below the baseline.
 */

import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `expect`: case-insensitive patterns; the score is the share found in the answer. The first
// pattern is the file, the rest the pitfall. Most need the dev guide; the last two need its fine print.
const QUESTIONS = [
  ['let SAPWrite edit the text symbols of a function group', ['text-elements', 'activat']],
  ['fix SAPTransport release hanging in SAP', ['transport\\.ts', 'inactive']],
  ['add a field to the TTYP (table type) update', ['ddic-xml', 'row ?type']],
  ['SAPDiagnose atc reports incomplete results', ['atc\\.ts', 'variant|FINDING_STATS']],
  ['change package creation on the BTP ABAP Environment', ['manage\\.ts|ddic-xml', 'responsible|internal']],
  ['add a write action to pinned multi-target routes', ['multi-target-write-surface', '0011']],
  ['change how SAPDiagnose switches the ST05 SQL trace', ['diagnostics\\.ts', 'instance']],
  ['change how W3C trace headers are forwarded to SAP', ['trace-context', 'originat|verbatim|pass-through']],
  ['a created data element (DTEL) loses its labels', ['ddic-xml|metadata-update', 'PUT']],
  ['add an optional boolean parameter to SAPRead', ['schemas\\.ts', 'tools\\.ts', 'looseOptionalBoolean|coerce']],
  ['add a read operation for a new DDIC object type', ['client\\.ts', 'read\\.ts', 'checkOperation|safety']],
  ['write a unit test that starts the HTTP server', ['supertest-loopback', '127\\.0\\.0\\.1|address family|IPv']],
  ['annotate the release notes for the next release', ['release-notes\\.md', 'CHANGELOG']],
  ['an abapGit link call answers 406', ['abapgit\\.ts', 'Accept|transformation']],
  ['edit a class-local test class method with edit_method', ['class-surgery', 'ltc_|testclasses']],
  // Everyday tasks that need nothing beyond AGENTS.md itself.
  ['add a new safety config option', ['safety\\.ts', 'config\\.ts|types\\.ts']],
  ['add a new audit event type', ['audit\\.ts', 'emitAudit|sinks']],
  ['add a CLI sub-command', ['cli\\.ts', 'handleToolCall|Zod']],
  ['require a scope for a new tool action', ['policy\\.ts', 'ACTION_POLICY']],
  ['log a debug message from a handler', ['logger', 'stderr|stdout']],
  ['add an instance field to AdtClient', ['client\\.ts', 'withSafety|#private']],
  ['add an integration test that creates an SAP object', ['integration', 'generateUniqueName|requireOrSkip']],
  ['bump the package version for a release', ['release-please|version\\.ts', 'by hand|never|feat|fix']],
  ['create a function-group include: which Content-Type does the POST need', ['fincludes\\.v2']],
  ['find the ADT-native reader for SQL trace records, for a follow-up', ['crosstrace']],
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'main');
const runs = Number(arg('runs', '1'));
const model = arg('model', 'haiku');

function ask(cwd, task) {
  const prompt = `You are about to work on this task in this repository: ${task}. Change nothing. Reply briefly with (1) the source files you would open first and (2) the main pitfall to avoid.`;
  const args = ['-p', prompt, '--model', model, '--setting-sources', 'project', '--strict-mcp-config'];
  args.push('--tools', 'Read', 'Grep', 'Glob', '--allowedTools', 'Read', 'Grep', 'Glob');
  args.push('--no-session-persistence', '--output-format', 'json');
  return new Promise((resolve) => {
    const child = execFile('claude', args, { cwd, maxBuffer: 16 << 20, timeout: 300_000 }, (err, stdout) => {
      try {
        const out = JSON.parse(stdout);
        const u = out.usage ?? {};
        const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        resolve({ text: out.result ?? '', tokens, turns: out.num_turns ?? 0 });
      } catch {
        resolve({ text: '', tokens: 0, turns: 0, failed: String(err ?? 'unparseable output') });
      }
    });
    child.stdin?.end();
  });
}

const score = (text, expect) => expect.filter((p) => new RegExp(p, 'i').test(text)).length / expect.length;

async function runArm(cwd) {
  const jobs = QUESTIONS.flatMap((q) => Array.from({ length: runs }, () => q));
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const [task, expect] = jobs[i];
      const r = await ask(cwd, task);
      results[i] = { task, score: score(r.text, expect), ...r };
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return results;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const summary = (rs) => ({
  score: Math.round(mean(rs.map((r) => r.score)) * 100),
  tokens: Math.round(mean(rs.map((r) => r.tokens))),
  turns: mean(rs.map((r) => r.turns)).toFixed(1),
  failed: rs.filter((r) => r.failed).length,
});

const baseDir = mkdtempSync(join(tmpdir(), 'agents-md-base-'));
execFileSync('git', ['worktree', 'add', '--detach', baseDir, base], { stdio: 'ignore' });
try {
  const [before, after] = await Promise.all([runArm(baseDir), runArm(process.cwd())]);
  for (const [task] of QUESTIONS) {
    const pct = (rs) => Math.round(mean(rs.filter((r) => r.task === task).map((r) => r.score)) * 100);
    console.log(`${String(pct(before)).padStart(4)}% →${String(pct(after)).padStart(4)}%  ${task}`);
  }
  const b = summary(before);
  const a = summary(after);
  console.log(`\nbase (${base}):   score ${b.score}%, ${b.tokens} context tokens and ${b.turns} turns per question, ${b.failed} failed`);
  console.log(`working tree: score ${a.score}%, ${a.tokens} context tokens and ${a.turns} turns per question, ${a.failed} failed`);
  process.exitCode = a.score < b.score - 5 ? 1 : 0;
} finally {
  execFileSync('git', ['worktree', 'remove', '--force', baseDir], { stdio: 'ignore' });
}
