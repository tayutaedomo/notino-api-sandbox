const nock = require('nock');
const { appendFileSync } = require('node:fs');
const { page, block, list } = require('./fixtures.cjs');
nock.disableNetConnect();
nock.enableNetConnect(/^127\.0\.0\.1(:\d+)?$/);
require('node:test').mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T00:00:00Z') });
const log = process.env.NOTION_TEST_LOG;
const scope = nock('https://api.notion.com').persist();
scope.get(/\/v1\/databases\/.+/).reply(uri => [200, { object: 'database', id: uri.split('/').pop(), data_sources: [{ id: 'ds-' + uri.split('/').pop() }] }]);
scope.post('/v1/pages').reply(function(uri, body) {
  const data = /** @type {{parent: {database_id?: string, data_source_id?: string}, properties: Record<string, any>}} */ (body);
  const db = data.parent.data_source_id?.replace(/^ds-/, '') || data.parent.database_id;
  if (log) appendFileSync(log, JSON.stringify({ db, body }) + '\n');
  return db === process.env.NOTION_TEST_FAIL_DB || process.env.NOTION_TEST_SCENARIO === 'api-error'
    ? [403, { object: 'error', status: 403, code: 'restricted_resource', message: 'Denied' }]
    : [200, page('created-' + db, data.properties)];
});
if (process.env.NOTION_TEST_SCENARIO) {
  scope.get('/v1/users').query(true).reply(200, list([{ object: 'user', id: 'user' }]));
  scope.post('/v1/search').reply(200, list([{ object: 'data_source', id: 'ds-db', title: [] }]));
  scope.get(/\/v1\/data_sources\/.+/).reply(200, { object: 'data_source', title: [], properties: { Name: { type: 'title', id: 'title' } } });
  scope.post(/\/v1\/data_sources\/.+\/query/).reply(() => [200, list(process.env.NOTION_TEST_SCENARIO === 'empty-copy' ? [] : [page('source', { Name: { type: 'title', title: [{ type: 'text', text: { content: 'Retro', link: null } }] } })])]);
  scope.get('/v1/pages/source').reply(200, page('source'));
  scope.get('/v1/blocks/source/children').query(true).reply(200, list([block()]));
  scope.patch(/\/v1\/blocks\/.+\/children/).reply(200, list([{ object: 'block', id: 'created-block' }]));
}
