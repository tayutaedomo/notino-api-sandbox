const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');
const { api, page, list, resolve, schema } = require('./helpers/fixtures.cjs');
const { copyPage } = require('../functions/lib/notion_copy_page');
nock.disableNetConnect();
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  assert.deepEqual(pending, []);
});
/** @param {Record<string, any>} properties */
async function copy(properties) {
  resolve();
  schema();
  api()
    .post('/v1/data_sources/ds-db/query')
    .reply(200, list([page('source', properties)]));
  api().get('/v1/blocks/source/children').query(true).reply(200, list([]));
  /** @type {Record<string, any> | undefined} */
  let copied;
  api()
    .post('/v1/pages')
    .reply((_uri, body) => {
      copied = /** @type {{properties: Record<string, any>}} */ (body).properties;
      return [200, page('new')];
    });
  await copyPage('test-key', {
    databaseId: 'db',
    searchProperty: 'Name',
    searchValue: 'Retro',
    sortProperty: 'Created time',
  });
  assert.ok(copied);
  return copied;
}
for (const status of [{ id: 'status-id', name: 'In progress', color: 'blue' }, null]) {
  test('status をコピー: ' + (status?.name || '未設定'), async () => {
    const copied = await copy({ Status: { type: 'status', status } });
    assert.deepEqual(copied.Status, { status: status ? { name: status.name } : null });
  });
}
test('プロパティの読み取り専用情報を除去し値と空値を維持', async () => {
  const text = {
    type: 'text',
    text: { content: 'Retro', link: null },
    annotations: { bold: true, color: 'default' },
    plain_text: 'Retro',
    href: null,
  };
  const copied = await copy({
    Name: { type: 'title', title: [text] },
    Text: { type: 'rich_text', rich_text: [text] },
    Number: { type: 'number', number: 0 },
    Select: { type: 'select', select: null },
    Multi: { type: 'multi_select', multi_select: [{ id: 'x', name: 'tag', color: 'red' }] },
    Date: { type: 'date', date: null },
    Checkbox: { type: 'checkbox', checkbox: false },
    Url: { type: 'url', url: '' },
    Email: { type: 'email', email: null },
    Phone: { type: 'phone_number', phone_number: null },
    Relation: { type: 'relation', relation: [{ id: 'related' }], has_more: false },
    People: {
      type: 'people',
      people: [
        {
          object: 'user',
          id: 'user',
          name: 'User',
          avatar_url: null,
          type: 'person',
          person: { email: 'secret@example.com' },
        },
      ],
    },
    Files: {
      type: 'files',
      files: [
        {
          name: 'doc',
          type: 'file',
          file: { url: 'https://example.com/file', expiry_time: 'soon' },
        },
      ],
    },
    Formula: { type: 'formula', formula: {} },
    Rollup: { type: 'rollup', rollup: {} },
    Created: { type: 'created_time', created_time: 'old' },
  });
  assert.deepEqual(copied.Name.title, [
    { type: 'text', text: text.text, annotations: text.annotations },
  ]);
  assert.deepEqual(copied.People.people, [{ id: 'user' }]);
  assert.deepEqual(copied.Files.files, [
    { name: 'doc', type: 'file', file: { url: 'https://example.com/file' } },
  ]);
  assert.deepEqual(copied.Multi.multi_select, [{ name: 'tag' }]);
  assert.deepEqual(copied.Select, { select: null });
  assert.deepEqual(copied.Date, { date: null });
  assert.deepEqual(copied.Url, { url: '' });
  assert.equal(copied.Number.number, 0);
  assert.equal(copied.Checkbox.checkbox, false);
  assert.equal(copied.Formula, undefined);
  assert.equal(copied.Rollup, undefined);
  assert.equal(copied.Created, undefined);
});
