/**
 * XML builders and parsers for the headless BTP CI quality APIs
 * (`SAP_COM_0901` ATC Checkstyle, `SAP_COM_0735` AUnit JUnit).
 *
 * Object sets are OSL `multiPropertySet` only. Names are charset-bounded and
 * escaped at the XML sink — never concatenated raw.
 */

import { AdtApiError } from './errors.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

export const CI_OBJECT_SET_LIST_CAP = 50;
export const CI_OBJECT_SET_NAME_MAX = 40;
const CI_OBJECT_SET_NAME_RE = /^[A-Z0-9_/]+$/;

export const DEFAULT_ATC_CI_VARIANT = 'ABAP_CLOUD_DEVELOPMENT_DEFAULT';
export const DEFAULT_AUNIT_CI_TITLE = 'ARC-1 AUnit run';
export const DEFAULT_AUNIT_CI_CONTEXT = 'ARC-1';

export type AtcCiSeverity = 'error' | 'warning' | 'info';

export interface CiObjectSet {
  packages?: string[];
  packageTrees?: string[];
  softwareComponents?: string[];
}

export interface NormalizedCiObjectSet {
  packages: string[];
  packageTrees: string[];
  softwareComponents: string[];
}

export interface AtcCiFinding {
  file: string;
  message: string;
  source: string;
  line?: number;
  severity: string;
}

