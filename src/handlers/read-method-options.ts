/** Shared preflight for standard, hyperfocused and direct SAPRead callers. */
export function readMethodOptionError(input: Record<string, unknown>, type: string): string | undefined {
  if (type === 'CLAS' && input.method !== undefined && input.format === 'structured') {
    return 'Do not combine method with format="structured". Omit format to read the method, or omit method to read the whole structured class.';
  }
  if (input.methodView === undefined) return undefined;
  if (input.methodView !== 'signature' || type !== 'CLAS') {
    return 'methodView="signature" requires type=CLAS.';
  }
  if (
    typeof input.method !== 'string' ||
    input.method.length > 128 ||
    !/^(?:\/[a-z0-9_]+\/)?[a-z_][a-z0-9_]{0,99}$/i.test(input.method)
  ) {
    return 'methodView="signature" requires one bare method name declared in the global class, not "*" or a qualified name. Read interface declarations with type=INTF.';
  }
  if (input.include !== undefined && String(input.include).toLowerCase() !== 'main') {
    return 'methodView="signature" reads the global class MAIN declaration only; omit include or use include="main".';
  }
  if (
    (input.format !== undefined && input.format !== 'text') ||
    ['grep', 'lineStart', 'lineEnd', 'action'].some((key) => input[key] !== undefined) ||
    input.includeSignature === true ||
    input.expand_includes === true
  ) {
    return 'methodView="signature" cannot be combined with grep, line ranges, diff, structured/editable format, includeSignature or expand_includes.';
  }
  return undefined;
}
