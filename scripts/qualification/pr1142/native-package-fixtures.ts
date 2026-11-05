/** Fixed disposable graph; no caller-selected package, parent, class or source. */
export const PACKAGE_PROTOCOL = 'pr1142-native-local-package-v1';
export const PACKAGE_NODE = 'v22.21.1';
export function packageFixtures(suffix: string) {
  if (!/^[A-F0-9]{16}$/.test(suffix)) throw new Error('Invalid package fixture suffix.');
  const rootName = `$ARC1_PK_R_${suffix}`,
    childName = `$ARC1_PK_C_${suffix}`,
    className = `ZCL_ARC1_PK_${suffix}`;
  const make = (name: string, kind: 'root' | 'child' | 'class', parent: string) =>
    Object.freeze({
      name,
      kind,
      owner:
        kind === 'class'
          ? `/sap/bc/adt/oo/classes/${name.toLowerCase()}`
          : `/sap/bc/adt/packages/${encodeURIComponent(name)}`,
      description: `ARC1 PK ${kind} ${suffix}`,
      parent,
    });
  return Object.freeze({
    suffix,
    root: make(rootName, 'root', ''),
    child: make(childName, 'child', rootName),
    clas: Object.freeze({
      ...make(className, 'class', childName),
      source: `" ARC1 package qualification ${suffix}\nCLASS ${className} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\nCLASS ${className} IMPLEMENTATION.\nENDCLASS.\n`,
    }),
  });
}
export type PackageGraph = ReturnType<typeof packageFixtures>;
export type PackageOwner = PackageGraph['root'] | PackageGraph['child'] | PackageGraph['clas'];
export const packageOwners = (graph: PackageGraph) => [graph.root, graph.child, graph.clas] as const;
export const PACKAGE_STAGES = [
  'create-root',
  'create-child',
  'create-class',
  'activate-class',
  'refuse-root-child',
  'refuse-child-class',
  'delete-class',
  'delete-child',
  'delete-root',
] as const;
export type PackageStage = (typeof PACKAGE_STAGES)[number];
export function stageOwner(
  graph: PackageGraph,
  stage: PackageStage | import('./native-package-api-profile.js').PackageApiStage,
): PackageOwner {
  return stage.endsWith('root') || stage === 'refuse-root-child'
    ? graph.root
    : stage.endsWith('child') || stage === 'refuse-child-class'
      ? graph.child
      : graph.clas;
}
