/** Loaded only after the fixed execute-stage claim and revalidated offline prerequisites. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { runNativeFlpStage } from './native-flp-driver.js';
export const nativeFlpDefaults = {
  readEnv: (repo: string) => parse(readFileSync(join(repo, '.env'))),
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => new AdtClient(input),
  execute: runNativeFlpStage,
};
