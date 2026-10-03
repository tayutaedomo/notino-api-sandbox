const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');
const { api, page, block, list, client, resolve, schema } = require('./helpers/fixtures.cjs');
const { createPage } = require('../functions/lib/notion_create_page');
const { duplicatePage } = require('../functions/lib/notion_duplicate_page');
const { copyPage } = require('../functions/lib/notion_copy_page');
nock.disableNetConnect();
afterEach(() => { const pending = nock.pendingMocks(); nock.cleanAll(); assert.deepEqual(pending, []); });
for (const [now, date, title] of [['2026-12-31T14:59:59Z', '2026-12-31', '261231'], ['2026-12-31T15:00:00Z', '2027-01-01', '270101'], ['2026-02-28T15:00:00Z', '2026-03-01', '260301']]) {
  test('東京時間の日付: ' + now, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
    resolve();
    api().post('/v1/pages', body => {
      assert.deepEqual(body.parent, { type: 'data_source_id', data_source_id: 'ds-db' });
      assert.equal(body.properties.Name.title[0].text.content, title + ' Retro');
      assert.equal(body.properties.Date.date.start, date);
      return true;
    }).reply(200, page('new'));
    const result = await createPage(client(), 'db', 'Retro');
    assert.equal(result.databaseId, 'db'); assert.equal(result.newPage.id, 'new');
  });
}
test('Diary の選択条件・日付・TODOリセット', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-31T15:00:00Z') });
  resolve();
  api().post('/v1/data_sources/ds-db/query', body => { assert.deepEqual(body.filter, { property: 'Tags', multi_select: { contains: 'diary' } }); assert.deepEqual(body.sorts, [{ property: 'Name', direction: 'descending' }]); return true; }).reply(200, list([page()]));
  api().get('/v1/blocks/source/children').query(true).reply(200, list([block()]));
  api().post('/v1/pages', body => { assert.equal(body.properties.Name.title[0].text.content, '270101 Diary'); assert.equal(body.properties.Month.number, 202701); assert.equal(body.icon.emoji, '😃'); return true; }).reply(200, page('new'));
  api().patch('/v1/blocks/new/children', body => { assert.equal(body.children[0].to_do.checked, false); assert.equal(body.children[0].id, undefined); return true; }).reply(200, list([{ id: 'copied' }]));
  const result = await duplicatePage(client(), 'db'); assert.equal(result.newBlocks.results.length, 1);
});
test('汎用コピーのプロパティ・階層・アイコン・メンション', async () => {
  const source = page('source', { Name: { type: 'title', title: [{ type: 'text', text: { content: 'Retro' } }] }, Value: { type: 'number', number: 2 }, Calculated: { type: 'formula', formula: {} } });
  source.icon = { type: 'emoji', emoji: '⭐' }; source.cover = { type: 'external', external: { url: 'https://example.com/cover.png' } };
  resolve(); schema();
  api().post('/v1/data_sources/ds-db/query', body => { assert.equal(body.sorts[0].property, 'Created time'); assert.equal(body.filter.title.contains, 'Retro'); return true; }).reply(200, list([source]));
  const parent = block('parent'); parent.has_children = true;
  api().get('/v1/blocks/source/children').query(true).reply(200, list([parent]));
  api().get('/v1/blocks/parent/children').query(true).reply(200, list([block('child', 'paragraph', { rich_text: [{ type: 'mention', mention: {}, plain_text: 'fallback' }] })]));
  api().post('/v1/pages', body => { assert.equal(body.properties.Value.number, 2); assert.equal(body.properties.Calculated, undefined); assert.deepEqual(body.icon, source.icon); assert.deepEqual(body.cover, source.cover); return true; }).reply(200, page('new'));
  api().patch('/v1/blocks/new/children', body => { assert.equal(body.children[0].to_do.checked, false); assert.equal(body.children[0].created_time, undefined); return true; }).reply(200, list([{ id: 'new-parent' }]));
  api().patch('/v1/blocks/new-parent/children', body => { assert.equal(body.children[0].paragraph.rich_text[0].text.content, 'fallback'); return true; }).reply(200, list([{ id: 'new-child' }]));
  const result = await copyPage('test-key', { databaseId: 'db', searchProperty: 'Name', searchValue: 'Retro', sortProperty: 'Created time' });
  assert.deepEqual(result.sourcePage, { id: 'source' }); assert.equal(result.copiedBlocks, 1);
});
test('コピー元なしはエラー', async () => {
  resolve(); schema();
  api().post('/v1/data_sources/ds-db/query').reply(200, list([]));
  await assert.rejects(copyPage('test-key', { databaseId: 'db', searchProperty: 'Name', searchValue: 'missing', sortProperty: 'Created time' }), /No matching page found/);
});
