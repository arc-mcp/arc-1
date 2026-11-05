/** Loaded only for an explicitly selected native GET preflight or claimed execution. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { runNativeCtsRound } from './native-cts-driver.js';
export const nativeCtsRuntime = {
  readEnv: (repo: string) => parse(readFileSync(join(repo, '.env'))),
  createClient: (options: ConstructorParameters<typeof AdtClient>[0]) => new AdtClient(options),
  execute: runNativeCtsRound,
};
