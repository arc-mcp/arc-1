/** Pure Dictionary-name validation shared by schema and native read boundaries. */
export const SEARCH_HELP_NAME = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/i;

export function isSearchHelpName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 30 && SEARCH_HELP_NAME.test(value);
}
