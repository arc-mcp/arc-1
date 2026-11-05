/** Second consumed quickfix computation, with unchanged original owned class and unattempted tail. */
import { runtimeRetainedHistory } from './native-runtime-retained-fixed.js';
export const RUNTIME_RETAINED_V2_PROTOCOL = 'pr1142-native-runtime-flp-retained-v2';
export const runtimeRetainedV2History = Object.freeze({
  originalProtocol: 'pr1142-native-runtime-flp-retained-v1',
  originalRevision: '6a4e535a0cdfc5afb398cbed06d84b65123a241c',
  originalIntentHash: '1423eefd5fa61bc21137e311e122c2ef9066b4b386cfdbc3520786d8a3cb5af0',
  failedQuickfixResultHash: '6a97633ba7f8fd030cab0cec79e77421ec6e198a50ee62874b2a8ac64b214f48',
  proposalResultHash: '081daba23d8bfbf31aa3d6e4a9ecf95e68fe590f47d5638ce9aef7eef9465531',
  independentAuditHash: '75349f30892265d384d4b3b0bf9e3bf297143452c169204de2ff1eb9f4f49f9e',
  independentReportHash: '84d4d901bdb0ab52297e6ceb104594bdf28a36723ad6fd6bd561c87ded75d588',
  operatorAuditHash: 'c59ea2e33723fc2a74efaf86bc685a2aed1b86bb757f8cbb6df325c256eda1a0',
  operatorReportHash: 'd745e67c60955b14ec5141c1cef9df4b5fb52809335f48e86ca7bda3bad56816',
  originalFileCount: 45,
  priorHistory: runtimeRetainedHistory,
});
