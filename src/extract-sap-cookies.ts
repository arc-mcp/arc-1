import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve, win32 } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { config as loadDotEnv } from 'dotenv';

type BrowserChoice = 'chrome' | 'firefox' | 'edge';

interface ScriptArgs {
  browser: BrowserChoice;
  output?: string;
  yes: boolean;
  help: boolean;
}

export interface ServerArgs {
  url?: string;
  cookieFile?: string;
}

export interface ExtractionPlanInput {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  platform: NodeJS.Platform;
}

export interface ExtractionPlan {
  url: string;
  origin: string;
  browser: BrowserChoice;
  browserBinary: string;
  outputPath: string;
  yes: boolean;
}

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  expires?: number;
}

const DEV_ONLY_BANNER =
  '⚠️  DEV-ONLY UTILITY. The resulting cookie file MUST NOT be used with SAP_PP_ENABLED=true — it would cause every per-user request to authenticate as you. Continue? [y/N] ';
const PP_REFUSAL_MESSAGE =
  'Refusing to run while SAP_PP_ENABLED=true. Cookie extraction is a shared-auth developer utility and must never run alongside principal propagation.';

function getFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (args[i]?.startsWith(prefix)) {
      return args[i].slice(prefix.length);
    }
  }
  return undefined;
}

function parseScriptArgs(args: string[]): ScriptArgs {
  const browserRaw = getFlag(args, 'browser') ?? 'chrome';
  const browser = browserRaw === 'chrome' || browserRaw === 'firefox' || browserRaw === 'edge' ? browserRaw : null;
  if (!browser) {
    throw new Error(`Unsupported --browser value '${browserRaw}'. Use one of: chrome, firefox, edge.`);
  }

  return {
    browser,
    output: getFlag(args, 'output'),
    yes: args.includes('--yes'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// Keep this helper local to mirror the server config precedence for --url.
export function parseServerArgs(args: string[], env: NodeJS.ProcessEnv = process.env): ServerArgs {
  return {
    url: getFlag(args, 'url') ?? env.SAP_URL,
    cookieFile: env.SAP_COOKIE_FILE,
  };
}

function commandExists(command: string): boolean {
  const result =
    process.platform === 'win32'
      ? spawnSync('where.exe', [command], { stdio: 'ignore' })
      : spawnSync('command', ['-v', command], { stdio: 'ignore' });
  return result.status === 0;
}

function resolveBrowserBinary(browser: BrowserChoice, platform: NodeJS.Platform): string {
  const win32Paths = (relativePath: string, exe: string): string[] => {
    const PF = process.env.PROGRAMFILES;
    const PF86 = process.env['PROGRAMFILES(X86)'];
    const LAD = process.env.LOCALAPPDATA;
    return [
      LAD ? `${LAD}\\${relativePath}` : undefined,
      PF ? `${PF}\\${relativePath}` : undefined,
      PF86 ? `${PF86}\\${relativePath}` : undefined,
      exe,
    ].filter((c): c is string => Boolean(c));
  };

  const candidates: Record<BrowserChoice, string[]> = {
    chrome:
      platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            'google-chrome',
            'google-chrome-stable',
            'chromium',
            'chromium-browser',
          ]
        : platform === 'win32'
          ? win32Paths('Google\\Chrome\\Application\\chrome.exe', 'chrome.exe')
          : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
    firefox:
      platform === 'darwin'
        ? ['/Applications/Firefox.app/Contents/MacOS/firefox', 'firefox']
        : platform === 'win32'
          ? win32Paths('Mozilla Firefox\\firefox.exe', 'firefox.exe')
          : ['firefox', 'firefox-esr'],
    edge:
      platform === 'darwin'
        ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'microsoft-edge', 'microsoft-edge-stable']
        : platform === 'win32'
          ? win32Paths('Microsoft\\Edge\\Application\\msedge.exe', 'msedge.exe')
          : ['microsoft-edge', 'microsoft-edge-stable'],
  };

  for (const candidate of candidates[browser]) {
    if (isAbsolute(candidate)) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    if (platform === 'linux') {
      if (commandExists(candidate)) return candidate;
      continue;
    }
    if (platform === 'win32') {
      if (spawnSync('where', [candidate], { stdio: 'ignore' }).status === 0) return candidate;
      continue;
    }
    if (commandExists(candidate)) return candidate;
  }

  throw new Error(
    `No runnable ${browser} binary found. Install the browser or pass an available binary via --browser (chrome|firefox|edge).`,
  );
}

function printUsage(): void {
  process.stderr.write(`Usage: arc1-cli extract-cookies --url <SAP_URL> [options]
       (or: npx tsx src/extract-sap-cookies.ts --url <SAP_URL> [options])

Options:
  --url <url>               Target SAP URL (required). Precedence: CLI > env > .env
  --browser <name>          Browser to launch: chrome | firefox | edge (default: chrome)
  --output <path>           Output cookie file path. Precedence: CLI > SAP_COOKIE_FILE env > ./cookies.txt
  --yes                     Skip the DEV-ONLY confirmation prompt
  --help, -h                Show this help
`);
}

export async function waitForDebuggerWebSocketUrl(
  port: number,
  signal: AbortSignal,
  timeoutMs = 25_000,
): Promise<string> {
  const waiting = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  while (!waiting.aborted) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: waiting });
      if (response.ok) {
        const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (payload.webSocketDebuggerUrl) return payload.webSocketDebuggerUrl;
      }
    } catch {
      // Browser not ready yet.
    }
    try {
      await delay(300, undefined, { signal: waiting });
    } catch {
      break;
    }
  }
  signal.throwIfAborted();
  throw new Error(`Timed out waiting for browser debugging endpoint on http://127.0.0.1:${port}/json/version`);
}

