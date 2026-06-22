const endpoints = {
  overview: '/ui/api/overview',
  config: '/ui/api/config',
  safety: '/ui/api/safety',
  features: '/ui/api/features',
  cacheStats: '/ui/api/cache/stats',
  cacheSources: '/ui/api/cache/sources',
  logs: '/ui/api/logs',
  docs: '/ui/api/docs',
};

const state = {
  token: sessionStorage.getItem('arc1.ui.token') || '',
  tab: 'overview',
  refreshTimer: undefined,
  refreshInFlight: false,
};

const content = document.querySelector('#content');
const statusBox = document.querySelector('#status');
const tokenInput = document.querySelector('#token');
const subtitle = document.querySelector('#subtitle');

tokenInput.value = state.token;

document.querySelector('#save-token').addEventListener('click', () => {
  state.token = tokenInput.value.trim();
  sessionStorage.setItem('arc1.ui.token', state.token);
  loadTab(state.tab);
});

document.querySelector('#clear-token').addEventListener('click', () => {
  state.token = '';
  tokenInput.value = '';
  sessionStorage.removeItem('arc1.ui.token');
  loadTab(state.tab);
});

for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
    loadTab(state.tab);
  });
}

loadTab(state.tab);

async function apiGet(path) {
  const headers = { Accept: 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error || body.reason || `${response.status} ${response.statusText}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return body;
}

async function loadTab(tab) {
  clearAutoRefresh();
  showStatus('');
  content.replaceChildren(panel('Loading', text('Fetching current state...')));
  try {
    if (tab === 'overview') renderOverview(await apiGet(endpoints.overview));
    if (tab === 'config') renderConfig(await apiGet(endpoints.config));
    if (tab === 'safety') renderObjectPanel('Safety Ceiling', await apiGet(endpoints.safety));
    if (tab === 'features') renderFeatures(await apiGet(endpoints.features));
    if (tab === 'cache') renderCache();
    if (tab === 'logs') renderLogs();
    if (tab === 'docs') renderDocs(await apiGet(endpoints.docs));
  } catch (error) {
    if (error.status === 401) showStatus('Authentication required.');
    content.replaceChildren(panel('Request Failed', codeBlock(error.message || String(error))));
  } finally {
    scheduleAutoRefresh();
  }
}

function scheduleAutoRefresh() {
  clearAutoRefresh();
  state.refreshTimer = window.setInterval(refreshActiveTab, 5000);
}

function clearAutoRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = undefined;
  }
}

async function refreshActiveTab() {
  if (state.refreshInFlight || document.hidden) return;
  state.refreshInFlight = true;
  try {
    await preserveScroll(async () => {
      if (state.tab === 'overview') renderOverview(await apiGet(endpoints.overview));
      if (state.tab === 'config') renderConfig(await apiGet(endpoints.config));
      if (state.tab === 'safety') renderObjectPanel('Safety Ceiling', await apiGet(endpoints.safety));
      if (state.tab === 'features') renderFeatures(await apiGet(endpoints.features));
      if (state.tab === 'cache') await refreshCache({ silent: true });
      if (state.tab === 'logs') await refreshLogs({ silent: true });
    });
  } catch (error) {
    if (error.status === 401) showStatus('Authentication required.');
  } finally {
    state.refreshInFlight = false;
  }
}

async function preserveScroll(action) {
  const top = window.scrollY;
  await action();
  window.requestAnimationFrame(() => {
    const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(top, maxTop));
  });
}

function renderOverview(data) {
  subtitle.textContent = `${data.app.version} - ${data.transport.type}`;
  content.replaceChildren(
    panel(
      'Runtime',
      metricGrid([
        ['Version', data.app.version],
        ['Uptime', `${data.app.uptimeSeconds}s`],
        ['Transport', data.transport.type],
        ['UI mode', data.transport.uiMode],
        ['SAP auth', sapAuthLabel(data.auth.sap)],
        ['Cache', data.cache.mode],
      ]),
    ),
    panel('Safety', keyValue(data.safety)),
    panel('Auth', keyValue(data.auth)),
  );
}

function renderConfig(data) {
  const cfg = data.config || {};
  const safety = cfg.safety || {};
  const auth = cfg.auth || {};
  const cache = cfg.cache || {};
  const features = cfg.features || {};

  content.replaceChildren(
    panel(
      'Configuration Summary',
      metricGrid([
        ['Transport', cfg.transport || ''],
        ['UI mode', cfg.uiMode || ''],
        ['Tool mode', cfg.toolMode || ''],
        ['Cache', cache.mode || ''],
        ['Writes', safety.allowWrites ? 'enabled' : 'blocked'],
        ['API keys', auth.apiKeys?.count ?? 0],
      ]),
    ),
    panel(
      'Connection',
      detailsList([
        ['SAP URL', cfg.url],
        ['SAP user', cfg.username],
        ['Client', cfg.client],
        ['Language', cfg.language],
        ['TLS verification', cfg.insecure ? 'skipped' : 'enabled'],
        ['Cookie file', cfg.cookieFile || 'none'],
        ['Cookie string', cfg.cookieString],
      ]),
    ),
    panel(
      'Safety Gates',
      statusGrid([
        ['Writes', safety.allowWrites, safety.allowWrites ? 'warn' : 'ok'],
        ['Data preview', safety.allowDataPreview, safety.allowDataPreview ? 'warn' : 'ok'],
        ['Free SQL', safety.allowFreeSQL, safety.allowFreeSQL ? 'warn' : 'ok'],
        ['Transport writes', safety.allowTransportWrites, safety.allowTransportWrites ? 'warn' : 'ok'],
        ['Git writes', safety.allowGitWrites, safety.allowGitWrites ? 'warn' : 'ok'],
        ['Read-only default', safety.readOnlyDefault, safety.readOnlyDefault ? 'ok' : 'warn'],
      ]),
      detailsList([
        ['Allowed packages', safety.allowedPackages],
        ['Allowed transports', safety.allowedTransports],
        ['Denied actions', safety.denyActions],
      ]),
    ),
    panel(
      'Feature Toggles',
      statusGrid(Object.entries(features).map(([name, value]) => [featureLabel(name), value, value ? 'ok' : ''])),
    ),
    panel(
      'Auth & Principal Propagation',
      statusGrid([
        ['Basic SAP auth', auth.sap?.basic, auth.sap?.basic ? 'ok' : ''],
        ['Cookie auth', auth.sap?.cookieFile || auth.sap?.cookieString, auth.sap?.cookieFile || auth.sap?.cookieString ? 'ok' : ''],
        ['BTP service key', auth.sap?.btpServiceKey, auth.sap?.btpServiceKey ? 'ok' : ''],
        ['Destination', auth.sap?.destination, auth.sap?.destination ? 'ok' : ''],
        ['OIDC', auth.oidc?.configured, auth.oidc?.configured ? 'ok' : ''],
        ['XSUAA', auth.xsuaa?.enabled, auth.xsuaa?.enabled ? 'ok' : ''],
        ['Principal propagation', cfg.principalPropagation?.enabled, cfg.principalPropagation?.enabled ? 'ok' : ''],
      ]),
      detailsList([
        ['API key profiles', auth.apiKeys?.profiles],
        ['OIDC issuer', auth.oidc?.issuer || 'none'],
        ['OIDC audience', auth.oidc?.audience || 'none'],
        ['XSUAA DCR TTL', auth.xsuaa?.dcrTtlSeconds],
        ['PP strict', cfg.principalPropagation?.strict],
        ['PP shared cookies', cfg.principalPropagation?.allowSharedCookies],
      ]),
    ),
    panel(
      'Runtime & Cache',
      detailsList([
        ['HTTP address', cfg.httpAddr],
        ['UI address', cfg.uiAddr],
        ['Open UI on startup', cfg.uiOpen],
        ['Cache file', cache.file],
        ['Cache warmup', cache.warmup],
        ['Cache warmup packages', cache.warmupPackages],
        ['Max concurrent SAP requests', cfg.concurrency?.maxConcurrent],
        ['Auth rate limit', cfg.rateLimiting?.authRateLimit],
        ['MCP rate limit', cfg.rateLimiting?.mcpRateLimit],
        ['Allowed origins', cfg.browser?.allowedOrigins],
      ]),
    ),
    panel('Config Sources', configSourceTable(data.sources || {})),
  );
}

function renderFeatures(data) {
  const featureEntries = Object.entries(data || {}).filter(([, value]) => isFeatureStatus(value));
  const available = featureEntries.filter(([, value]) => value.available).length;
  const unavailable = featureEntries.length - available;
  const authProbe = data?.authProbe || {};

  if (data?.probed === false || featureEntries.length === 0) {
    content.replaceChildren(
      panel('Feature State', metricGrid([['Probed', 'no']]), detailsList([['Message', data?.message || 'No feature data yet.']])),
    );
    return;
  }

  content.replaceChildren(
    panel(
      'Feature Summary',
      metricGrid([
        ['Available', available],
        ['Unavailable', unavailable],
        ['SAP release', data.abapRelease || 'unknown'],
        ['System type', data.systemType || 'unknown'],
        ['Discovery endpoints', data.discovery?.endpointCount ?? 0],
        ['Text search', data.textSearch?.available ? 'available' : 'unavailable'],
      ]),
      chartGrid([
        barChart('Feature Availability', [
          ['Available', available, 'ok'],
          ['Unavailable', unavailable, unavailable > 0 ? 'warn' : ''],
        ]),
        barChart(
          'Configured Modes',
          countRows(featureEntries.map(([, value]) => value.mode || 'unknown')),
        ),
      ]),
    ),
    panel(
      'Feature Details',
      table(
        ['Feature', 'Available', 'Mode', 'Message', 'Probed At'],
        featureEntries.map(([name, value]) => [
          featureLabel(name),
          pill(value.available ? 'yes' : 'no', value.available ? 'ok' : 'warn'),
          value.mode || '',
          value.message || '',
          value.probedAt || '',
        ]),
      ),
    ),
    panel(
      'Search & Authorization',
      statusGrid([
        ['Text search', data.textSearch?.available, data.textSearch?.available ? 'ok' : 'warn'],
        ['Search auth', authProbe.searchAccess, authProbe.searchAccess ? 'ok' : 'warn'],
        ['Transport auth', authProbe.transportAccess, authProbe.transportAccess ? 'ok' : 'warn'],
      ]),
      detailsList([
        ['Text search reason', data.textSearch?.reason || 'none'],
        ['Search auth reason', authProbe.searchReason || 'none'],
        ['Transport auth reason', authProbe.transportReason || 'none'],
      ]),
    ),
  );
}

async function renderCache() {
  const container = document.createElement('div');
  container.className = 'content';
  const statsResult = document.createElement('div');
  statsResult.id = 'cache-stats-result';

  const sourceResult = document.createElement('div');
  sourceResult.id = 'cache-source-result';
  const activityResult = document.createElement('div');
  activityResult.id = 'cache-activity-result';
  container.append(
    panel('Cache Stats', statsResult),
    panel('Source Metadata', cacheSourceControls()),
    panel('Source Entries', sourceResult),
    panel('Recent Cache Activity', activityResult),
  );
  content.replaceChildren(container);
  await refreshCache();
}

async function refreshCache(options = {}) {
  await refreshCacheStats();
  await refreshCacheSources(options);
}

async function refreshCacheStats() {
  const target = document.querySelector('#cache-stats-result');
  const activityTarget = document.querySelector('#cache-activity-result');
  if (!target || !activityTarget) return;
  try {
    const stats = await apiGet(endpoints.cacheStats);
    if (!stats.enabled) {
      target.replaceChildren(objectView(stats));
      activityTarget.replaceChildren(text('Cache is disabled.'));
      return;
    }

    const activityCounts = stats.activity?.counts || {};
    target.replaceChildren(
      metricGrid([
        ['Backend', stats.backend?.effective || stats.mode],
        ['Persistence', stats.backend?.persistent ? 'persistent' : 'ephemeral'],
        ['Nodes', stats.stats.nodeCount],
        ['Edges', stats.stats.edgeCount],
        ['APIs', stats.stats.apiCount],
        ['Sources', stats.stats.sourceCount],
        ['Contracts', stats.stats.contractCount],
        ['Warmup', stats.warmup?.available ? 'available' : 'not available'],
        ['Invalidations', activityCounts.source_invalidate || 0],
        ['Evictions', activityCounts.source_evict || 0],
        ['Cache hits', activityCounts.source_hit || 0],
        ['Cache misses', activityCounts.source_miss || 0],
      ]),
      chartGrid([
        barChart('Source Types', objectRows(stats.sources?.byType || {})),
        barChart('Source Versions', objectRows(stats.sources?.byVersion || {})),
        barChart('Cache Activity', objectRows(activityCounts, cacheEventLabel)),
      ]),
      detailsList([
        ['Mode', stats.mode],
        ['Cache file', stats.backend?.file || 'none'],
        ['Warmup configured', stats.warmup?.configured ? 'yes' : 'no'],
        ['Warmup packages', stats.warmup?.packages || 'all configured packages'],
        ['Inactive-list users', stats.inactiveLists?.userCount ?? 0],
        ['Inactive-list entries', stats.inactiveLists?.totalEntries ?? 0],
        ['Source inventory', sourceInventoryLabel(stats.sources)],
      ]),
    );

    const activityItems = stats.activity?.items || [];
    activityTarget.replaceChildren(
      table(
        ['Time', 'Event', 'Object', 'Version', 'Detail'],
        activityItems.map((item) => [
          item.timestamp,
          item.event,
          cacheObjectLabel(item),
          item.version || '',
          cacheActivityDetail(item),
        ]),
      ),
      text(`${activityItems.length} of ${stats.activity?.total ?? 0} events`),
    );
  } catch (error) {
    target.replaceChildren(codeBlock(error.message || String(error)));
    activityTarget.replaceChildren(codeBlock(error.message || String(error)));
  }
}

function cacheSourceControls() {
  const wrap = document.createElement('div');
  wrap.className = 'filters';
  wrap.append(
    labeledInput('objectType', 'Type', 'CLAS'),
    labeledInput('q', 'Name', 'ZCL_'),
    labeledSelect('version', 'Version', [
      ['', 'Any'],
      ['active', 'Active'],
      ['inactive', 'Inactive'],
    ]),
    labeledInput('limit', 'Limit', '50'),
    actionButton('Refresh', () => refreshCacheSources()),
  );
  return wrap;
}

async function refreshCacheSources(options = {}) {
  const target = document.querySelector('#cache-source-result');
  if (!target) return;
  if (!options.silent) target.replaceChildren(text('Loading cache source metadata...'));
  try {
    const params = new URLSearchParams();
    for (const name of ['objectType', 'q', 'version', 'limit']) {
      const value = document.querySelector(`#${name}`)?.value.trim();
      if (value) params.set(name, value);
    }
    const data = await apiGet(`${endpoints.cacheSources}?${params.toString()}`);
    if (data.enabled === false) {
      target.replaceChildren(objectView(data));
      return;
    }
    target.replaceChildren(
      table(
        ['Type', 'Name', 'Version', 'Hash', 'ETag', 'Cached At', 'Length'],
        data.items.map((item) => [
          item.objectType,
          item.objectName,
          item.version,
          item.hash.slice(0, 12),
          item.etagPresent ? 'yes' : 'no',
          item.cachedAt,
          item.sourceLength,
        ]),
      ),
      text(`${data.items.length} of ${data.total} entries`),
    );
  } catch (error) {
    target.replaceChildren(codeBlock(error.message || String(error)));
  }
}

