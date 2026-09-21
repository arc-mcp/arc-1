/** CI adapters preserve the existing harmless AUnit source reconciliation. */
import { probePublicAunit } from '../adt/aunit.js';
import { CI_REPORT_XML_LIMIT, runAtcCiCheck, verifyCiPackages } from '../adt/ci-quality.js';
import type { AtcCiSeverity } from '../adt/ci-quality-xml.js';
import type { AdtClient } from '../adt/client.js';
import { getCurrentContext } from '../server/context.js';
import { type ToolResult, textResult, toolJson } from './shared.js';

type RunDiagnose = (
  client: AdtClient,
  args: Record<string, unknown>,
  options?: { deadline?: number; signal?: AbortSignal },
) => Promise<ToolResult>;

export async function handleCiQuality(
  client: AdtClient,
  args: Record<string, unknown>,
  diagnose: RunDiagnose,
): Promise<ToolResult> {
  const objectSet = {
    packages: args.packages as string[] | undefined,
    packageTrees: args.packageTrees as string[] | undefined,
  };
  const signal = getCurrentContext()?.signal;
  const timeoutSeconds = Number(args.timeoutSeconds ?? 600);
  if (args.action === 'atc_ci') {
    return textResult(
      toolJson(
        await runAtcCiCheck(client.http, client.safety, {
          objectSet,
          signal,
          timeoutSeconds,
          variant: args.variant as string | undefined,
          configuration: args.configuration as string | undefined,
          failOnSeverity: args.failOnSeverity as AtcCiSeverity | undefined,
          includeReportXml: args.includeReportXml === true,
        }),
      ),
    );
  }
  const started = Date.now();
  const deadline = started + timeoutSeconds * 1000;
  const requestOptions = { deadline, signal };
  if (!(await probePublicAunit(client.http, client.safety, requestOptions)))
    throw new Error(
      'ABAP Unit CI API is not available on this system. Use SAPDiagnose action="unittest" if supported.',
    );
  const selection = await verifyCiPackages(client.http, client.safety, objectSet, requestOptions);
  const targets = [
    ...selection.packages.map((name) => ({ name, includeSubpackages: false })),
    ...selection.packageTrees.map((name) => ({ name, includeSubpackages: true })),
  ];
  const results: Record<string, unknown>[] = [];
  const summary = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  let incomplete = false;
  let fail = false;
  let reportBytes = 0;
  let stoppedReason: string | undefined;
  for (const target of targets) {
    if (!stoppedReason && (signal?.aborted || Date.now() >= deadline)) {
      incomplete = fail = true;
      stoppedReason = signal?.aborted ? 'cancelled' : 'timeout';
    }
    if (stoppedReason) {
      results.push({ ...target, outcome: 'incomplete', attempted: false, incompleteReason: stoppedReason });
      continue;
    }
    try {
      const result = await diagnose(
        client,
        { action: 'unittest', type: 'DEVC', ...target, resultFormat: 'junit', timeoutSeconds },
        requestOptions,
      );
      if (result.isError) throw new Error('Package ABAP Unit returned a tool error.');
      const payload = JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
      const counts = payload.summary as Record<string, unknown> | undefined;
      if (
        !counts ||
        !Object.keys(summary).every((key) => Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0)
      )
        throw new Error('ABAP Unit CI returned invalid result counters.');
      const outcome = payload.outcome === 'no_tests' ? 'incomplete' : String(payload.outcome);
      if (!['passed', 'failed', 'incomplete'].includes(outcome))
        throw new Error('ABAP Unit CI returned an unknown outcome.');
      for (const key of Object.keys(summary) as (keyof typeof summary)[]) summary[key] += Number(counts[key]);
      const source = payload.sourceSelectionEvidence as Record<string, unknown> | undefined;
      const omitted = Array.isArray(source?.omittedTestClasses) ? source.omittedTestClasses.length : undefined;
      const passing =
        outcome === 'passed' &&
        Number(counts.tests) > Number(counts.skipped) &&
        counts.failures === 0 &&
        counts.errors === 0 &&
        source?.status === 'verified' &&
        omitted === 0;
      fail ||= !passing;
      incomplete ||= outcome === 'incomplete' || (outcome === 'passed' && !passing);
      const row: Record<string, unknown> = {
        ...target,
        outcome: outcome === 'passed' && !passing ? 'incomplete' : outcome,
        summary: counts,
        ...(payload.incompleteReason ? { incompleteReason: payload.incompleteReason } : {}),
        sourceSelection: { status: source?.status ?? 'unavailable', omittedTestClasses: omitted },
        runPath: payload.runPath,
        resultPath: payload.resultPath,
      };
      if (args.includeReportXml === true && typeof payload.junit === 'string') {
        const bytes = Buffer.byteLength(payload.junit);
        if (reportBytes + bytes <= CI_REPORT_XML_LIMIT) {
          row.reportXml = payload.junit;
          reportBytes += bytes;
        } else row.reportXmlOmitted = 'Combined reports exceed 256 KiB.';
      }
      results.push(row);
    } catch {
      // Retain earlier evidence; stop after any tool/protocol failure, including authorization errors.
      // Do not embed raw nested SAP errors (which could bypass minimal-errors redaction).
      incomplete = fail = true;
      results.push({
        ...target,
        outcome: 'incomplete',
        attempted: true,
        incompleteReason: signal?.aborted
          ? 'cancelled'
          : Date.now() >= deadline
            ? 'timeout'
            : 'Package execution or result validation failed. Inspect SAP diagnostics before retrying.',
      });
      stoppedReason = 'Not attempted after a preceding package failure.';
    }
  }
  return textResult(
    toolJson({
      status: incomplete ? 'incomplete' : 'completed',
      fail,
      summary,
      results,
      selectedPackages: targets.length,
      processedPackages: results.filter((row) => row.summary).length,
      durationMs: Date.now() - started,
    }),
  );
}
