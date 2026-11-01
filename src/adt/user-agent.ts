import { VERSION } from '../version.js';

export const DEFAULT_USER_AGENT = `arc-1/${VERSION}`;

/** Keep the admin's identifier short and safe to send as one HTTP header. */
export function resolveSapUserAgent(value?: string): string {
  const agent = value?.trim() || DEFAULT_USER_AGENT;
  if (agent.length > 256 || /[^\x20-\x7e]/.test(agent)) {
    throw new Error('SAP_USER_AGENT / --user-agent must contain at most 256 printable ASCII characters.');
  }
  return agent;
}
