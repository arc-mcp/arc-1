import { HarnessError, label } from './safe-io.mjs';

// Reserve before asynchronous work, through pending login AND callback token exchange.
export function reserveSessionLabel(value, sessions, reserved) {
  const key = label(value);
  if (sessions.has(key) || reserved.has(key)) throw new HarnessError('LABEL_ALREADY_IN_USE');
  if (new Set([...sessions.keys(), ...reserved.keys()]).size >= 32) throw new HarnessError('SESSION_LIMIT_REACHED');
  const release = () => {
    if (reserved.get(key) === release) reserved.delete(key);
  };
  release.commit = (entry) => {
    if (reserved.get(key) !== release) throw new HarnessError('SESSION_CANCELLED');
    sessions.set(key, entry);
  };
  reserved.set(key, release);
  return release;
}

export function forgetSessionLabel(value, sessions, reserved, pending) {
  const key = label(value);
  sessions.delete(key);
  reserved.delete(key); // Invalidates an exchanging callback even after its state was consumed.
  for (const [state, entry] of pending) {
    if (entry.label !== key) continue;
    clearTimeout(entry.timer);
    pending.delete(state);
    entry.release();
  }
}
