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
    if (tab === 'features') renderObjectPanel('Feature State', await apiGet(endpoints.features));
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
    if (state.tab === 'overview') renderOverview(await apiGet(endpoints.overview));
    if (state.tab === 'config') renderConfig(await apiGet(endpoints.config));
    if (state.tab === 'safety') renderObjectPanel('Safety Ceiling', await apiGet(endpoints.safety));
    if (state.tab === 'features') renderObjectPanel('Feature State', await apiGet(endpoints.features));
    if (state.tab === 'cache') await refreshCache();
    if (state.tab === 'logs') await refreshLogs();
  } catch (error) {
    if (error.status === 401) showStatus('Authentication required.');
  } finally {
    state.refreshInFlight = false;
  }
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
  content.replaceChildren(panel('Effective Configuration', objectView(data.config)), panel('Sources', objectView(data.sources)));
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

async function refreshCache() {
  await refreshCacheStats();
  await refreshCacheSources();
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
      detailsList([
        ['Mode', stats.mode],
        ['Cache file', stats.backend?.file || 'none'],
        ['Warmup configured', stats.warmup?.configured ? 'yes' : 'no'],
        ['Warmup packages', stats.warmup?.packages || 'all configured packages'],
        ['Inactive-list users', stats.inactiveLists?.userCount ?? 0],
        ['Inactive-list entries', stats.inactiveLists?.totalEntries ?? 0],
        ['Source inventory', sourceInventoryLabel(stats.sources)],
      ]),
      sourceBreakdown(stats.sources),
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
    actionButton('Refresh', refreshCacheSources),
  );
  return wrap;
}

async function refreshCacheSources() {
  const target = document.querySelector('#cache-source-result');
  if (!target) return;
  target.replaceChildren(text('Loading cache source metadata...'));
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

function sourceBreakdown(sources) {
  if (!sources || sources.total === 0) return text('No cached source entries yet.');
  const rows = [];
  for (const [type, count] of Object.entries(sources.byType || {})) {
    rows.push([type, count]);
  }
  return table(['Source Type', 'Entries'], rows);
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
    actionButton('Refresh', refreshLogs),
  );
  const result = document.createElement('div');
  result.id = 'logs-result';
  result.className = 'panel';
  content.replaceChildren(panel('Audit Events', controls), result);
  await refreshLogs();
}

async function refreshLogs() {
  const target = document.querySelector('#logs-result');
  if (!target) return;
  target.replaceChildren(text('Loading audit events...'));
  try {
    const params = new URLSearchParams();
    const event = document.querySelector('#log-event')?.value.trim();
    const level = document.querySelector('#log-level')?.value.trim();
    const limit = document.querySelector('#log-limit')?.value.trim();
    if (event) params.set('event', event);
    if (level) params.set('level', level);
    if (limit) params.set('limit', limit);
    const data = await apiGet(`${endpoints.logs}?${params.toString()}`);
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
    val.textContent = String(value ?? '');
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
      td.append(typeof cell === 'string' || typeof cell === 'number' ? text(String(cell)) : cell);
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
