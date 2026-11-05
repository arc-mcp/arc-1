/** Compiled single graph. No caller-selected package, CTS member, move, contract or resume point. */
import type { PackageGraph, PackageStage, packageOwners } from './native-package-fixtures.js';
export const PACKAGE_API_PROTOCOL = 'pr1142-native-package-api-v1';
export const RECORDED_PACKAGE = 'ZARC1_DEMO';
export const RECORDED_PACKAGE_URI = '/sap/bc/adt/packages/ZARC1_DEMO';
export const PACKAGE_API_STAGES = [
  'create-request',
  'create-root',
  'create-child',
  'batch-create',
  'refuse-root-child',
  'refuse-child-class',
  'move-class',
  'release-api',
  'stale-api',
  'revoke-api',
  'delete-class',
  'delete-interface',
  'delete-child',
  'delete-root',
] as const;
export type PackageApiStage = (typeof PACKAGE_API_STAGES)[number];
export type PackageLifecycleStage = PackageStage | PackageApiStage;
export const packageApiDescription = (graph: PackageGraph) => `ARC1 package API ${graph.suffix}`;
export const packageApiIntent = (graph: PackageGraph) => ({
  stages: PACKAGE_API_STAGES,
  independentInterface: packageApiInterface(graph),
  recordedPackage: RECORDED_PACKAGE,
  requestDescription: packageApiDescription(graph),
  retainedBookkeeping: 'new-request-and-task-with-native-records',
});
export const apiDocumentPath = (graph: PackageGraph) =>
  `/sap/bc/adt/apireleases/${encodeURIComponent(graph.clas.owner)}`;
export const packageApiExtraStage = (stage: PackageLifecycleStage) =>
  ['create-request', 'move-class', 'release-api', 'stale-api', 'revoke-api'].includes(stage);

export function packageApiInterface(graph: PackageGraph) {
  const name = `ZIF_ARC1_PK_${graph.suffix}`;
  return Object.freeze({
    name,
    kind: 'interface' as const,
    owner: `/sap/bc/adt/oo/interfaces/${name.toLowerCase()}`,
    parent: graph.root.name,
    description: `ARC1 PK interface ${graph.suffix}`,
    source: `" ARC1 package batch ${graph.suffix}\nINTERFACE ${name} PUBLIC.\nENDINTERFACE.\n`,
  });
}
export type PackageApiOwner = ReturnType<typeof packageApiInterface> | ReturnType<typeof packageOwners>[number];
export const packageApiOwners = (graph: PackageGraph) =>
  [graph.root, graph.child, packageApiInterface(graph), graph.clas] as const;
export const packageApiStageOwner = (graph: PackageGraph, stage: PackageLifecycleStage) =>
  stage === 'delete-interface'
    ? packageApiInterface(graph)
    : stage.endsWith('root') || stage === 'refuse-root-child'
      ? graph.root
      : stage.endsWith('child') || stage === 'refuse-child-class'
        ? graph.child
        : graph.clas;
