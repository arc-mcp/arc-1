/**
 * SAPLint handler — offline abaplint (lint, lint_and_fix, list_rules) + ADT formatter APIs
 * (format, get/set formatter settings).
 */

import type { AdtClient } from '../adt/client.js';
import {
  getPrettyPrinterSettings,
  type PrettyPrinterSettings,
  prettyPrint,
  setPrettyPrinterSettings,
} from '../adt/devtools.js';
import { buildLintConfig, listRulesFromConfig, type RuleOverrides } from '../lint/config-builder.js';
import { detectFilename, lintAbapSource, lintAndFix } from '../lint/lint.js';
import type { ServerConfig } from '../server/types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';
import { buildLintConfigOptions } from './write-helpers.js';

// Some SAPLint actions run offline (@abaplint/core), others call SAP ADT formatter APIs.
export async function handleSAPLint(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const ruleOverrides = args.rules as RuleOverrides | undefined;
  const configOptions = buildLintConfigOptions(config, ruleOverrides);

  switch (action) {
    case 'lint': {
      const source = String(args.source ?? '');
      if (!source) return errorResult('"source" is required for lint action.');
      const name = String(args.name ?? 'UNKNOWN');
      const filename = detectFilename(source, name);
      const lintConfig = buildLintConfig(configOptions);
      const issues = lintAbapSource(source, filename, lintConfig);
      return textResult(toolJson(issues));
    }
    case 'lint_and_fix': {
      const source = String(args.source ?? '');
      if (!source) return errorResult('"source" is required for lint_and_fix action.');
      const name = String(args.name ?? 'UNKNOWN');
      const filename = detectFilename(source, name);
      const lintConfig = buildLintConfig(configOptions);
      const result = lintAndFix(source, filename, lintConfig);
      return textResult(toolJson(result));
    }
    case 'list_rules': {
      const lintConfig = buildLintConfig(configOptions);
      const rules = listRulesFromConfig(lintConfig);
      const enabled = rules.filter((r) => r.enabled);
      const disabled = rules.filter((r) => !r.enabled);
      const effectiveAbapRelease = configOptions.abapRelease ?? 'unknown';
      const syntax = lintConfig.get().syntax as { version?: string } | undefined;
      return textResult(
        toolJson({
          preset: configOptions.systemType === 'btp' ? 'cloud' : 'onprem',
          abapVersion: effectiveAbapRelease,
          syntaxVersion: syntax?.version ?? 'unknown',
          enabledRules: enabled.length,
          disabledRules: disabled.length,
          rules: enabled,
          disabledRuleNames: disabled.map((r) => r.rule),
        }),
      );
    }
    case 'format': {
      const source = String(args.source ?? '');
      if (!source) return errorResult('"source" is required for format action.');
      const formatted = await prettyPrint(client.http, client.safety, source);
      return textResult(formatted);
    }
    case 'get_formatter_settings': {
      const settings = await getPrettyPrinterSettings(client.http, client.safety);
      return textResult(toolJson(settings));
    }
    case 'set_formatter_settings': {
      const indentation = args.indentation as boolean | undefined;
      const style = args.style as PrettyPrinterSettings['style'] | undefined;
      if (indentation === undefined && style === undefined) {
        return errorResult('At least one of "indentation" or "style" is required for set_formatter_settings.');
      }
      const current = await getPrettyPrinterSettings(client.http, client.safety);
      const next: PrettyPrinterSettings = {
        indentation: indentation ?? current.indentation,
        style: style ?? current.style,
      };
      await setPrettyPrinterSettings(client.http, client.safety, next);
      return textResult(toolJson(next));
    }
    default:
      return errorResult(
        `Unknown SAPLint action: "${action}". Supported: lint, lint_and_fix, list_rules, format, get_formatter_settings, set_formatter_settings. For atc/syntax/unittest, use SAPDiagnose instead.`,
      );
  }
}
