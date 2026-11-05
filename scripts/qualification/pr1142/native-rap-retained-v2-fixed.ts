/** Exact unfinished tail after the consumed first retained document attempt. */
import { RAP_DOCUMENT_STAGES } from './native-rap-documents-fixtures.js';
import { RAP_RETAINED_COMPLETED, RAP_RETAINED_READS } from './native-rap-retained-fixed.js';
export const RAP_RETAINED_V2_PROTOCOL = 'pr1142-native-rap-documents-retained-v2';
export const RAP_RETAINED_V2_COMPLETED = [...RAP_RETAINED_COMPLETED, 'update-document-root', 'activate-document'];
export const RAP_RETAINED_V2_OBSERVED_WRITES = ['update-document-create'];
export const RAP_RETAINED_V2_STAGES = RAP_DOCUMENT_STAGES.slice(RAP_DOCUMENT_STAGES.indexOf('update-document-update'));
export const RAP_RETAINED_V2_HISTORY = {
  report: '4bbac188447bf934ef4647109f9cc9fc3f2363931d7f6e3a2fd6366d1050d207',
  ledger: '3642304fbddac820f042bee414fb10a3fa65df43fe751aabe2bce9bd8682859f',
  intent: 'd5b2776a708c58c974acd128a4f9e74486ed33264d21545cc0e055cd84f37340',
  result: 'e4cb625d4f8ceefd4d871a2e55fc44025aeecf50c6ada336313fff540e82a871',
};
const document = '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5';
export const RAP_RETAINED_V2_READS = RAP_RETAINED_READS.map((row) =>
  row.path === document || row.path === `${document}?version=inactive`
    ? { ...row, sha256: '2c0f2b76a8fa3d0deb2e347df6faff7cb47cd552d7f71de1cf422ac7db01f983', bytes: 7911 }
    : row.path === `${document}?version=active`
      ? { ...row, sha256: 'a7c1be0c58cc07a800db70314a16fc0b3d29d347cba468a3ab9dcf7648ab2069', bytes: 7864 }
      : row,
);
