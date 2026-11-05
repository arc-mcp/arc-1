/** One exact retained class and unchanged unattempted tail. No caller-selected resume state. */
export const RUNTIME_RETAINED_PROTOCOL = 'pr1142-native-runtime-flp-retained-v1';
export const RUNTIME_RETAINED_STAGES = ['quickfix', 'profiler', 'populated-flp', 'st05'] as const;
export const runtimeRetainedHistory = Object.freeze({
  originalProtocol: 'pr1142-native-runtime-flp-v1',
  originalRevision: '4f5804fe86667772ad386c9bc6100ae13b7ab7d4',
  formatterResultHash: '8d1745130fa9c61fd08f87a0bef0742842677fbf51ddcd7d35e6129d154b9fb5',
  failedQuickfixResultHash: '518a327c86387e6d88184ca13a9355043003c51fc9ebdee593e49f92bec9db24',
  independentAuditHash: 'd3524dee9c831d5e6dc36f7b56b09184224a0b660e2ba57b061a676032e8e3c0',
  independentReportHash: '6b542463cff47b9c756e78aaf94d0b116411088e8cf9dbc3dcfa41bc4c82af67',
  operatorAuditHash: '832c9f8fb69beecb5434f310ae1f09e2eb66af850e3d150f2802b52b7a286fee',
  operatorReportHash: '4a427b8713b2f2d2ad2913d9c6388cb331781c3f0c9d82a5a2c9f35d67aa37cd',
  originalFileCount: 112,
});
export const runtimeRetainedClassReceipt = Object.freeze({
  metadataHash: '2f20265eceed7caae9b3946de46c0cbd08e4fc2c1dad89ac61d6cd93438115f3',
  sourceHash: 'd42f04a3e4398d9eb332fca022d4137aa3bd0694ff61c7f961947e7be2626f7a',
});