function sourceInventoryLabel(sources) {
  if (!sources) return 'unavailable';
  const sampled = sources.sampled ? `, sampled ${sources.sampleSize}` : '';
  const etags = `${sources.etagCount || 0} with ETag`;
  const newest = sources.newestCachedAt ? `, newest ${sources.newestCachedAt}` : '';
  return `${sources.total} entries${sampled}, ${etags}${newest}`;
}

function cacheObjectLabel(item) {
  if (!item.objectType && !item.objectName) return '';
  return `${item.objectType || ''} ${item.objectName || ''}`.trim();
}

function cacheActivityDetail(item) {
  const parts = [];
  if (item.removed !== undefined) parts.push(`removed ${item.removed}`);
  if (item.sourceLength !== undefined) parts.push(`${item.sourceLength} chars`);
  if (item.etagPresent !== undefined) parts.push(item.etagPresent ? 'ETag' : 'no ETag');
  if (item.hash) parts.push(`hash ${item.hash.slice(0, 12)}`);
  if (item.detail) parts.push(item.detail);
  return parts.join(', ');
}

async function renderLogs() {
  const controls = document.createElement('div');
  controls.className = 'filters';
  controls.append(
    labeledInput('log-event', 'Event', 'tool_call_end'),
    labeledSelect('log-level', 'Level', [
      ['', 'Any'],
      ['debug', 'Debug'],
      ['info', 'Info'],
      ['warn', 'Warn'],
      ['error', 'Error'],
    ]),
    labeledInput('log-limit', 'Limit', '100'),
    actionButton('Refresh', () => refreshLogs()),
  );
  const summary = document.createElement('div');
  summary.id = 'logs-summary-result';
  const result = document.createElement('div');
  result.id = 'logs-result';
  content.replaceChildren(panel('Audit Events', controls), panel('Log Overview', summary), panel('Audit Event Stream', result));
  await refreshLogs();
}

