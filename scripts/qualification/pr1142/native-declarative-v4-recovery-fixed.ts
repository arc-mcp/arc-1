/** Fixed cleanup receipts only; the original rejected BDEF syntax is retained, never repaired. */
import { declarativeV4Fixtures } from './native-declarative-fixtures.js';
export const V4_RECOVERY = 'pr1142-native-declarative-v4-recovery-v1';
export const V4_FAILED_REVISION = '99a375a16efd8891adbff9d2995d2684c5e550fb';
export const v4RecoveryFixtures = declarativeV4Fixtures('013FECCE68663763');
export const v4RecoveryOwners = Object.freeze([v4RecoveryFixtures[4], v4RecoveryFixtures[1]]);
export const v4ReferencedClass = Object.freeze({ owner: '/sap/bc/adt/oo/classes/zbp_arc1_v4a_013fecce68663763' });
export const v4OriginalResultHash = '3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940';
export const v4RecoveryEvidence = Object.freeze({
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/ABSTRACT-DDLS-active-metadata.xml':
    'cc3dddf912dbb8ae760b4b4fd966644d93f57f1a2ab275af0f0f84ea719ba10e',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/ABSTRACT-DDLS-default-metadata.xml':
    'cc3dddf912dbb8ae760b4b4fd966644d93f57f1a2ab275af0f0f84ea719ba10e',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/ABSTRACT-DDLS-source-active.abap':
    '4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/ABSTRACT-DDLS-source-default.abap':
    '4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/ABSTRACT-DDLS-source-inactive.abap':
    '4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/BDEF-active-metadata.xml':
    '83f7cbec88440910fd6161cedfe8618b67e6015e0b8a925bc520fa789743370b',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/BDEF-default-metadata.xml':
    '2ecbdf84c6d8fe9f526e696082cd3def3f40c6dcdbd1cc9abb6d5100a0d4fb00',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/BDEF-source-active.abap':
    '7be05fcec2b5134a6ee5e91aebdb3ce65351924a341704b079a707eb930182de',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/BDEF-source-default.abap':
    '8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/BDEF-source-inactive.abap':
    '8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/DCLS-owner.xml':
    '3aae8e0c630915b4add4b2172c834d4193e519c3eb03167325e37ca9028c0275',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/DDLX-owner.xml':
    '7830c77235af5161edb18bac0705c5740d3d10ba4afaa98885157fd247a5a371',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/SRVD-owner.xml':
    'fb0334449ff0e6af13789dc95b8cd6d58a28bc9d663271982207c615a2ebc25d',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/VIEW-owner.xml':
    '87efffbcacc9ec65494e9fa8da1a7566bc4525859991999ee879df2d3c54fe62',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/manifest.json':
    '1c8f8d87d43efa145ac08b01857846cc26edd3fac41550bb84b932755ad096f1',
  'arc1-review/pr1142-v4-failure-get-inspection-2026-11-03T023125763Z/read-only-capture.mjs':
    '45e9374e664bd56e1cffd22d97786279b51247f914bd8b7e878be9d3a7917377',
  'arc1-review/pr1142-v4-referenced-class-inspection-2026-11-03T023343009Z/REFERENCED-CLAS.xml':
    '88b980cbd66f08348d0d74b7627e398bc675aa62d240347aa5266b31f7cca9dc',
  'arc1-review/pr1142-v4-referenced-class-inspection-2026-11-03T023343009Z/manifest.json':
    '7b73abb02ff77b0f85be3d1a42b1ee88cd1a8a6db6828f41b080459e04120deb',
  'arc1-review/pr1142-v4-referenced-class-inspection-2026-11-03T023343009Z/read-only-capture.mjs':
    '7de41c0fa1001c864eade0f922f4facfeedafee2c73319ae38d34b384a1387db',
  'arc1-qualification/pr1142-native-declarative-v4-failure-audit.json':
    '1b68c65255290855303e9efa4f899e0ab28ef76edc88989aad1034f2cd69bf90',
  'arc1-qualification/pr1142-native-declarative-v4-failure-audit.md':
    '927171cb558de07af18fdf20b34603d1e40153ee713414bd5b3be8e643bcdcf7',
});
export const v4MetadataHashes = Object.freeze({
  'BDEF-default-metadata.xml': '2ecbdf84c6d8fe9f526e696082cd3def3f40c6dcdbd1cc9abb6d5100a0d4fb00',
  'BDEF-active-metadata.xml': '83f7cbec88440910fd6161cedfe8618b67e6015e0b8a925bc520fa789743370b',
  'ABSTRACT-DDLS-default-metadata.xml': 'cc3dddf912dbb8ae760b4b4fd966644d93f57f1a2ab275af0f0f84ea719ba10e',
  'ABSTRACT-DDLS-active-metadata.xml': 'cc3dddf912dbb8ae760b4b4fd966644d93f57f1a2ab275af0f0f84ea719ba10e',
});
export const v4SourceHashes = Object.freeze({
  'BDEF-source-default.abap': '8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb',
  'BDEF-source-active.abap': '7be05fcec2b5134a6ee5e91aebdb3ce65351924a341704b079a707eb930182de',
  'BDEF-source-inactive.abap': '8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb',
  'ABSTRACT-DDLS-source-default.abap': '4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8',
  'ABSTRACT-DDLS-source-active.abap': '4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8',
  'ABSTRACT-DDLS-source-inactive.abap': '4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8',
});