export async function waitForEnter(
  prompt: string,
  signal: AbortSignal,
  input: Readable = process.stdin,
  output: Writable = process.stderr,
): Promise<void> {
  const rl = createInterface({ input, output });
  // In a terminal readline consumes Ctrl+C itself. EOF also ends an unanswered question.
  const inputClosed = new AbortController();
  rl.once('SIGINT', () => inputClosed.abort(new Error('Cookie extraction interrupted by Ctrl+C.')));
  rl.once('close', () => inputClosed.abort(new Error('Input closed before cookie extraction.')));
  const waiting = AbortSignal.any([signal, inputClosed.signal]);
  try {
    await rl.question(prompt, { signal: waiting });
  } catch (error) {
    waiting.throwIfAborted();
    throw error;
  } finally {
    rl.close();
  }
}

async function maybePromptConfirmation(skipPrompt: boolean): Promise<void> {
  if (skipPrompt) return;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(DEV_ONLY_BANNER)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      throw new Error('Aborted by user.');
    }
  } finally {
    rl.close();
  }
}

function startBrowser(browserBinary: string, browser: BrowserChoice, url: string, port: number, profileDir: string) {
  const args =
    browser === 'firefox'
      ? ['--remote-debugging-port', String(port), '-profile', profileDir, url]
      : [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${profileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--new-window',
          url,
        ];
  // Give the temporary browser its own POSIX process group so shutdown can include its helpers.
  return spawn(browserBinary, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
}

export function cookieMatchesHost(cookieDomain: string, hostname: string): boolean {
  const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

export async function fetchCookiesViaCdp(
  wsUrl: string,
  origin: string,
  interrupt: AbortSignal,
  timeoutMs = 25_000,
): Promise<CdpCookie[]> {
  const signal = AbortSignal.any([interrupt, AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();
  const hostname = new URL(origin).hostname;
  return new Promise<CdpCookie[]>((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    let settled = false;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

    const settleOnce = (resolver: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolver();
    };

    const rejectAllPending = (error: Error): void => {
      for (const request of pending.values()) {
        request.reject(error);
      }
      pending.clear();
    };

    const onAbort = () => {
      settleOnce(() => rejectPromise(signal.reason));
      rejectAllPending(signal.reason);
      ws.close();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
      new Promise((resolveSend, rejectSend) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
        ws.send(JSON.stringify({ id, method, params }));
      });

    ws.onerror = () => {
      settleOnce(() => rejectPromise(new Error('Failed to connect to browser debugging websocket.')));
      rejectAllPending(new Error('CDP websocket error'));
    };

    ws.onmessage = (event) => {
      const raw =
        typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer).toString('utf-8');
      const msg = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } };
      if (!msg.id) return;
      const request = pending.get(msg.id);
      if (!request) return;
      pending.delete(msg.id);
      if (msg.error) {
        request.reject(new Error(msg.error.message ?? 'Unknown CDP error'));
      } else {
        request.resolve(msg.result);
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settleOnce(() => rejectPromise(new Error('Browser debugging websocket closed unexpectedly.')));
      }
      rejectAllPending(new Error('CDP websocket closed'));
    };

    ws.onopen = async () => {
      try {
        const result = (await send('Storage.getCookies')) as { cookies?: CdpCookie[] };
        ws.close();
        const filtered = (result.cookies ?? []).filter((c) => cookieMatchesHost(c.domain, hostname));
        settleOnce(() => resolvePromise(filtered));
      } catch (error) {
        ws.close();
        const message = error instanceof Error ? error.message : String(error);
        settleOnce(() => rejectPromise(new Error(message)));
      }
    };
  });
}

export function formatNetscapeCookieLine(cookie: CdpCookie): string {
  const domain = cookie.domain || '';
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const path = cookie.path || '/';
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expires = cookie.expires && cookie.expires > 0 ? String(Math.floor(cookie.expires)) : '0';
  return `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}`;
}

export function toNetscapeCookieFile(cookies: CdpCookie[]): string {
  const header = ['# Netscape HTTP Cookie File', '# Generated by ARC-1 extract-sap-cookies.ts'];
  const lines = cookies.map(formatNetscapeCookieLine);
  return `${[...header, ...lines].join('\n')}\n`;
}

export function planExtraction(input: ExtractionPlanInput): ExtractionPlan {
  if (input.env.SAP_PP_ENABLED === 'true') {
    throw new Error(PP_REFUSAL_MESSAGE);
  }

  const scriptArgs = parseScriptArgs(input.args);
  const serverArgs = parseServerArgs(input.args, input.env);
  if (!serverArgs.url) {
    throw new Error(
      'Missing SAP URL. Set --url <...> (preferred) or SAP_URL (CLI > env > .env). See --help for usage.',
    );
  }

  const parsedUrl = new URL(serverArgs.url);
  const browserBinary = resolveBrowserBinary(scriptArgs.browser, input.platform);

  return {
    url: serverArgs.url,
    origin: parsedUrl.origin,
    browser: scriptArgs.browser,
    browserBinary,
    outputPath: resolve(input.cwd, scriptArgs.output ?? serverArgs.cookieFile ?? './cookies.txt'),
    yes: scriptArgs.yes,
  };
}

export function ensureOutputDirectory(dir: string, fs = { existsSync, mkdirSync }, path = { parse }): void {
  // Recursive mkdir can fail with EPERM on an existing Windows drive or share root.
  if (path.parse(dir).root !== dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function waitForExit(closed: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => resolveWait(false), ms);
    closed.then(() => {
      clearTimeout(timer);
      resolveWait(true);
    });
  });
}

export function killBrowserTree(
  pid: number,
  platform = process.platform,
  kill = process.kill,
  runCommand = spawnSync,
): boolean {
  if (platform === 'win32') {
    const taskkill = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    return (
      runCommand(taskkill, ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 1000,
      }).status === 0
    );
  }
  try {
    kill(-pid, 'SIGKILL');
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'; // The entire group already exited.
  }
}

