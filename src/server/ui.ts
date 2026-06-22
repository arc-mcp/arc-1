import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Express, Request } from 'express';
import express from 'express';
import helmet from 'helmet';
import type { CachingLayer } from '../cache/caching-layer.js';
import { logger } from './logger.js';
import type { ConfigSource, ServerConfig } from './types.js';
import type { UiLogBufferSink } from './ui-log-buffer.js';
import {
  buildUiOverview,
  sanitizeConfigForUi,
  sanitizeConfigSourcesForUi,
  sanitizeFeaturesForUi,
  sanitizeSafetyConfig,
} from './ui-state.js';

export interface UiServerDeps {
  config: ServerConfig;
  sources: Record<string, ConfigSource>;
  version: string;
  startedAt: string;
  cachingLayer?: CachingLayer;
  logBuffer?: UiLogBufferSink;
  getFeatures: () => unknown;
}

export function createUiApiRouter(deps: UiServerDeps): express.Router {
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'Read-only UI API accepts GET requests only.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/overview', (_req, res) => {
    res.json(buildUiOverview(deps.config, deps.version, deps.startedAt));
  });

  router.get('/config', (_req, res) => {
    res.json({
      config: sanitizeConfigForUi(deps.config),
      sources: sanitizeConfigSourcesForUi(deps.sources),
    });
  });

  router.get('/safety', (_req, res) => {
    res.json(sanitizeSafetyConfig(deps.config));
  });

  router.get('/features', (_req, res) => {
    res.json(sanitizeFeaturesForUi(deps.getFeatures()));
  });

  router.get('/cache/stats', (_req, res) => {
    if (!deps.cachingLayer) {
      res.json({ enabled: false, mode: deps.config.cacheMode });
      return;
    }
    res.json({
      enabled: true,
      mode: deps.config.cacheMode,
      warmupAvailable: deps.cachingLayer.isWarmupAvailable,
      stats: deps.cachingLayer.stats(),
      inactiveLists: deps.cachingLayer.inactiveLists.stats(),
    });
  });

  router.get('/cache/sources', (req, res) => {
    if (!deps.cachingLayer) {
      res.json({ enabled: false, mode: deps.config.cacheMode, total: 0, items: [] });
      return;
    }
    if (deps.config.ppEnabled) {
      res.status(403).json({
        enabled: false,
        reason:
          'Source cache inventory is disabled when principal propagation is enabled because cached object names may span multiple SAP users.',
      });
      return;
    }

    const version = stringQuery(req, 'version');
    res.json(
      deps.cachingLayer.listCachedSources({
        objectType: stringQuery(req, 'objectType')?.toUpperCase(),
        query: stringQuery(req, 'q'),
        version: version === 'active' || version === 'inactive' ? version : undefined,
        limit: numberQuery(req, 'limit'),
        offset: numberQuery(req, 'offset'),
      }),
    );
  });

  router.get('/logs', (req, res) => {
    res.json(
      deps.logBuffer?.list({
        event: stringQuery(req, 'event'),
        level: stringQuery(req, 'level'),
        requestId: stringQuery(req, 'requestId'),
        limit: numberQuery(req, 'limit'),
      }) ?? { total: 0, limit: numberQuery(req, 'limit') ?? 100, items: [] },
    );
  });

  router.get('/docs', (_req, res) => {
    res.json({
      links: [
        {
          label: 'Configuration reference',
          href: 'https://github.com/arc-mcp/arc-1/blob/main/docs_page/configuration-reference.md',
        },
        { label: 'Caching', href: 'https://github.com/arc-mcp/arc-1/blob/main/docs_page/caching.md' },
        {
          label: 'Security guide',
          href: 'https://github.com/arc-mcp/arc-1/blob/main/docs_page/security-guide.md',
        },
        {
          label: 'BTP Cloud Foundry deployment',
          href: 'https://github.com/arc-mcp/arc-1/blob/main/docs_page/btp-cloud-foundry-deployment.md',
        },
        { label: 'Docker deployment', href: 'https://github.com/arc-mcp/arc-1/blob/main/docs_page/docker.md' },
        {
          label: 'Local development',
          href: 'https://github.com/arc-mcp/arc-1/blob/main/docs_page/local-development.md',
        },
      ],
    });
  });

  return router;
}

export function mountUiStaticRoutes(app: Express): void {
  const assetDir = findUiAssetDir();
  app.get(/^\/ui$/, (_req, res) => res.redirect(302, '/ui/'));
  if (!assetDir) {
    app.get(/^\/ui\/(?!api(?:\/|$)).*$/, (_req, res) => {
      res.status(500).json({ error: 'UI assets were not found in this ARC-1 build.' });
    });
    return;
  }
  app.use('/ui', express.static(assetDir, { index: 'index.html', fallthrough: true }));
  app.get(/^\/ui\/(?!api(?:\/|$)).*$/, (_req, res) => {
    res.sendFile(`${assetDir}/index.html`);
  });
}

export async function startLocalUiServer(deps: UiServerDeps): Promise<HttpServer> {
  const { host, port } = parseBindAddr(deps.config.uiAddr);
  const app = express();
  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'"],
        },
      },
    }),
  );
  app.get('/', (_req, res) => res.redirect(302, '/ui/'));
  mountUiStaticRoutes(app);
  app.use('/ui/api', createUiApiRouter(deps));
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found. Use /ui for the ARC-1 read-only UI.' });
  });

  const server = await listen(app, host, port).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `UI port ${port} is already in use — change ARC1_UI_ADDR or ARC1_UI_PORT (for example ARC1_UI_PORT=8712)`,
        { port, host, code: err.code },
      );
    } else {
      logger.error('UI server failed to start', { error: err.message, code: err.code });
    }
    throw err;
  });
  const url = `http://${host}:${port}/ui/`;
  logger.info('ARC-1 read-only UI started', { url, mode: 'local' });
  if (deps.config.uiOpen) {
    openInBrowser(url);
  }
  return server;
}

function findUiAssetDir(): string | undefined {
  const candidates = [
    fileURLToPath(new URL('../../public/ui', import.meta.url)),
    fileURLToPath(new URL('../public/ui', import.meta.url)),
  ];
  return candidates.find((dir) => existsSync(`${dir}/index.html`));
}

function listen(app: Express, host: string, port: number): Promise<HttpServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.on('error', reject);
  });
}

function parseBindAddr(addr: string): { host: string; port: number } {
  const [hostPart, portPart] = addr.includes(':') ? addr.split(':') : ['127.0.0.1', addr];
  const port = Number.parseInt(portPart || '8711', 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ARC1_UI_ADDR '${addr}': port must be a number between 1 and 65535`);
  }
  return { host: hostPart || '127.0.0.1', port };
}

function openInBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : process.env.BROWSER || 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function stringQuery(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberQuery(req: Request, name: string): number | undefined {
  const value = stringQuery(req, name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
