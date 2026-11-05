/** Separate unconsumed fixed protocol: reuse the six RAP owners plus their owned BDEF documentation. */
import { RAP_STAGES, type RapFixture, rapFixtures } from './native-rap-fixtures.js';
export const RAP_DOCUMENT_PROTOCOL = 'pr1142-native-rap-documents-v1';
export function rapDocumentFixtures(suffix: string): RapFixture[] {
  const f = rapFixtures(suffix),
    parent = f[3];
  return [
    ...f,
    {
      type: 'SKTD',
      name: parent.name,
      owner: `/sap/bc/adt/documentation/ktd/documents/${parent.name.toLowerCase()}`,
      packageName: '$TMP',
      description: `ARC1 RAP documentation ${suffix}`,
      dependencies: [parent.owner],
      create: {
        source: `ARC1 owned root documentation ${suffix}.`,
        refObjectType: 'BDEF/BDO',
        refObjectName: parent.name,
      },
      update: {},
    },
  ];
}
export const RAP_DOCUMENT_STAGES = RAP_STAGES.flatMap((stage) => [
  ...(stage === 'delete-generated-binding' ? ['delete-document'] : []),
  stage,
  ...(stage === 'batch-activate-pool-bdef'
    ? [
        'create-document',
        'activate-document',
        'update-document-create',
        'update-document-update',
        'activate-document-updated',
      ]
    : []),
]);
export function documentChanges(f: RapFixture, stage: string): Record<string, unknown> {
  if (stage === 'create-document') return { source: f.create.source };
  if (stage === 'update-document-root')
    return {
      source: `## ${f.name}\n\n${f.create.source}\n\n## ${f.name}.approve\n\nDescribes the owned approval action without executing it.`,
    };
  if (stage === 'update-document-create') return { source: `## ${f.name}.create\n\nOwned create documentation.` };
  if (stage === 'update-document-update')
    return {
      source: `## ${f.name}.update\n\nOwned update documentation.`,
      shortTexts: [
        { node: `${f.name}.update`, text: 'Update an owned RAP item' },
        { node: `${f.name}.create`, text: 'Create an owned RAP item' },
      ],
    };
  throw new Error('No compiled document changes for this stage.');
}
