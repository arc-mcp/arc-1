#!/usr/bin/env node
/**
 * Before/after smoke check for edits to AGENTS.md (discussion #1206): does an agent still name the
 * right files and the main pitfall after the file was shortened?
 *
 * Asks the same routing questions in two throwaway checkouts — a baseline commit and HEAD plus the
 * uncommitted changes — through `claude -p` with read-only tools and project hooks disabled, and
 * scores each answer by keyword patterns.
 *
 *   node scripts/eval-agents-md.mjs [--base <ref>] [--runs 3] [--model haiku]
 *
 * `--base` defaults to the merge base with origin/main. Needs a logged-in `claude` CLI. Not part of CI.
 *
 * What it does not show: keyword matching cannot tell a correct instruction from a wrong one that
 * uses the same words, the questions were picked by hand, and answers vary between runs. Treat the
 * totals as a routing regression signal over several runs, never as proof that coding quality held.
 * Exits 1 when the candidate scores more than 5 points below the baseline, 2 when a run is invalid.
 */

import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// [task, patterns]: case-insensitive; the score is the share found in the answer. The first pattern
// is the file, the rest the pitfall. This file is deleted from both checkouts before the run.
const QUESTIONS = [
  // Feature tasks: the detail lives in docs/dev-guide.md.
  ['let SAPWrite edit the text symbols of a function group', ['text-elements', 'activat']],
  ['fix SAPTransport release hanging in SAP', ['transport\\.ts', 'inactive']],
  ['add a field to the TTYP (table type) update', ['ddic-xml', 'row ?type']],
  ['SAPDiagnose atc reports incomplete results', ['atc\\.ts', 'variant|FINDING_STATS']],
  ['change package creation on the BTP ABAP Environment', ['manage\\.ts|ddic-xml', 'responsible|internal']],
  ['add a write action to pinned multi-target routes', ['multi-target-write-surface', '0011']],
  ['change how SAPDiagnose switches the ST05 SQL trace', ['diagnostics\\.ts', 'instance']],
  ['change how W3C trace headers are forwarded to SAP', ['trace-context', 'originat|verbatim|pass-through']],
  ['a created data element (DTEL) loses its labels', ['ddic-xml|metadata-update', 'PUT']],
  ['an abapGit link call answers 406', ['abapgit\\.ts', 'Accept|transformation']],
  ['edit a class-local test class method with edit_method', ['class-surgery', 'ltc_|testclasses']],
  ['create a function-group include: which Content-Type does the POST need', ['fincludes\\.v2']],
  ['find the ADT-native reader for SQL trace records, for a follow-up', ['crosstrace']],
  // Everyday tasks: AGENTS.md alone should be enough.
  ['add an optional boolean parameter to SAPRead', ['schemas\\.ts', 'tools\\.ts', 'looseOptionalBoolean']],
  ['add a read operation for a new DDIC object type', ['client\\.ts', 'read\\.ts', 'checkOperation|safety']],
  ['annotate the release notes for the next release', ['release-notes\\.md', 'CHANGELOG']],
  ['add a new safety config option', ['safety\\.ts', 'config\\.ts|types\\.ts']],
  ['add a new audit event type', ['audit\\.ts', 'emitAudit|sinks']],
  ['add a CLI sub-command', ['cli\\.ts', 'handleToolCall|Zod']],
  ['require a scope for a new tool action', ['policy\\.ts', 'ACTION_POLICY']],
  ['log a debug message from a handler', ['logger', 'stderr']],
  ['add an instance field to AdtClient', ['client\\.ts', 'withSafety|#private']],
  ['add an integration test that creates an SAP object', ['integration', 'generateUniqueName|requireOrSkip']],
  ['bump the package version for a release', ['release-please', 'never|not by hand|automatic']],
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const die = (message) => {
  console.error(`eval-agents-md: ${message}`);
  process.exit(2);
};

const runs = Number(arg('runs', '3'));
if (!Number.isInteger(runs) || runs < 1 || runs > 10) die('--runs must be an integer from 1 to 10');
const model = arg('model', 'haiku');
let baseSha;
try {
  baseSha = git('rev-parse', '--verify', `${arg('base', git('merge-base', 'origin/main', 'HEAD'))}^{commit}`);
} catch {
  die('cannot resolve the baseline; pass --base <ref>');
}
const headSha = git('rev-parse', 'HEAD');
const changed = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);

