import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

/** Hook failures can leave all assertions passed/skipped. Require the suite and step to succeed. */
export function summarizeDiagnostic(data, outcome, log) {
  const passed =
    outcome === 'success' &&
    data?.success === true &&
    data.numPassedTests >= 1 &&
    data.numFailedTests === 0 &&
    data.numPendingTests === 0 &&
    data.numTodoTests === 0 &&
    data.numFailedTestSuites === 0;
  const lines = [
    '### Fresh-activation where-used diagnostic (#1057; non-blocking)',
    '',
    `Step outcome: **${outcome}**. ${data ? `Diagnostic ${passed ? 'passed' : 'failed or incomplete'}.` : 'No readable result JSON; execution and cleanup status unknown.'}`,
  ];
  if (stripVTControlCharacters(log).includes('remove every owned where-used fixture: expected'))
    lines.push(
      '**Cleanup failed.** Inspect the log and remove any remaining owned `ZAR1018_ROOT*` / `ZAR1018_USE*` classes manually.',
    );
  else if (data?.success === false && data.numFailedTestSuites > 0 && data.numFailedTests === 0)
    lines.push('**Suite/setup/cleanup failure**, despite no failed test assertions. Inspect the diagnostic log.');
  if (!passed)
    lines.push(
      'Review the diagnostic JSON/log artifacts and check fixture cleanup; do not retry just to obtain a pass.',
    );
  lines.push(
    'Runs in an isolated process after integration; a pass does not establish a fix for #1057 or reproduce its original full-suite context. Required integration results are separate.',
  );
  return { passed, markdown: `${lines.join('\n\n')}\n` };
}

function readOptional(path, json = false) {
  try {
    const value = readFileSync(path, 'utf8');
    return json ? JSON.parse(value) : value;
  } catch {
    return json ? null : '';
  }
}

function main() {
  const result = summarizeDiagnostic(
    readOptional('test-results/where-used-fresh-activation.json', true),
    process.env.DIAGNOSTIC_OUTCOME ?? 'unknown',
    readOptional('test-results/where-used-fresh-activation.log'),
  );
  console.log(result.markdown);
  if (!result.passed)
    console.log(
      '::warning title=Where-used diagnostic needs attention::#1057 diagnostic did not pass. Inspect the separate artifacts and verify cleanup. Required integration remains gating.',
    );
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