export interface AtcCiSummary {
  findingCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface AunitCiTest {
  classname: string;
  name: string;
  time?: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
  type?: string;
}

export interface AunitCiSummary {
  title?: string;
  system?: string;
  client?: string;
  executedBy?: string;
  time?: string;
  timestamp?: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  asserts?: number;
}

export interface CiRunStatusDocument {
  status: string;
  resultHref?: string;
}

export interface AunitCiRunOptionsXml {
  title?: string;
  context?: string;
  ownTests?: boolean;
  foreignTests?: boolean;
  harmless?: boolean;
  dangerous?: boolean;
  critical?: boolean;
  short?: boolean;
  medium?: boolean;
  long?: boolean;
  measurements?: string;
}

export function normalizeCiObjectSet(objectSet: CiObjectSet): NormalizedCiObjectSet {
  const packages = normalizeNameList(objectSet.packages, 'packages');
  const packageTrees = normalizeNameList(objectSet.packageTrees, 'packageTrees');
  const softwareComponents = normalizeNameList(objectSet.softwareComponents, 'softwareComponents');
  if (packages.length + packageTrees.length + softwareComponents.length === 0) {
    throw new AdtApiError(
      'CI object set is empty. Provide at least one package, package tree, or software component.',
      400,
      '',
    );
  }
  return { packages, packageTrees, softwareComponents };
}

export function buildOslObjectSetXml(objectSet: NormalizedCiObjectSet | CiObjectSet): string {
  const packages = objectSet.packages ?? [];
  const packageTrees = objectSet.packageTrees ?? [];
  const softwareComponents = objectSet.softwareComponents ?? [];
  const lines: string[] = [
    '<osl:objectSet xsi:type="multiPropertySet" xmlns:osl="http://www.sap.com/api/osl" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  ];
  for (const name of packages) {
    lines.push(`  <osl:package name="${escapeXmlAttr(name)}"/>`);
  }
  for (const name of packageTrees) {
    lines.push(`  <osl:package name="${escapeXmlAttr(name)}" includeSubpackages="true"/>`);
  }
  for (const name of softwareComponents) {
    lines.push(`  <osl:softwareComponent name="${escapeXmlAttr(name)}"/>`);
  }
  lines.push('</osl:objectSet>');
  return lines.join('\n');
}

export function buildAtcCiRunParametersXml(
  objectSet: NormalizedCiObjectSet,
  opts: { variant?: string; configuration?: string } = {},
): string {
  const variant = (opts.variant ?? DEFAULT_ATC_CI_VARIANT).trim() || DEFAULT_ATC_CI_VARIANT;
  const configuration = opts.configuration?.trim();
  const attrs = [`checkVariant="${escapeXmlAttr(variant)}"`];
  if (configuration) attrs.push(`configuration="${escapeXmlAttr(configuration)}"`);
  const osl = indentXml(buildOslObjectSetXml(objectSet), '  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<atc:runparameters xmlns:atc="http://www.sap.com/adt/atc" xmlns:obj="http://www.sap.com/adt/objectset" ${attrs.join(' ')}>
${osl}
</atc:runparameters>`;
}

export function buildAunitCiRunXml(objectSet: NormalizedCiObjectSet, opts: AunitCiRunOptionsXml = {}): string {
  const title = (opts.title ?? DEFAULT_AUNIT_CI_TITLE).trim() || DEFAULT_AUNIT_CI_TITLE;
  const context = (opts.context ?? DEFAULT_AUNIT_CI_CONTEXT).trim() || DEFAULT_AUNIT_CI_CONTEXT;
  const measurements = (opts.measurements ?? 'none').trim() || 'none';
  const osl = indentXml(buildOslObjectSetXml(objectSet), '  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<aunit:run title="${escapeXmlAttr(title)}" context="${escapeXmlAttr(context)}" xmlns:aunit="http://www.sap.com/adt/api/aunit">
  <aunit:options>
    <aunit:measurements type="${escapeXmlAttr(measurements)}"/>
    <aunit:scope ownTests="${xmlBool(opts.ownTests)}" foreignTests="${xmlBool(opts.foreignTests)}"/>
    <aunit:riskLevel harmless="${xmlBool(opts.harmless)}" dangerous="${xmlBool(opts.dangerous)}" critical="${xmlBool(opts.critical)}"/>
    <aunit:duration short="${xmlBool(opts.short)}" medium="${xmlBool(opts.medium)}" long="${xmlBool(opts.long)}"/>
  </aunit:options>
${osl}
</aunit:run>`;
}

export function parseAtcCiRunStatus(xml: string): CiRunStatusDocument {
  const parsed = parseXml(xml);
  const run = findDeepNodes(parsed, 'run')[0];
  const status = attr(run, 'status');
  const href = firstLinkHref(parsed, run);
  return href ? { status, resultHref: href } : { status };
}

export function parseAunitCiRunStatus(xml: string): CiRunStatusDocument {
  const parsed = parseXml(xml);
  const progress = findDeepNodes(parsed, 'progress')[0];
  const status = attr(progress, 'status');
  const href = firstLinkHref(parsed);
  return href ? { status, resultHref: href } : { status };
}

export function parseAtcCheckstyle(xml: string): { findings: AtcCiFinding[]; summary: AtcCiSummary } {
  if (xml.startsWith(' ')) {
    throw new AdtApiError(
      'The software component could not be checked. It may not be cloned into the system.',
      400,
      '',
      xml.slice(0, 200),
    );
  }
  const trimmed = xml.trim();
  if (!trimmed.startsWith('<')) {
    throw new AdtApiError(
      'The software component could not be checked. It may not be cloned into the system.',
      400,
      '',
      xml.slice(0, 200),
    );
  }
  const parsed = parseXml(xml);
  const root = asRecord(parsed.checkstyle) ?? findDeepNodes(parsed, 'checkstyle')[0];
  const findings: AtcCiFinding[] = [];
  for (const fileNode of asRecordArray(root?.file)) {
    const file = attr(fileNode, 'name');
    for (const errorNode of asRecordArray(fileNode.error)) {
      const lineRaw = attr(errorNode, 'line');
      const line = lineRaw ? Number.parseInt(lineRaw, 10) : Number.NaN;
      const finding: AtcCiFinding = {
        file,
        message: attr(errorNode, 'message'),
        source: attr(errorNode, 'source'),
        severity: attr(errorNode, 'severity') || 'error',
      };
      if (Number.isFinite(line)) finding.line = line;
      findings.push(finding);
    }
  }
  return { findings, summary: summarizeAtcFindings(findings) };
}

export function summarizeAtcFindings(findings: AtcCiFinding[]): AtcCiSummary {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const finding of findings) {
    const rank = severityRank(finding.severity);
    if (rank >= 3) errorCount += 1;
    else if (rank === 2) warningCount += 1;
    else infoCount += 1;
  }
  return { findingCount: findings.length, errorCount, warningCount, infoCount };
}

export function atcFindingsFail(findings: AtcCiFinding[], failOnSeverity: AtcCiSeverity): boolean {
  const threshold = severityRank(failOnSeverity);
  return findings.some((finding) => severityRank(finding.severity) >= threshold);
}

export function parseAunitJunit(xml: string): { tests: AunitCiTest[]; summary: AunitCiSummary } {
  const parsed = parseXml(xml);
  const root = asRecord(parsed.testsuites) ?? findDeepNodes(parsed, 'testsuites')[0];
  const tests: AunitCiTest[] = [];
  for (const suite of collectTestsuites(root, parsed)) {
    for (const testcase of asRecordArray(suite.testcase)) {
      tests.push(parseJunitTestcase(testcase));
    }
  }
  const summary = parseJunitSummary(root, tests);
  return { tests, summary };
}

export function aunitResultsFail(summary: AunitCiSummary, evaluateResults: boolean): boolean {
  if (!evaluateResults) return false;
  return summary.errors > 0 || summary.failures > 0;
}

export function severityRank(severity: string): number {
  const normalized = severity.trim().toLowerCase();
  if (normalized === 'error') return 3;
  if (normalized === 'warning') return 2;
  if (normalized === 'info') return 1;
  return 3;
}

function normalizeNameList(values: string[] | undefined, field: string): string[] {
  if (!values || values.length === 0) return [];
  if (values.length > CI_OBJECT_SET_LIST_CAP) {
    throw new AdtApiError(`CI object set ${field} exceeds the cap of ${CI_OBJECT_SET_LIST_CAP} names.`, 400, '');
  }
  const normalized: string[] = [];
  for (const raw of values) {
    const name = raw.trim().toUpperCase();
    if (!name) continue;
    if (name.length > CI_OBJECT_SET_NAME_MAX) {
      throw new AdtApiError(`CI object set name exceeds ${CI_OBJECT_SET_NAME_MAX} characters in ${field}.`, 400, '');
    }
    if (!CI_OBJECT_SET_NAME_RE.test(name)) {
      throw new AdtApiError(
        `CI object set name in ${field} contains characters outside A-Z, 0-9, underscore, and slash.`,
        400,
        '',
      );
    }
    normalized.push(name);
  }
  return normalized;
}

function xmlBool(value: boolean | undefined): string {
  return (value ?? true) ? 'true' : 'false';
}

function indentXml(xml: string, prefix: string): string {
  return xml
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

function attr(node: Record<string, unknown> | undefined, name: string): string {
  if (!node) return '';
  const value = node[`@_${name}`];
  return value == null ? '' : String(value);
}

function textContent(node: Record<string, unknown> | undefined): string {
  if (!node) return '';
  const text = node['#text'];
  return text == null ? '' : String(text);
}

function firstLinkHref(parsed: Record<string, unknown>, run?: Record<string, unknown>): string | undefined {
  const fromRun = asRecordArray(run?.link);
  const links = fromRun.length > 0 ? fromRun : findDeepNodes(parsed, 'link');
  const href = attr(links[0], 'href').trim();
  return href || undefined;
}

function collectTestsuites(
  root: Record<string, unknown> | undefined,
  parsed: Record<string, unknown>,
): Record<string, unknown>[] {
  if (root) {
    const nested = asRecordArray(root.testsuite);
    if (nested.length > 0) return nested;
    if (root.testcase != null) return [root];
  }
  const suites = findDeepNodes(parsed, 'testsuite');
  return suites.length > 0 ? suites : root ? [root] : [];
}

function parseJunitTestcase(node: Record<string, unknown>): AunitCiTest {
  const failure = asRecordArray(node.failure)[0];
  const error = asRecordArray(node.error)[0];
  const skipped = asRecordArray(node.skipped)[0];
  const time = attr(node, 'time') || undefined;
  const base = {
    classname: attr(node, 'classname'),
    name: attr(node, 'name'),
    ...(time ? { time } : {}),
  };
  if (error) {
    return {
      ...base,
      status: 'error',
      message: attr(error, 'message') || textContent(error) || undefined,
      type: attr(error, 'type') || undefined,
    };
  }
  if (failure) {
    return {
      ...base,
      status: 'failed',
      message: attr(failure, 'message') || textContent(failure) || undefined,
      type: attr(failure, 'type') || undefined,
    };
  }
  if (skipped) {
    return {
      ...base,
      status: 'skipped',
      message: attr(skipped, 'message') || textContent(skipped) || undefined,
    };
  }
  return { ...base, status: 'passed' };
}

function parseJunitSummary(root: Record<string, unknown> | undefined, tests: AunitCiTest[]): AunitCiSummary {
  const testsAttr = intAttr(root, 'tests');
  const failuresAttr = intAttr(root, 'failures');
  const errorsAttr = intAttr(root, 'errors');
  const skippedAttr = intAttr(root, 'skipped');
  const assertsAttr = intAttr(root, 'asserts');
  const title = attr(root, 'title') || undefined;
  const system = attr(root, 'system') || undefined;
  const client = attr(root, 'client') || undefined;
  const executedBy = attr(root, 'executedBy') || undefined;
  const time = attr(root, 'time') || undefined;
  const timestamp = attr(root, 'timestamp') || undefined;
  return {
    ...(title ? { title } : {}),
    ...(system ? { system } : {}),
    ...(client ? { client } : {}),
    ...(executedBy ? { executedBy } : {}),
    ...(time ? { time } : {}),
    ...(timestamp ? { timestamp } : {}),
    tests: testsAttr ?? tests.length,
    failures: failuresAttr ?? tests.filter((test) => test.status === 'failed').length,
    errors: errorsAttr ?? tests.filter((test) => test.status === 'error').length,
    skipped: skippedAttr ?? tests.filter((test) => test.status === 'skipped').length,
    ...(assertsAttr != null ? { asserts: assertsAttr } : {}),
  };
}

function intAttr(node: Record<string, unknown> | undefined, name: string): number | undefined {
  const raw = attr(node, name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
