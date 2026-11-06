export interface TextKey {
  TDOBJECT: string;
  TDNAME: string;
  TDID: string;
  TDSPRAS: string;
}

/** Selected classic STXH metadata; deliberately not a synthesized READ_TEXT THEAD. */
export interface StoredTextHeader {
  key: TextKey;
  title: string;
  textType: string;
  storedLineCount: number;
  version: number;
  modifiedDate: string;
  modifiedTime: string;
  reference?: TextKey;
  legacyReference: boolean;
  /** Hash of the selected stored metadata, used only for change detection. */
  revision: string;
}

export interface TextDiscovery {
  object: string;
  namePrefix: string;
  id?: string;
  language?: string;
  limit?: number;
}

/** Narrow data boundary: the orchestration never builds SQL or handles credentials. */
export interface StoredTextSource {
  assertSupportedKey(key: TextKey): Promise<void>;
  readHeader(key: TextKey): Promise<StoredTextHeader | undefined>;
  readCluster(key: TextKey): Promise<Buffer | undefined>;
  discover(query: TextDiscovery): Promise<{ headers: StoredTextHeader[]; more: boolean }>;
}
