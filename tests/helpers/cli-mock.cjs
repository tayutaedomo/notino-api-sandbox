const nock = require('nock');
const { appendFileSync } = require('node:fs');
nock.disableNetConnect();
require('node:test').mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T00:00:00Z') });
if (process.env.NOTION_TEST_LOG) {
  nock('https://api.notion.com').persist().get(/\/v1\/databases\/.+/).reply(uri => [200, { object: 'database', id: uri.split('/').pop(), data_sources: [{ id: 'ds-' + uri.split('/').pop() }] }]);
  nock('https://api.notion.com').persist().post('/v1/pages').reply(function(uri, body) {
    const db = body.parent.data_source_id?.replace(/^ds-/, '') || body.parent.database_id;
    appendFileSync(process.env.NOTION_TEST_LOG, JSON.stringify({ db, body }) + '\n');
    return db === process.env.NOTION_TEST_FAIL_DB
      ? [403, { object: 'error', status: 403, code: 'restricted_resource', message: 'Denied' }]
      : [200, { object: 'page', id: 'created-' + db, properties: body.properties }];
  });
}