const owned = [];
const children = new Set();
function cleanup() {
  for (const child of children) child.kill();
  for (const dir of owned.splice(0)) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' });
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

function checkout(sha) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-md-eval-'));
  owned.push(dir);
  execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { stdio: 'ignore' });
  return dir;
}

function ask(cwd, task) {
  const prompt = `You are about to work on this task in this repository: ${task}. Change nothing. Reply briefly with (1) the source files you would open first and (2) the main pitfall to avoid.`;
  const args = ['-p', prompt, '--model', model, '--setting-sources', 'project', '--strict-mcp-config'];
  args.push('--settings', '{"disableAllHooks":true}');
  args.push('--tools', 'Read', 'Grep', 'Glob', '--allowedTools', 'Read', 'Grep', 'Glob');
  args.push('--no-session-persistence', '--output-format', 'json');
  return new Promise((resolve) => {
    const child = execFile('claude', args, { cwd, maxBuffer: 16 << 20, timeout: 300_000 }, (err, stdout) => {
      children.delete(child);
      let out;
      try {
        out = JSON.parse(stdout);
      } catch {
        return resolve({ failed: String(err ?? 'unparseable output') });
      }
      if (err || out.is_error || !out.result) return resolve({ failed: String(err ?? out.result ?? 'empty answer') });
      const u = out.usage ?? {};
      const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      resolve({ text: out.result, tokens, turns: out.num_turns ?? 0 });
    });
    children.add(child);
    child.stdin?.end();
  });
}

const score = (text, expect) => expect.filter((p) => new RegExp(p, 'i').test(text)).length / expect.length;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

try {
  const baseDir = checkout(baseSha);
  const headDir = checkout(headSha);
  for (const line of changed) {
    const file = line.slice(3).replace(/^.* -> /, '');
    if (existsSync(file)) {
      cpSync(file, join(headDir, file), { recursive: true });
    } else {
      rmSync(join(headDir, file), { recursive: true, force: true });
    }
  }
  // Neither arm may find the expected answers by searching the checkout.
  for (const dir of [baseDir, headDir]) rmSync(join(dir, 'scripts', 'eval-agents-md.mjs'), { force: true });

  const jobs = [];
  for (const [arm, cwd] of [['base', baseDir], ['head', headDir]]) {
    for (const [task, expect] of QUESTIONS) for (let r = 0; r < runs; r++) jobs.push({ arm, cwd, task, expect });
  }
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      Object.assign(job, await ask(job.cwd, job.task));
      if (!job.failed) job.score = score(job.text, job.expect);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker)); // one limit shared by both arms

  const failed = jobs.filter((j) => j.failed);
  if (failed.length > 0) {
    console.error(`eval-agents-md: ${failed.length} of ${jobs.length} calls failed, first: ${failed[0].failed}`);
    process.exitCode = 2;
  } else {
    const of = (arm, task) => jobs.filter((j) => j.arm === arm && (!task || j.task === task));
    const pct = (js) => Math.round(mean(js.map((j) => j.score)) * 100);
    for (const [task] of QUESTIONS) {
      console.log(`${String(pct(of('base', task))).padStart(4)}% →${String(pct(of('head', task))).padStart(4)}%  ${task}`);
    }
    const line = (arm) =>
      `score ${(mean(of(arm).map((j) => j.score)) * 100).toFixed(1)}%, ${Math.round(mean(of(arm).map((j) => j.tokens)))} context tokens and ${mean(of(arm).map((j) => j.turns)).toFixed(1)} turns per question`;
    console.log(`\nmodel ${model}, ${runs} runs per question`);
    console.log(`base ${baseSha.slice(0, 9)}: ${line('base')}`);
    console.log(`head ${headSha.slice(0, 9)}${changed.length > 0 ? ' + uncommitted changes' : ''}: ${line('head')}`);
    process.exitCode = mean(of('head').map((j) => j.score)) < mean(of('base').map((j) => j.score)) - 0.05 ? 1 : 0;
  }
} finally {
  cleanup();
}
