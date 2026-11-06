/** Collect every lock holder; first-match XML helpers cannot establish unique CTS ownership. */
function records(root: unknown, key: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [name, child] of Object.entries(value).reverse()) {
      if (name === key) {
        for (const entry of Array.isArray(child) ? child : [child])
          if (entry && typeof entry === 'object') found.push(entry);
      }
      pending.push(child);
    }
  }
  return found;
}

export function parseTransportLocks(parsed: unknown): {
  lockedTransport?: string;
  lockedTransportOwner?: string;
  lockedTasks: string[];
  lockedTransportAmbiguous?: true;
} {
  const parents = new Map<string, string>();
  const tasks = new Set<string>();
  let orphan = false;
  for (const container of records(parsed, 'LOCKS')) {
    const holders = records(container, 'LOCK_HOLDER');
    for (const holder of holders) {
      const headers = records(holder, 'REQ_HEADER');
      const holderTasks = records(holder, 'CTS_TASK_HEADER');
      if (holderTasks.length && !headers.some((header) => String(header.TRKORR ?? '').trim())) orphan = true;
      for (const header of headers) {
        const id = String(header.TRKORR ?? '').trim();
        if (id && !parents.has(id)) parents.set(id, String(header.AS4USER ?? '').trim());
      }
      for (const task of holderTasks) {
        const id = String(task.TRKORR ?? '').trim();
        if (id) tasks.add(id);
      }
    }
    // Also inspect legacy headers: a conflicting legacy claim must not be hidden.
    for (const header of records(container, 'HEADER')) {
      const id = String(header.TRKORR ?? '').trim();
      if (id && !parents.has(id)) parents.set(id, String(header.AS4USER ?? '').trim());
    }
  }
  const first = parents.entries().next().value;
  return {
    ...(first ? { lockedTransport: first[0], ...(first[1] ? { lockedTransportOwner: first[1] } : {}) } : {}),
    lockedTasks: [...tasks],
    ...(parents.size > 1 || orphan || tasks.size > 256 ? { lockedTransportAmbiguous: true } : {}),
  };
}
