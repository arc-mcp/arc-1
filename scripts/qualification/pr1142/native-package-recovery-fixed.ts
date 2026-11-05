/** Exact retained graph and audited receipts. No new names, source or negative DELETE experiment. */
import type { OwnerReceipt } from './native-package-evidence.js';
import { packageFixtures } from './native-package-fixtures.js';

export const PACKAGE_RECOVERY = 'pr1142-native-local-package-recovery-v1';
export const packageRecoveryGraph = packageFixtures('A5CD6186AFDACA31');
export const packageRecoveryStages = ['delete-class', 'delete-child', 'delete-root'] as const;
export const packageOriginalResultHash = '22a2901a427c42d01ae7e0747c4ec0d84b58474f984f10a793825e8450a7bbcc';
export const packageRecoveryHistory = Object.freeze({
  'arc1-qualification/pr1142-native-local-package-audit.md':
    '42aa168b6bd38ab18cd6464e091b72184cd63dfffb301e9a54fb45f68777eaa7',
  'arc1-qualification/pr1142-native-local-package-audit.json':
    'd3de6a3131fcbd81e75fe4c4f70b4160b119b1478c5bec6bb42654b02b16e5b6',
});
export const packageRecoveryReceipts: Readonly<Record<string, OwnerReceipt>> = Object.freeze({
  [packageRecoveryGraph.root.owner]: Object.freeze({
    metadataHash: 'a88621465bda7127c54b0f214df28c51371250995a00ec4595ce0f7bbae90b5c',
    children: [packageRecoveryGraph.child.owner],
    active: true,
  }),
  [packageRecoveryGraph.child.owner]: Object.freeze({
    metadataHash: '76b20a59dc20fccdecef2c15b201bdf5e4d24f80217abdef91572728d3f99c3e',
    children: [],
    active: true,
  }),
  [packageRecoveryGraph.clas.owner]: Object.freeze({
    metadataHash: '2e3192ca8d7fcdfdb919bee00506a518a5a7abfc1ca6c9d37a29147895507998',
    activeMetadataHash: '2e3192ca8d7fcdfdb919bee00506a518a5a7abfc1ca6c9d37a29147895507998',
    sourceHash: '8983b81cbe288e20cc351c6dc91492cdcc002a65bf0d383bb963b0a79b1ff6cb',
    active: true,
  }),
});

for (const receipt of Object.values(packageRecoveryReceipts)) if (receipt.children) Object.freeze(receipt.children);
export const packageRecoveryExternalProofs = [
  'arc1-review/pr1142-native-local-package-review1-20261103-085053/codex-verdict.md',
  'arc1-review/pr1142-native-local-package-review1-20261103-085053/codex-evidence.json',
  'arc1-qualification/pr1142-native-declarative-v5-audit.md',
] as const;
