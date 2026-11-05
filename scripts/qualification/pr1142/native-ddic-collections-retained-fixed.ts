/** Adopt only the three independently audited v2 owners. No completed prefix can be submitted again. */
import { collectionsFixtures } from './native-ddic-collections-fixtures.js';
export const COLLECTIONS_RETAINED = 'pr1142-native-ddic-collections-retained-v1';
export const COLLECTIONS_RETAINED_SUFFIX = '5987F1A4E01E';
export const COLLECTIONS_RETAINED_STAGES = [
  'stale-MSAG',
  'update-MSAG',
  'delete-MSAG',
  'delete-TTYP',
  'delete-TABL/DS',
] as const;
export function collectionsRetainedFixtures(suffix: string) {
  if (suffix !== COLLECTIONS_RETAINED_SUFFIX) throw new Error('Only the exact stopped collections graph is admitted.');
  return collectionsFixtures(suffix);
}
export const COLLECTIONS_RETAINED_RECEIPTS = {
  'TABL/DS': {
    hash: '05cdf0cd830741c09c07800f4f4c665b8649746e61403fc1f390a0e37eb4adbd',
    canonical: '774e72f86da150bd2a3cdd4fb8ddbcb7de0c81bcb1e503700e51c48c1039ab56',
    sourceHash: '1caccceedc1a230104c79c050562d197dae65df4f39c2562aa2c4602bc346f36',
  },
  TTYP: {
    hash: '68c6e11201a2837507e8f22639d3fb533be005e586d6d99547b74467cf3ca871',
    canonical: '96a568678e89c743e3d90edbb2c12a85cc242c2254fe18ddc040a27d483538b4',
  },
  MSAG: {
    hash: '31f6aed58f7a69ade42080c984c192a7cb7b4d5ab22457e668ef69ca4423a446',
    canonical: '8a3e7098be52ad0d0ebdee806d9bb77c1dc89fa8882eae674513e69ee7522f11',
  },
} as const;
export const COLLECTIONS_RETAINED_HISTORY = {
  audit: 'a9758e49adb2596338bb18ade712c4d18b460c7af23c2264eb7b9dfc45b6b323',
  report: 'd4959197799077b5c54ea48c89fc647548e880270a331ee7dfa33e69bbff5000',
  ledger: '8d7d23278395f993c23edf6b729832da6901081974a837a73da2cdbd23cc8a34',
  intent: '4efa82cbc6ab795689d90b84cdeff244d1e6e0ed4ce5439cceaffddfd1c32612',
  result: '866e13b09a1f991258e9222255d80e0864a22b5b5b66894ddd96ac888a360a46',
};
