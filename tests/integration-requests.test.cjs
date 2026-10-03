const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const safety = require('../scripts/lib/integration_safety');
const { provisionAndVerify } = require('../scripts/integration');
const { verifyIntegration } = require('../scripts/verify_integration');
const { createNotionClient } = require('../functions/lib/notion_client');
const { createPage } = require('../functions/lib/notion_create_page');
const uuid = (n = 1) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
/** @param {any[]} results */
const list = (results = [], has_more = false) => ({ object: 'list', results, has_more, next_cursor: has_more ? 'next' : null });
/** @param {any[]} items */
const rich = items => items.map(item => ({ ...item, type: 'text', plain_text: item.text.content, text: { ...item.text, link: item.text.link || null }, annotations: {} }));
/** @param {{ reuse?: boolean, partial?: boolean, dirty?: boolean }} options */
async function scenario(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'notion-requests-'));
  const originalEnv = { ...process.env }; const originalFetch = globalThis.fetch;
  /** @type {Map<string, any>} */ const databases = new Map();
  /** @type {Map<string, any>} */ const pages = new Map();
  /** @type {Map<string, any[]>} */ const blocks = new Map();
  /** @type {Array<{method:string,endpoint:string}>} */ const calls = [];
  let blockNumber = 4000; let pageNumber = 3000;
  /** @param {string} parent @param {any} request @returns {any} */
  function addBlock(parent, request) {
    const type = request.type || Object.keys(request).find(key => !['object'].includes(key));
    const body = { ...request[type] }; const children = body.children || []; delete body.children;
    if (body.rich_text) body.rich_text = rich(body.rich_text);
    const value = { object: 'block', id: uuid(++blockNumber), type, has_children: children.length > 0, [type]: body };
    blocks.set(value.id, children.map((/** @type {any} */ child) => addBlock(value.id, child)));
    return value;
  }
  const transport = /** @type {typeof fetch} */ (async (input, init) => {
    const endpoint = new URL(String(input)).pathname; const method = init?.method || 'GET';
    const id = endpoint.split('/')[3]; const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method, endpoint });
    if (endpoint === '/v1/databases' && method === 'POST') {
      const index = databases.size + 1;
      const value = { object: 'database', id: uuid(1000 + index), parent: body.parent, title: rich(body.title), in_trash: false, data_sources: [{ id: uuid(2000 + index) }], properties: body.initial_data_source.properties };
      databases.set(value.id, value); return Response.json(options.partial ? { object: 'database', id: value.id } : value);
    }
    if (method === 'GET' && endpoint.startsWith('/v1/databases/')) return Response.json(databases.get(id));
    if (method === 'GET' && endpoint.startsWith('/v1/data_sources/')) {
      const database = [...databases.values()].find(value => value.data_sources[0].id === id);
      const properties = Object.fromEntries(Object.entries(database.properties).map(([name, value]) => {
        const type = Object.keys(/** @type {object} */(value))[0];
        return [name, { id: name === 'Name' ? 'title' : name, type, [type]: type === 'status' ? { options: [{ name: 'Not started' }] } : {} }];
      }));
      return Response.json({ object: 'data_source', id, properties });
    }
    if (method === 'POST' && endpoint.endsWith('/query')) {
      let results = [...pages.values()].filter(page => page.parent.data_source_id === id && !page.in_trash);
      if (options.dirty && !pages.size) results = Array.from({ length: body.start_cursor ? 1 : 101 }, () => ({ object: 'page', url: 'https://example.com/other', id: 'other', properties: {} }));
      if (body.filter) results = results.filter(page => page.properties.Name.title[0].plain_text.includes(body.filter.title.contains));
      return Response.json(list(results.slice(0, body.page_size), results.length > body.page_size));
    }
    if (method === 'POST' && endpoint === '/v1/pages') {
      const properties = Object.fromEntries(Object.entries(body.properties).map(([name, value]) => {
        const typed = /** @type {any} */(value); const type = typed.type || Object.keys(typed)[0];
        return [name, { id: name, type, [type]: type === 'title' ? rich(typed[type]) : typed[type] }];
      }));
      const value = { object: 'page', id: uuid(++pageNumber), url: 'https://example.com/test', parent: { type: 'data_source_id', ...body.parent }, properties, icon: null, cover: null, in_trash: false };
      pages.set(value.id, value); blocks.set(value.id, []); return Response.json(value);
    }
    if (method === 'GET' && endpoint.startsWith('/v1/pages/')) return Response.json(id === uuid() ? { object: 'page', id, url: 'https://example.com/parent', in_trash: false } : pages.get(id));
    if (method === 'PATCH' && endpoint.startsWith('/v1/pages/')) { const page = pages.get(id); page.in_trash = true; return Response.json(page); }
    if (method === 'GET' && endpoint.endsWith('/children')) return Response.json(list(blocks.get(id)));
    if (method === 'PATCH' && endpoint.endsWith('/children')) {
      const added = body.children.map((/** @type {any} */ request) => addBlock(id, request));
      blocks.get(id)?.push(...added);
      for (const children of blocks.values()) { const parent = children.find(block => block.id === id); if (parent) parent.has_children = true; }
      return Response.json(list(added));
    }
    throw new Error('Unexpected mock request: ' + method + ' ' + endpoint);
  });
  mock.method(safety, 'runCli', async (/** @type {string} */ file, /** @type {string} */ command, /** @type {string[]} */ args, /** @type {{env:NodeJS.ProcessEnv}} */ settings) => {
    assert.equal(command, 'yarn'); assert.deepEqual(args, ['all:create']);
    for (const [i, suffix] of ['Retro', 'Body', 'Sleep'].entries()) await createPage(createNotionClient('test-key'), settings.env['NOTION_DB_ID_' + (i + 1)] || '', suffix);
  });
  async function execute() {
    const file = safety.createRun(dir, uuid());
    const guard = new safety.IntegrationTransport(file, transport, { now: Date.now, sleep: async () => {} });
    globalThis.fetch = guard.fetch;
    process.env.NOTION_TEST_KEY = 'test-key'; process.env.NOTION_TEST_RUN_FILE = file;
    const start = calls.length;
    await createNotionClient('test-key').pages.retrieve({ page_id: uuid() });
    await provisionAndVerify(file, guard, 'test-key', async (ids, prepared) => {
      ids.forEach((id, i) => { process.env['NOTION_TEST_DB_ID_' + (i + 1)] = id; });
      await verifyIntegration(guard, prepared);
    });
    const state = safety.readState(file);
    assert.equal(state.counts.pages, 5); assert.equal(state.counts.blocks, 6);
    assert.equal(state.counts.cleanupRequests, 10); assert.equal(state.status, 'complete');
    assert.equal(state.counts.requests + state.counts.cleanupRequests, options.partial ? 54 : 50);
    assert.ok([...pages.values()].every(page => page.in_trash));
    return { file, calls: calls.slice(start) };
  }
  try {
    if (options.dirty) {
      await assert.rejects(execute());
      assert.equal(pages.size, 0);
      assert.equal(calls.filter(call => call.endpoint.endsWith('/query')).length, 1);
      return;
    }
    const first = await execute();
    assert.equal(first.calls.filter(call => call.method === 'GET' && call.endpoint.startsWith('/v1/data_sources/')).length, 5);
    assert.equal(first.calls.filter(call => call.method === 'GET' && call.endpoint.startsWith('/v1/databases/')).length, options.partial ? 8 : 4);
    if (options.reuse) {
      const state = safety.readState(first.file); state.startedAt = '2026-01-01T00:00:00Z'; writeFileSync(first.file, JSON.stringify(state));
      const second = await execute();
      assert.equal(second.calls.filter(call => call.method === 'POST' && call.endpoint === '/v1/databases').length, 0);
      assert.equal(second.calls.filter(call => call.method === 'GET' && call.endpoint.startsWith('/v1/databases/')).length, 8);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv); mock.restoreAll(); rmSync(dir, { recursive: true, force: true });
  }
}
test('実API確認の通常通信は初回も再利用も40件以内', () => scenario({ reuse: true }));
test('DB作成が部分レスポンスなら取得して所属を確認する', () => scenario({ partial: true }));
test('空でない検証DBは最初の照会で停止し全ページを取得しない', () => scenario({ dirty: true }));
