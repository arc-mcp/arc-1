import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('entry import is pure before any phase: no dotenv file or network attempts', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import fs from 'node:fs';import net from 'node:net';import tls from 'node:tls';import {syncBuiltinESMExports} from 'node:module';
    const attempts=[];const refuse=label=>{attempts.push(label);throw new Error(label);};net.Socket.prototype.connect=()=>refuse('network');tls.connect=()=>refuse('network');
    const original=fs.readFileSync;fs.readFileSync=function(path,...args){if(/(?:^|[/\\\\])\\.env(?:$|[.])/.test(String(path)))return refuse('env');return original.call(this,path,...args);};
    syncBuiltinESMExports();globalThis.fetch=()=>refuse('network');
    await import('./scripts/qualification/pr1142/native-flp-cust.ts');if(attempts.length)throw new Error('Side effects');console.log('pure');
  `,
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 },
  );
  expect(output.trim()).toBe('pure');
});
