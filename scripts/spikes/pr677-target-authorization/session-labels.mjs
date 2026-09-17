import { HarnessError, label } from './safe-io.mjs';

// Reserve before asynchronous work, through pending login AND callback token exchange.
export function reserveSessionLabel(value, sessions, reserved) {
  const key = label(value);
  if (sessions.has(key) || reserved.has(key)) throw new HarnessError('LABEL_ALREADY_IN_USE');
  if (new Set([...sessions.keys(), ...reserved]).size >= 32) throw new HarnessError('SESSION_LIMIT_REACHED');
  reserved.add(key);
  return () => reserved.delete(key);
}
