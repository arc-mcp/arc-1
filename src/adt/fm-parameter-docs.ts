/** Native, attached ABAP Doc short texts for function-module data parameters. */
import type { FmParameter } from './fm-signature.js';
import { decodeXmlEntities } from './xml-entities.js';

export function isValidFmParameterDescription(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 60 &&
    value.trim().length > 0 &&
    !/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(value)
  );
}

function isDataParameter(parameter: FmParameter): boolean {
  return parameter.kind !== 'exceptions' && parameter.kind !== 'raising';
}

const PARAMETER_DOC_START = /^[ \t]*"![ \t]*@parameter[ \t]+[^\s|]+[ \t]*\|/i;

interface DocSection {
  tag?: string;
  name?: string;
  text: string;
}

function attachedDocumentation(prefix: string): { before: string; sections: DocSection[] } {
  const lines = prefix.split(/(?<=\n)/);
  let start = lines.length;
  while (start > 0 && /^[ \t]*"!/.test(lines[start - 1]!)) start--;
  const sections: DocSection[] = [{ text: '' }];
  for (const line of lines.slice(start)) {
    const tag = /^[ \t]*"!\s*@([a-z]+)\b(?:[ \t]+([^\s|]+))?/i.exec(line);
    if (tag) sections.push({ tag: tag[1]!.toLowerCase(), name: tag[2]?.toUpperCase(), text: line });
    else sections[sections.length - 1]!.text += line;
  }
  return { before: lines.slice(0, start).join(''), sections };
}

function shortTexts(
  text: string,
): { start: number; end: number; open: string; content: string; synchronized: boolean }[] {
  const result = [];
  for (const match of text.matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p\s*>/gi)) {
    const classes = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(match[1]!);
    const tokens = classes?.[2]?.toLowerCase().split(/\s+/) ?? [];
    if (tokens.includes('shorttext')) {
      result.push({
        start: match.index,
        end: match.index + match[0].length,
        open: match[1]!,
        content: match[2]!,
        synchronized: tokens.includes('synchronized'),
      });
    }
  }
  return result;
}

function shortTextMarkerCount(text: string): number {
  // Count even an unfinished class attribute so malformed markup cannot invite a second paragraph.
  return [...text.matchAll(/\bclass\s*=\s*["'][^"'\r\n]*\bshorttext\b/gi)].length;
}

export function readFmParameterDescriptions(prefix: string, parameters: FmParameter[]): void {
  const { sections } = attachedDocumentation(prefix);
  for (const parameter of parameters.filter(isDataParameter)) {
    const matches = sections.filter(
      (section) => section.tag === 'parameter' && section.name === parameter.name.toUpperCase(),
    );
    if (matches.length !== 1 || !PARAMETER_DOC_START.test(matches[0]!.text)) continue;
    const paragraphs = shortTexts(matches[0]!.text);
    const paragraph = paragraphs[0];
    if (
      paragraphs.length !== 1 ||
      shortTextMarkerCount(matches[0]!.text) !== 1 ||
      !paragraph?.synchronized ||
      /[<\r\n]/.test(paragraph.content)
    )
      continue;
    const description = decodeXmlEntities(paragraph.content);
    if (isValidFmParameterDescription(description)) parameter.description = description;
  }
}

function escapeDescription(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '@': '&#64;',
    '!': '&#33;',
  };
  return value.replace(/[&<>"'@!]/g, (character) => entities[character]!);
}

function replaceDescription(section: DocSection, description: string, language: string): string {
  const pipe = PARAMETER_DOC_START.exec(section.text);
  if (!pipe) throw new Error(`Cannot locate ABAP Doc parameter ${section.name}; edit the full source instead.`);
  const paragraphs = shortTexts(section.text);
  const paragraph = paragraphs[0];
  if (
    paragraphs.length > 1 ||
    shortTextMarkerCount(section.text) !== paragraphs.length ||
    (paragraph && (!paragraph.synchronized || /[<\r\n]/.test(paragraph.content)))
  ) {
    throw new Error(`Cannot safely replace ABAP Doc short text for ${section.name}; edit the full source instead.`);
  }
  if (paragraph) {
    return (
      section.text.slice(0, paragraph.start) +
      paragraph.open.replace(/\s+lang\s*=\s*(["'])[^"']*\1/gi, '').replace(/>$/, ` lang="${language}">`) +
      escapeDescription(description) +
      '</p>' +
      section.text.slice(paragraph.end)
    );
  }
  const offset = pipe[0].length;
  return (
    section.text.slice(0, offset) +
    ` <p class="shorttext synchronized" lang="${language}">${escapeDescription(description)}</p>` +
    section.text.slice(offset)
  );
}

/** Preserve unrelated documentation; only explicit short texts and removed parameter sections change. */
export function updateFmParameterDescriptions(
  prefix: string,
  previous: FmParameter[],
  parameters: FmParameter[],
  eol: string,
  language?: string,
): string {
  const { before, sections } = attachedDocumentation(prefix);
  const retained = new Set(parameters.filter(isDataParameter).map((parameter) => parameter.name.toUpperCase()));
  const removed = new Set(
    previous
      .filter(isDataParameter)
      .map((parameter) => parameter.name.toUpperCase())
      .filter((name) => !retained.has(name)),
  );
  const updated = sections.filter((section) => section.tag !== 'parameter' || !removed.has(section.name ?? ''));
  for (const parameter of parameters) {
    if (parameter.description === undefined) continue;
    if (!isDataParameter(parameter) || !isValidFmParameterDescription(parameter.description)) {
      throw new Error(
        'FUNC parameter description must be 1–60 printable characters and is supported only for importing/exporting/changing/tables.',
      );
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.name))
      throw new Error('Invalid FUNCTION parameter name for ABAP Doc.');
    if (!language || !/^[a-z]{2}$/.test(language))
      throw new Error('The original language is required for FUNC parameter descriptions.');
    const name = parameter.name.toUpperCase();
    const matches = updated.filter((section) => section.tag === 'parameter' && section.name === name);
    if (matches.length > 1) throw new Error(`Duplicate ABAP Doc parameter ${name}; edit the full source instead.`);
    if (matches[0]) matches[0].text = replaceDescription(matches[0], parameter.description, language);
    else
      updated.push({
        tag: 'parameter',
        name,
        text: `"! @parameter ${name.toLowerCase()} | <p class="shorttext synchronized" lang="${language}">${escapeDescription(parameter.description)}</p>${eol}`,
      });
  }
  return before + updated.map((section) => section.text).join('');
}
