/** Public target-ID and HTTP-route syntax for destination-discovered multi-target mode. */

export const SAP_SYSID_PATTERN = /^[A-Z][A-Z0-9]{2}$/;

// A route alias is useful when separate SAP systems reuse the same SID and client.
// Keep it URL-friendly, case-sensitive, and bounded: 3-32 characters, with no
// leading or trailing hyphen. The real SAP identity remains sap-sysid/sap-client.
export const TARGET_SYSTEM_SEGMENT_SOURCE = '[A-Z][A-Z0-9-]{1,30}[A-Z0-9]';
export const TARGET_SYSTEM_ALIAS_PATTERN = new RegExp(`^${TARGET_SYSTEM_SEGMENT_SOURCE}$`);
export const TARGET_ID_PATTERN = new RegExp(`^${TARGET_SYSTEM_SEGMENT_SOURCE}/[0-9]{3}$`);
export const PINNED_MCP_PATH_PATTERN = new RegExp(`^/(${TARGET_SYSTEM_SEGMENT_SOURCE})/([0-9]{3})/mcp$`);
export const PINNED_RESOURCE_METADATA_PATH_PATTERN = new RegExp(
  `^/\\.well-known/oauth-protected-resource/(${TARGET_SYSTEM_SEGMENT_SOURCE})/([0-9]{3})/mcp$`,
);

export function buildTargetId(sid: string, client: string, alias?: string): string {
  return `${alias ?? sid}/${client}`;
}

export function targetFromPinnedMcpPath(path: string): string | undefined {
  const match = path.match(PINNED_MCP_PATH_PATTERN);
  return match ? `${match[1]}/${match[2]}` : undefined;
}
