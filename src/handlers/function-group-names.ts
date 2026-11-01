/** Native structural-include naming, shared by legacy and pinned input adapters. */
export function functionGroupIncludePrefix(group: string): string {
  const upper = group.toUpperCase();
  const namespaced = /^(\/[^/]+\/)(.+)$/.exec(upper);
  return namespaced ? `${namespaced[1]}L${namespaced[2]}` : `L${upper}`;
}