async function stopBrowser(child: ChildProcess, closed: Promise<void>): Promise<boolean> {
  let treeStopped = true;
  try {
    if (child.exitCode === null && child.signalCode === null) {
      // Windows SIGTERM terminates only the leader. Stop the tree while its PID is still live.
      if (process.platform === 'win32' && child.pid) treeStopped = killBrowserTree(child.pid);
      if (process.platform !== 'win32' || !child.pid || !treeStopped) child.kill('SIGTERM');
      if (!(await waitForExit(closed, 4000))) {
        child.kill('SIGKILL');
        treeStopped = (await waitForExit(closed, 1000)) && treeStopped;
      }
    }
    // The browser can exit before a helper finishes writing to its profile.
    if (process.platform !== 'win32' && child.pid) return killBrowserTree(child.pid) && treeStopped;
    return treeStopped;
  } catch {
    return false;
  } finally {
    child.unref();
  }
}

interface ProfileCleanupOptions {
  signals?: Pick<NodeJS.EventEmitter, 'on' | 'off'>;
  makeDir?: (prefix: string) => string;
  removeDir?: typeof rmSync;
  warn?: (message: string) => void;
}

export async function withTemporaryBrowserProfile(
  launch: (dir: string) => ChildProcess,
  extract: (signal: AbortSignal) => Promise<void>,
  {
    signals = process,
    makeDir = mkdtempSync,
    removeDir = rmSync,
    warn = (message: string) => process.stderr.write(message),
  }: ProfileCleanupOptions = {},
): Promise<void> {
  const dir = makeDir(join(tmpdir(), 'arc1-cookie-extract-'));
  const interrupt = new AbortController();
  const onInterrupt = () => interrupt.abort(new Error('Cookie extraction interrupted by SIGINT.'));
  const onTerminate = () => interrupt.abort(new Error('Cookie extraction interrupted by SIGTERM.'));
  const onHangup = () => interrupt.abort(new Error('Cookie extraction interrupted by SIGHUP.'));
  signals.on('SIGHUP', onHangup);
  signals.on('SIGINT', onInterrupt);
  signals.on('SIGTERM', onTerminate);
  let stopped = true;
  try {
    const child = launch(dir);
    const onError = (error: Error) => interrupt.abort(error);
    child.on('error', onError);
    const closed = new Promise<void>((resolveExit) => {
      child.once('close', () => {
        resolveExit();
        interrupt.abort(new Error('Browser closed during cookie extraction.'));
      });
    });
    try {
      await extract(interrupt.signal);
    } catch (error) {
      interrupt.signal.throwIfAborted();
      throw error;
    } finally {
      stopped = await stopBrowser(child, closed);
      child.off('error', onError);
    }
  } finally {
    try {
      removeDir(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (!stopped) warn(`Warning: could not confirm browser exit. Close it and delete ${dir} if it reappears.\n`);
    } catch {
      warn(
        `Warning: could not remove temporary browser profile ${dir}. Close the browser and delete this directory.\n`,
      );
    } finally {
      signals.off('SIGHUP', onHangup);
      signals.off('SIGINT', onInterrupt);
      signals.off('SIGTERM', onTerminate);
    }
  }
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  loadDotEnv();
  const scriptArgs = parseScriptArgs(argv);
  if (scriptArgs.help) {
    printUsage();
    return;
  }

  const plan = planExtraction({
    args: argv,
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
  });

  await maybePromptConfirmation(plan.yes);

  const port = 9222;
  await withTemporaryBrowserProfile(
    (dir) => startBrowser(plan.browserBinary, plan.browser, plan.url, port, dir),
    async (signal) => {
      const wsUrl = await waitForDebuggerWebSocketUrl(port, signal);
      process.stderr.write(
        `Browser started (${plan.browser}). Complete login for ${plan.origin}, then press Enter to capture cookies.\n`,
      );
      await waitForEnter('', signal);

      const cookies = await fetchCookiesViaCdp(wsUrl, plan.origin, signal);
      signal.throwIfAborted();
      if (cookies.length === 0) {
        throw new Error(`No cookies were returned for ${plan.origin}. Ensure you are logged in and try again.`);
      }

      const cookieFileContent = toNetscapeCookieFile(cookies);
      ensureOutputDirectory(dirname(plan.outputPath));
      writeFileSync(plan.outputPath, cookieFileContent, { encoding: 'utf-8', mode: 0o600 });
      chmodSync(plan.outputPath, 0o600);

      process.stderr.write(
        `Cookies written to ${plan.outputPath} with mode 0600. Use with: SAP_COOKIE_FILE=${plan.outputPath} SAP_URL=${plan.url} arc-1. Rotate regularly — cookies expire.\n`,
      );
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // No top-level await: the single-executable bundle is CommonJS, which cannot contain one.
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(message === PP_REFUSAL_MESSAGE ? 2 : 1);
  });
}
