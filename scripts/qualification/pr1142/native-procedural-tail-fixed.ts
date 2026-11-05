/** Fixed post-edit/add graph only. Historical failures and the original empty baseline remain immutable. */
import { STAGES } from './native-procedural-fixed.js';
import { retainedHashes } from './native-procedural-retained-fixed.js';
export const TAIL_PROTOCOL = 'pr1142-native-procedural-tail-v1';
export const TAIL_STAGES = ['preflight', ...STAGES.slice(STAGES.indexOf('include-activate'))] as const;
export const TAIL_INTENT = 'b7c5ab0038ff8819685256df01210b8f9c5fa9cb6183c29be6123913eb90c618';
export const TAIL_RESULT = '922835968de9926e12dbf2a4820ec60d51c7b6f4d87eed5aa7515b616522b1be';
export const tailHistoryDigest = 'a19e343e7ec19ebb88374d0a4ee46fb8a5387601c62e6da4aeae576cf0043321';
export const tailHistoryRoots = {
  'arc1-qualification/pr1142-native-procedural-retained-v1': 389,
  'arc1-review/pr1142-native-procedural-retained-execution-20261103': 33,
  'arc1-review/pr1142-procedural-post-generation-reads-20261103': 35,
} as const;
export const tailHistoryReports = [
  'arc1-review/pr1142-procedural-retained-independent-audit1/result.md',
  'arc1-review/pr1142-procedural-retained-independent-audit1/result.json',
  'arc1-review/pr1142-procedural-retained-stop-operator-audit1/result.md',
  'arc1-review/pr1142-procedural-retained-stop-operator-audit1/result.json',
] as const;
export const tailHashes = Object.freeze({
  ...retainedHashes,
  parentActiveMetadata: '54eeac2eaec6a3c07bd191e4772ce3feff0736d3aa085b916a8aab4ce7b3cfcf',
  parentInactiveMetadata: '54eeac2eaec6a3c07bd191e4772ce3feff0736d3aa085b916a8aab4ce7b3cfcf',
  tree: '9765f20ea501684fe782ee6ee53914d01cff786600407fc2f8b9e4c439e4c386',
  includeDraft: '79741f35719e48c74da2b0a43abf90f6bfd408be9d4244cc2cddd4bf270e934d',
});