async function refreshLogs(options = {}) {
  const target = document.querySelector('#logs-result');
  const summaryTarget = document.querySelector('#logs-summary-result');
  if (!target) return;
  if (!options.silent) target.replaceChildren(text('Loading audit events...'));
  try {
    const params = new URLSearchParams();
    const event = document.querySelector('#log-event')?.value.trim();
    const level = document.querySelector('#log-level')?.value.trim();
    const limit = document.querySelector('#log-limit')?.value.trim();
    if (event) params.set('event', event);
    if (level) params.set('level', level);
    if (limit) params.set('limit', limit);
    const data = await apiGet(`${endpoints.logs}?${params.toString()}`);
    if (summaryTarget) summaryTarget.replaceChildren(logSummary(data));
    target.replaceChildren(
      table(
        ['Time', 'Level', 'Event', 'Request', 'Detail'],
        data.items.map((item) => [
          item.timestamp,
          item.level,
          item.event,
          item.requestId || '',
          compactLogDetail(item),
        ]),
      ),
      text(`${data.items.length} of ${data.total} events`),
    );
  } catch (error) {
    target.replaceChildren(codeBlock(error.message || String(error)));
    if (summaryTarget) summaryTarget.replaceChildren(codeBlock(error.message || String(error)));
  }
}

