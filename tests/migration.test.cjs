const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');
const { api, page, client, resolve } = require('./helpers/fixtures.cjs');
const { createNotionClient, resolveDataSource } = require('../functions/lib/notion_client');
const { createPage } = require('../functions/lib/notion_create_page');
nock.disableNetConnect();
afterEach(() => { delete process.env.NOTION_DATA_SOURCE_MAP; const pending = nock.pendingMocks(); nock.cleanAll(); assert.deepEqual(pending, []); });
test('最新APIヘッダーとデータソース親', async () => {
  nock('https://api.notion.com', { reqheaders: { 'Notion-Version': '2026-03-11' } }).get('/v1/databases/db').reply(200, { object: 'database', data_sources: [{ id: 'ds-db' }] });
  nock('https://api.notion.com', { reqheaders: { 'Notion-Version': '2026-03-11' } }).post('/v1/pages', body => { assert.equal(body.parent.data_source_id, 'ds-db'); return true; }).reply(200, page('new'));
  assert.equal((await createPage(client(), 'db', 'Retro')).newPage.id, 'new');
});
test('複数のデータソースは明示指定', async () => {
  process.env.NOTION_DATA_SOURCE_MAP = JSON.stringify({ db: 'second' });
  api().get('/v1/databases/db').reply(200, { object: 'database', data_sources: [{ id: 'first' }, { id: 'second' }] });
  assert.equal(await resolveDataSource(client(), 'db'), 'second');
});
for (const sources of [[], [{ id: 'first' }, { id: 'second' }]]) {
  test('対象を特定できなければ書き込まない: ' + sources.length, async () => {
    api().get('/v1/databases/db').reply(200, { object: 'database', data_sources: sources });
    await assert.rejects(createPage(client(), 'db', 'Retro'), /data source/i);
  });
}
test('DBに属さない指定は拒否', async () => {
  process.env.NOTION_DATA_SOURCE_MAP = JSON.stringify({ db: 'foreign' }); resolve();
  await assert.rejects(createPage(client(), 'db', 'Retro'), /does not belong/);
});
for (const mapping of ['{bad', '[]', '{"db":123}', 'null']) {
  test('不正なマップはAPI接続前に拒否: ' + mapping, async () => {
    process.env.NOTION_DATA_SOURCE_MAP = mapping;
    await assert.rejects(createPage(client(), 'db', 'Retro'), /NOTION_DATA_SOURCE_MAP/);
  });
}
for (const [status, code] of [[401, 'unauthorized'], [403, 'restricted_resource'], [429, 'rate_limited'], [500, 'internal_server_error']]) {
  test('APIエラーを再試行せず伝える: ' + status, async () => {
    let calls = 0; resolve();
    api().persist().post('/v1/pages').reply(() => { calls++; return [status, { object: 'error', status, code, message: 'Test error' }]; });
    await assert.rejects(createPage(client(), 'db', 'Retro'), e => e instanceof Error && 'code' in e && e.code === code);
    assert.equal(calls, 1);
  });
}
test('タイムアウトを再試行しない', async () => {
  let calls = 0;
  const notion = createNotionClient('test-key', { timeoutMs: 20, fetch: () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(notion.users.list({}), e => e instanceof Error && 'code' in e && e.code === 'notionhq_client_request_timeout');
  assert.equal(calls, 1);
});

test('rich_textプロパティの検索は型に合うフィルターを使う', async () => {
  const { schema, list } = require('./helpers/fixtures.cjs');
  const { copyPage } = require('../functions/lib/notion_copy_page');
  resolve(); schema('rich_text', 'Text');
  api().post('/v1/data_sources/ds-db/query', body => { assert.deepEqual(body.filter, { property: 'Text', rich_text: { contains: 'needle' } }); assert.equal(body.sorts[0].direction, 'ascending'); return true; }).reply(200, list([page()]));
  api().get('/v1/blocks/source/children').query(true).reply(200, list([]));
  api().post('/v1/pages').reply(200, page('new'));
  await copyPage('test-key', { databaseId: 'db', searchProperty: 'Text', searchValue: 'needle', sortProperty: 'Name', sortDirection: 'ascending' });
});

for (const type of ['number', 'missing']) {
  test('検索できないプロパティは書き込み前に拒否: ' + type, async () => {
    const { schema } = require('./helpers/fixtures.cjs');
    const { copyPage } = require('../functions/lib/notion_copy_page');
    resolve(); schema(type);
    await assert.rejects(copyPage('test-key', { databaseId: 'db', searchProperty: 'Name', searchValue: 'needle', sortProperty: 'Name' }), /Search property must/);
  });
}
