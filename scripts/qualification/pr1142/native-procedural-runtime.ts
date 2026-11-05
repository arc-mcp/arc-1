/** Loaded only for a durably claimed native phase after local prerequisites pass. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { runNativeProceduralContract } from './native-procedural-driver.js';
export const nativeProceduralDefaults = {
  readEnv: (repo: string) => parse(readFileSync(join(repo, '.env'))),
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => new AdtClient(input),
  execute: runNativeProceduralContract,
};