function renderDocs(data) {
  const list = document.createElement('div');
  list.className = 'kv';
  for (const link of data.links) {
    const label = document.createElement('div');
    label.textContent = link.label;
    const value = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = link.href;
    value.append(anchor);
    list.append(label, value);
  }
  content.replaceChildren(panel('Documentation', list));
}

function renderObjectPanel(title, data) {
  content.replaceChildren(panel(title, objectView(data)));
}

function panel(title, ...children) {
  const section = document.createElement('section');
  section.className = 'panel';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.append(heading, ...children);
  return section;
}

function metricGrid(items) {
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const [label, value] of items) {
    const item = document.createElement('div');
    item.className = 'metric';
    const strong = document.createElement('strong');
    strong.textContent = String(value ?? '');
    const span = document.createElement('span');
    span.textContent = label;
    item.append(strong, span);
    grid.append(item);
  }
  return grid;
}

function chartGrid(charts) {
  const grid = document.createElement('div');
  grid.className = 'chart-grid';
  grid.append(...charts);
  return grid;
}

function barChart(title, rows) {
  const chart = document.createElement('div');
  chart.className = 'chart';
  const heading = document.createElement('h3');
  heading.textContent = title;
  chart.append(heading);

  const cleanRows = rows
    .map(([label, value, status]) => [label, Number(value) || 0, status || ''])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (cleanRows.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No data yet.';
    chart.append(empty);
    return chart;
  }

  const max = Math.max(...cleanRows.map(([, value]) => value));
  for (const [label, value, status] of cleanRows) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const name = document.createElement('div');
    name.className = 'bar-label';
    name.textContent = String(label);
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = `bar-fill ${status || ''}`.trim();
    fill.style.width = `${Math.max(4, Math.round((value / max) * 100))}%`;
    track.append(fill);
    const count = document.createElement('div');
    count.className = 'bar-value';
    count.textContent = String(value);
    row.append(name, track, count);
    chart.append(row);
  }
  return chart;
}

