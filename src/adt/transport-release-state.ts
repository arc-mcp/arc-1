/** Native CTS release-state decoding, shared by the convergence engine and readback tests. */

import type { TransportReleaseNodeState } from './transport.js';
import { CTS_TERMINAL_RELEASE_STATUSES as TERMINAL_RELEASE_STATUSES } from './transport-contract.js';
import { parseXml } from './xml-parser.js';

/** Collect every node with a local XML name, rather than stopping at the first matching branch. */
function collectAllNamedNodes(value: unknown, name: string, output: Record<string, unknown>[] = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectAllNamedNodes(entry, name, output);
    return output;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === name) {
      const candidates = Array.isArray(child) ? child : [child];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object') output.push(candidate as Record<string, unknown>);
      }
    }
    collectAllNamedNodes(child, name, output);
  }
  return output;
}

/**
 * Flatten a transport-organizer document into request/task state rows.
 *
 * Unlike `parseTransportList`, this deliberately supports a standalone `<tm:task>` response and a
 * task lookup whose response contains the parent request tree. That makes it safe to verify either
 * kind of id after `newreleasejobs`.
 */
export function parseTransportNodeStates(xml: string): TransportReleaseNodeState[] {
  const parsed = parseXml(xml);
  const states = new Map<string, TransportReleaseNodeState>();

  const parentIdFrom = (value: unknown): string => {
    const raw = String(value ?? '')
      .trim()
      .replace(/\/+$/, '');
    return raw.slice(raw.lastIndexOf('/') + 1);
  };

  const add = (node: Record<string, unknown>, kind: 'request' | 'task', structuralParent?: string) => {
    const id = String(node['@_number'] ?? '').trim();
    if (!id) return;
    const key = id.toUpperCase();
    const status = String(node['@_status'] ?? '').toUpperCase();
    const parentId = parentIdFrom(structuralParent ?? node['@_parent']);
    const previous = states.get(key);
    states.set(key, {
      id,
      kind,
      ...(parentId ? { parentId } : previous?.parentId ? { parentId: previous.parentId } : {}),
      initialStatus: status || previous?.initialStatus || '',
      lastStatus: status || previous?.lastStatus || '',
      confirmedReleased: TERMINAL_RELEASE_STATUSES.has(status || previous?.lastStatus || ''),
      ...(TERMINAL_RELEASE_STATUSES.has(status || previous?.lastStatus || '')
        ? { confirmation: 'observed_terminal' as const }
        : {}),
    });
  };

  for (const request of collectAllNamedNodes(parsed, 'request')) {
    const requestId = String(request['@_number'] ?? '').trim();
    add(request, 'request');
    for (const task of collectAllNamedNodes(request, 'task')) add(task, 'task', requestId);
  }

  for (const task of collectAllNamedNodes(parsed, 'task')) add(task, 'task');
  return [...states.values()];
}
