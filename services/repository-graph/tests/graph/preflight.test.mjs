import { expect, test } from 'vitest';
import { assertFreeCapacity } from '../../scripts/graph/preflight-btp.mjs';

const valid = {
  environment: { planName: 'free', serviceName: 'cloudfoundry', state: 'OK' },
  plan: { name: 'free', free: true },
  offering: { name: 'postgresql-db' },
  quota: { apps: { total_memory_in_mb: 4096 }, routes: { total_routes: 10 } },
  usage: { memory_in_mb: 3328, routes: 9 },
  memoryMb: 512,
  routes: 1,
  activeWork: 0,
};
test('free capacity includes staging/task headroom and route quota', () => {
  expect(() => assertFreeCapacity(valid)).not.toThrow();
  expect(() =>
    assertFreeCapacity({ ...valid, offering: { name: 'hana-cloud' }, plan: { name: 'hana-free', free: true } }),
  ).not.toThrow();
  for (const patch of [
    { memoryMb: 1024 },
    { routes: 2 },
    { activeWork: 1 },
    { memoryMb: NaN },
    { plan: { name: 'standard', free: true } },
    { plan: { name: 'free', free: false } },
    { offering: { name: 'hana-cloud' }, plan: { name: 'hana', free: true } },
    { environment: { planName: 'standard' } },
    { usage: {} },
  ]) {
    expect(() => assertFreeCapacity({ ...valid, ...patch })).toThrow();
  }
});