function statusGrid(items) {
  const grid = document.createElement('div');
  grid.className = 'status-grid';
  for (const [label, value, status] of items) {
    const item = document.createElement('div');
    item.className = 'status-item';
    const name = document.createElement('span');
    name.textContent = label;
    const rendered = typeof value === 'boolean' ? pill(value ? 'enabled' : 'disabled', value ? status || 'ok' : '') : renderInlineValue(value);
    item.append(name, rendered);
    grid.append(item);
  }
  return grid;
}

function keyValue(data) {
  const wrap = document.createElement('div');
  wrap.className = 'kv';
  for (const [key, value] of Object.entries(data || {})) {
    const name = document.createElement('div');
    name.textContent = key;
    const val = document.createElement('div');
    val.append(renderValue(value));
    wrap.append(name, val);
  }
  return wrap;
}

function detailsList(items) {
  const wrap = document.createElement('div');
  wrap.className = 'kv';
  for (const [key, value] of items) {
    const name = document.createElement('div');
    name.textContent = key;
    const val = document.createElement('div');
    val.append(renderInlineValue(value));
    wrap.append(name, val);
  }
  return wrap;
}

function objectView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return renderValue(value);
  }
  return keyValue(value);
}

function renderValue(value) {
  if (value === null || value === undefined) return text('');
  if (typeof value === 'boolean') return pill(value ? 'true' : 'false', value ? 'ok' : '');
  if (typeof value === 'number') return text(String(value));
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return text(value.join(', '));
  return codeBlock(JSON.stringify(value, null, 2));
}

