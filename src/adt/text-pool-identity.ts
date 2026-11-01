/** One canonical collection/URI mapping shared by reads, writes and internal activation grants. */
export const TEXT_ELEMENT_COLLECTIONS = {
  CLAS: 'classes',
  PROG: 'programs',
  FUGR: 'functiongroups',
} as const;

export type TextElementObjectType = keyof typeof TEXT_ELEMENT_COLLECTIONS;

export function textElementsObject(objectType: TextElementObjectType, name: string): string {
  return `/sap/bc/adt/textelements/${TEXT_ELEMENT_COLLECTIONS[objectType]}/${encodeURIComponent(name)}`;
}
