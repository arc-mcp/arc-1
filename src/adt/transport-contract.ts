/** Accept header for tree-structured responses (list/get transport) */
export const CTS_ACCEPT_TREE = 'application/vnd.sap.adt.transportorganizertree.v1+xml';

/** Content-Type / Accept for organizer write operations (create transport) */
export const CTS_CONTENT_TYPE_ORGANIZER = 'application/vnd.sap.adt.transportorganizer.v1+xml';

/** XML namespace for CTS ADT transport manager payloads */
export const CTS_NAMESPACE_TM = 'http://www.sap.com/cts/adt/tm';

export const CTS_TERMINAL_RELEASE_STATUSES = new Set(['R', 'N']);