function renderInlineValue(value) {
  if (value instanceof Node) return value;
  if (value === null || value === undefined || value === '') return text('none');
  if (typeof value === 'boolean') return pill(value ? 'yes' : 'no', value ? 'ok' : '');
  if (typeof value === 'number') return text(String(value));
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return text(value.length ? value.join(', ') : 'none');
  if (typeof value === 'object' && 'configured' in value) {
    return pill(value.configured ? 'configured' : 'not configured', value.configured ? 'ok' : '');
  }
  if (typeof value === 'object') {
    return text(
      Object.entries(value)
        .map(([key, nested]) => `${key}: ${formatPrimitive(nested)}`)
        .join(', ') || 'none',
    );
  }
  return text(String(value));
}

function formatPrimitive(value) {
  if (value === null || value === undefined || value === '') return 'none';
  if (Array.isArray(value)) return value.join(', ') || 'none';
  if (typeof value === 'object' && 'configured' in value) return value.configured ? 'configured' : 'not configured';
  if (typeof value === 'object') return 'configured';
  return String(value);
}

function table(headers, rows) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const tableElement = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const header of headers) {
    const th = document.createElement('th');
    th.textContent = header;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.append(cell instanceof Node ? cell : text(String(cell ?? '')));
      tr.append(td);
    }
    tbody.append(tr);
  }
  tableElement.append(thead, tbody);
  wrap.append(tableElement);
  return wrap;
}

function labeledInput(id, label, defaultValue = '') {
  const wrap = document.createElement('label');
  wrap.append(text(label));
  const input = document.createElement('input');
  input.id = id;
  input.value = defaultValue;
  input.spellcheck = false;
  wrap.append(input);
  return wrap;
}

function labeledSelect(id, label, options) {
  const wrap = document.createElement('label');
  wrap.append(text(label));
  const select = document.createElement('select');
  select.id = id;
  for (const [value, textValue] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = textValue;
    select.append(option);
  }
  wrap.append(select);
  return wrap;
}

function actionButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function text(value) {
  return document.createTextNode(value);
}

function codeBlock(value) {
  const pre = document.createElement('pre');
  pre.textContent = value;
  return pre;
}

function pill(value, status) {
  const span = document.createElement('span');
  span.className = `pill ${status || ''}`.trim();
  span.textContent = value;
  return span;
}

function showStatus(message) {
  statusBox.hidden = !message;
  statusBox.textContent = message;
}

function sapAuthLabel(sap) {
  if (sap.principalPropagation) return 'principal propagation';
  if (sap.btpServiceKey) return 'btp service key';
  if (sap.destination) return 'btp destination';
  if (sap.cookieFile || sap.cookieString) return 'cookie';
  if (sap.basic) return 'basic';
  return 'none';
}

function compactLogDetail(item) {
  const clone = { ...item };
  for (const key of ['timestamp', 'level', 'event', 'requestId']) delete clone[key];
  return JSON.stringify(clone);
}

