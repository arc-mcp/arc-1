import type { MethodInfo } from './method-surgery.js';

const MAX_NAME = 128;
const MAX_CANDIDATES = 2000;
const MAX_SUGGESTIONS = 5;

function bounded(value: string): string {
  return value.length > MAX_NAME ? `${value.slice(0, MAX_NAME)}…` : value;
}

/** Inputs are capped before ranking; two rows avoid a quadratic allocation. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return previous[b.length]!;
}

/** Reuses the selected source's inventory; never fetches or reparses source. */
export function methodNotFoundMessage(
  className: string,
  methodName: string,
  methods: MethodInfo[],
  declaration?: MethodInfo,
): string {
  const followUp =
    'Use SAPRead with method="*" and the same class/include to list methods, or SAPRead grep to search source.';
  if (declaration && (!declaration.startLine || !declaration.endLine)) {
    const unqualified =
      !methodName.includes('~') &&
      (!declaration.containingClass || declaration.containingClass.toUpperCase() === className.toUpperCase()) &&
      !declaration.isInterfaceMethod &&
      !declaration.isRedefinition;
    return (
      `Method "${bounded(methodName)}" is declared without an implementation in this source of ${bounded(className)}. ` +
      (unqualified
        ? `Only for an own global MAIN declaration, use SAPRead with method=${JSON.stringify(bounded(declaration.name))} and methodView="signature".`
        : followUp)
    );
  }
  const query = methodName.slice(0, MAX_NAME).toUpperCase();
  const ranked: { name: string; score: number }[] = [];
  for (const method of methods.slice(0, MAX_CANDIDATES)) {
    if (!method.startLine || !method.endLine) continue;
    const owner = method.containingClass;
    const qualified =
      owner && owner.toUpperCase() !== className.toUpperCase() ? `${owner}~${method.name}` : method.name;
    // A suggestion must remain a complete, copyable selector.
    if (qualified.length > MAX_NAME) continue;
    const candidate = query.includes('~') ? qualified : method.name.split('~').at(-1)!;
    if (Math.abs(candidate.length - query.length) > 6) continue;
    const score = distance(query, candidate.toUpperCase());
    if (score <= Math.min(6, Math.max(2, Math.floor(query.length / 4)))) ranked.push({ name: qualified, score });
  }
  ranked.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  const suggestions = [...new Set(ranked.map((item) => item.name))].slice(0, MAX_SUGGESTIONS);
  return (
    `Method "${bounded(methodName)}" not found in ${bounded(className)}. ` +
    (suggestions.length ? `Suggestions in selected source: ${suggestions.join(', ')}. ` : '') +
    followUp
  );
}
