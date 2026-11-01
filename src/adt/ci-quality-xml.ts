/** Bounded package selection and strict Checkstyle parsing for the ATC CI API. */
import { XMLValidator } from 'fast-xml-parser';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

export const CI_REPORT_PARSE_LIMIT = 2 * 1024 * 1024;
export const DEFAULT_ATC_CI_VARIANT = 'ABAP_CLOUD_DEVELOPMENT_DEFAULT';
export type AtcCiSeverity = 'error' | 'warning' | 'info';
export interface CiObjectSet {
  packages?: string[];
  packageTrees?: string[];
}
export interface NormalizedCiObjectSet {
  packages: string[];
  packageTrees: string[];
}
export interface AtcCiFinding {
  file: string;
  message: string;
  source: string;
  line?: number;
  severity: AtcCiSeverity;
}
export interface AtcCiSummary {
  findingCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}
export interface CiRunStatusDocument {
  status: string;
  progress?: string;
  resultHref?: string;
}

/** Input bounds are enforced by SAPDiagnose's strict schema before package verification. */
export function buildOslObjectSetXml(objectSet: NormalizedCiObjectSet): string {
  return (
    '<osl:objectSet xsi:type="osl:packageSet" xmlns:osl="http://www.sap.com/api/osl" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    objectSet.packages
      .map((name) => `<osl:package name="${escapeXmlAttr(name)}" includeSubpackages="false"/>`)
      .join('') +
    objectSet.packageTrees
      .map((name) => `<osl:package name="${escapeXmlAttr(name)}" includeSubpackages="true"/>`)
      .join('') +
    '</osl:objectSet>'
  );
}

export function buildAtcCiRunParametersXml(
  objectSet: NormalizedCiObjectSet,
  options: { variant?: string; configuration?: string } = {},
): string {
  const variant = options.variant?.trim() || DEFAULT_ATC_CI_VARIANT;
  return `<?xml version="1.0" encoding="UTF-8"?><atc:runparameters xmlns:atc="http://www.sap.com/adt/atc" checkVariant="${escapeXmlAttr(variant)}"${options.configuration ? ` configuration="${escapeXmlAttr(options.configuration)}"` : ''}>${buildOslObjectSetXml(objectSet)}</atc:runparameters>`;
}

export function reportRoot(xml: string, name: string, label = name): Record<string, unknown> {
  if (Buffer.byteLength(xml) > CI_REPORT_PARSE_LIMIT)
    throw new Error(`${label} report exceeded the 2 MiB parsing limit.`);
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE/i.test(xml))
    throw new Error(`CI API returned invalid ${label} XML.`);
  const parsed = parseXml(xml);
  const keys = Object.keys(parsed).filter((key) => !key.startsWith('?') && !key.startsWith('@_'));
  if (keys.length !== 1 || keys[0] !== name) throw new Error(`CI API returned a non-${label} report.`);
  const root = parsed[name];
  if (root === '') return {};
  if (!root || typeof root !== 'object' || Array.isArray(root))
    throw new Error(`CI API returned an invalid ${label} root.`);
  return root as Record<string, unknown>;
}

export function parseAtcCiRunStatus(xml: string): CiRunStatusDocument {
  const run = reportRoot(xml, 'run');
  const links = findDeepNodes(run, 'link').filter(
    (link) =>
      String(link['@_type'] ?? '').includes('atc.checkstyle') || String(link['@_rel'] ?? '').endsWith('/atc/result'),
  );
  const progress = findDeepNodes(run, 'progress')[0];
  return {
    status: String(run['@_status'] ?? '').trim(),
    ...(progress?.['@_description'] ? { progress: String(progress['@_description']) } : {}),
    ...(links.length === 1 && links[0]?.['@_href'] ? { resultHref: String(links[0]['@_href']) } : {}),
  };
}

function nodes(value: unknown): Record<string, unknown>[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Malformed Checkstyle entry.');
    return node as Record<string, unknown>;
  });
}

export function parseAtcCheckstyle(xml: string): { findings: AtcCiFinding[]; summary: AtcCiSummary } {
  const root = reportRoot(xml, 'checkstyle');
  if (Object.keys(root).some((key) => !key.startsWith('@_') && key !== 'file'))
    throw new Error('Unexpected Checkstyle report content.');
  const findings: AtcCiFinding[] = [];
  for (const file of nodes(root.file)) {
    if (typeof file['@_name'] !== 'string' || !file['@_name']) throw new Error('Checkstyle file lacks a name.');
    if (Object.keys(file).some((key) => !key.startsWith('@_') && key !== 'error'))
      throw new Error('Unexpected Checkstyle file content.');
    for (const error of nodes(file.error)) {
      const severity = error['@_severity'];
      if (severity !== 'error' && severity !== 'warning' && severity !== 'info')
        throw new Error('Invalid Checkstyle severity.');
      if (typeof error['@_message'] !== 'string' || !error['@_message'])
        throw new Error('Checkstyle finding lacks a message.');
      const line = error['@_line'] === undefined ? undefined : Number(error['@_line']);
      if (line !== undefined && (!Number.isSafeInteger(line) || line < 0)) throw new Error('Invalid Checkstyle line.');
      findings.push({
        file: file['@_name'],
        message: error['@_message'],
        source: String(error['@_source'] ?? ''),
        severity,
        ...(line === undefined ? {} : { line }),
      });
    }
  }
  return { findings, summary: summarizeAtcFindings(findings) };
}
export function summarizeAtcFindings(findings: AtcCiFinding[]): AtcCiSummary {
  return {
    findingCount: findings.length,
    errorCount: findings.filter((x) => x.severity === 'error').length,
    warningCount: findings.filter((x) => x.severity === 'warning').length,
    infoCount: findings.filter((x) => x.severity === 'info').length,
  };
}
export function atcFindingsFail(findings: AtcCiFinding[], threshold: AtcCiSeverity): boolean {
  const ranks = { error: 3, warning: 2, info: 1 };
  return findings.some((finding) => ranks[finding.severity] >= ranks[threshold]);
}
