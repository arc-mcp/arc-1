import { Config, type Version } from '@abaplint/core';

const defaultConfigCache = new Map<string, Config>();
const defaultConfigJsonCache = new Map<string, string>();

function cacheKey(version: Version): string {
  return String(version);
}

export function getDefaultAbaplintConfig(version: Version): Config {
  const key = cacheKey(version);
  let cached = defaultConfigCache.get(key);
  if (!cached) {
    cached = Config.getDefault(version);
    defaultConfigCache.set(key, cached);
  }
  return cached;
}

export function cloneDefaultAbaplintConfig(version: Version): Record<string, unknown> {
  const key = cacheKey(version);
  let json = defaultConfigJsonCache.get(key);
  if (!json) {
    json = JSON.stringify(getDefaultAbaplintConfig(version).get());
    defaultConfigJsonCache.set(key, json);
  }
  return JSON.parse(json) as Record<string, unknown>;
}

export function clearAbaplintConfigCacheForTests(): void {
  defaultConfigCache.clear();
  defaultConfigJsonCache.clear();
}