function logSummary(data) {
  const items = data.items || [];
  const toolCalls = items.filter((item) => item.event === 'tool_call_end');
  const avgDuration = average(toolCalls.map((item) => item.durationMs).filter((value) => typeof value === 'number'));
  const fragment = document.createDocumentFragment();
  fragment.append(
    metricGrid([
      ['Events shown', items.length],
      ['Matching total', data.total ?? items.length],
      ['Tool calls', toolCalls.length],
      ['Errors', toolCalls.filter((item) => item.status === 'error').length],
      ['Avg tool duration', avgDuration === undefined ? 'n/a' : `${Math.round(avgDuration)}ms`],
      ['Slowest tool', slowestToolLabel(toolCalls)],
    ]),
    chartGrid([
      barChart('Tool Calls by Tool', countRows(toolCalls.map((item) => item.tool || 'unknown'))),
      barChart('Tool Call Status', countRows(toolCalls.map((item) => item.status || 'unknown'), statusForLabel)),
      barChart('Event Mix', countRows(items.map((item) => item.event || 'unknown'))),
      barChart('Level Mix', countRows(items.map((item) => item.level || 'unknown'), statusForLabel)),
    ]),
    slowestCallsTable(toolCalls),
  );
  return fragment;
}

function slowestCallsTable(toolCalls) {
  const rows = [...toolCalls]
    .filter((item) => typeof item.durationMs === 'number')
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((item) => [item.timestamp, item.tool || '', item.status || '', item.durationMs, item.requestId || '']);
  if (rows.length === 0) return text('No timed tool calls in the current log slice.');
  return table(['Time', 'Tool', 'Status', 'Duration', 'Request'], rows);
}

function slowestToolLabel(toolCalls) {
  const slowest = [...toolCalls].filter((item) => typeof item.durationMs === 'number').sort((a, b) => b.durationMs - a.durationMs)[0];
  return slowest ? `${slowest.tool || 'unknown'} ${slowest.durationMs}ms` : 'n/a';
}

function objectRows(obj, labeler = (label) => label) {
  return Object.entries(obj || {}).map(([label, value]) => [labeler(label), Number(value) || 0, statusForLabel(label)]);
}

function countRows(values, statusMapper = () => '') {
  const counts = {};
  for (const value of values) {
    const label = String(value || 'unknown');
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts).map(([label, value]) => [label, value, statusMapper(label)]);
}

function average(values) {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function statusForLabel(label) {
  const normalized = String(label).toLowerCase();
  if (['success', 'info', 'available', 'ok'].includes(normalized)) return 'ok';
  if (['error', 'warn', 'warning', 'unavailable', 'disabled'].includes(normalized)) return 'warn';
  return '';
}

function cacheEventLabel(event) {
  return (
    {
      source_miss: 'Source miss',
      source_hit: 'Source hit',
      source_refresh: 'Source refresh',
      source_invalidate: 'Invalidation',
      source_evict: 'Eviction',
      depgraph_hit: 'Dep graph hit',
      depgraph_store: 'Dep graph store',
      func_group_hit: 'Function group hit',
      func_group_store: 'Function group store',
      warmup_state: 'Warmup state',
    }[event] || event
  );
}

function isFeatureStatus(value) {
  return value && typeof value === 'object' && typeof value.available === 'boolean' && 'mode' in value;
}

function featureLabel(name) {
  const labels = {
    abapGit: 'abapGit',
    gcts: 'gCTS',
    rap: 'RAP/CDS',
    amdp: 'AMDP',
    ui5: 'UI5/Fiori BSP',
    ui5repo: 'UI5 repository',
    flp: 'FLP customization',
    hana: 'HANA',
    transport: 'CTS transport',
  };
  return labels[name] || String(name).replace(/([a-z])([A-Z])/g, '$1 $2');
}

function configSourceTable(sources) {
  const rows = Object.entries(sources || {}).map(([key, source]) => [key, configSourceLabel(source)]);
  if (rows.length === 0) return text('No non-default configuration sources recorded.');
  return table(['Option', 'Source'], rows);
}

function configSourceLabel(source) {
  if (!source || typeof source !== 'object') return String(source || 'default');
  return Object.entries(source)
    .map(([kind, value]) => `${kind}: ${value}`)
    .join(', ');
}
