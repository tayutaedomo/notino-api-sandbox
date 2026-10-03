const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');
const { api, page, block, list, client, resolve, schema } = require('./helpers/fixtures.cjs');
const { copyPage } = require('../functions/lib/notion_copy_page');
const { duplicatePage } = require('../functions/lib/notion_duplicate_page');
nock.disableNetConnect();
afterEach(() => { const pending = nock.pendingMocks(); nock.cleanAll(); assert.deepEqual(pending, []); });
/** @param {string} mode @param {ReturnType<typeof block>[]} blocks */
function setup(mode, blocks) {
  resolve(); if (mode === 'copy') schema();
  api().post('/v1/data_sources/ds-db/query').reply(200, list([page()]));
  for (let offset = 0; offset < Math.max(1, blocks.length); offset += 100) {
    const response = list(blocks.slice(offset, offset + 100));
    response.has_more = offset + 100 < blocks.length;
    response.next_cursor = response.has_more ? 'cursor-' + (offset + 100) : null;
    api().get('/v1/blocks/source/children').query(query => offset === 0 ? !query.start_cursor : query.start_cursor === 'cursor-' + offset).reply(200, response);
  }
}
/** @param {string} mode */
function execute(mode) { return mode === 'copy' ? copyPage('test-key', { databaseId: 'db', searchProperty: 'Name', searchValue: 'Retro', sortProperty: 'Created time' }) : duplicatePage(client(), 'db'); }
for (const mode of ['copy', 'diary']) for (const count of [0, 1, 100, 101, 250]) {
  test(mode + ' のブロック件数: ' + count, async () => {
    const blocks = Array.from({ length: count }, (_, i) => block('b-' + i, 'to_do', { rich_text: [{ type: 'text', text: { content: String(i), link: null } }] })); setup(mode, blocks);
    api().post('/v1/pages').reply(200, page('new'));
    for (let offset = 0; offset < count; offset += 100) {
      const size = Math.min(100, count - offset);
      api().patch('/v1/blocks/new/children', body => {
        assert.equal(body.children.length, size);
        for (const [i, child] of body.children.entries()) {
          assert.equal(child.to_do.checked, false);
          assert.equal(child.to_do.rich_text[0].text.content, String(offset + i));
          for (const key of ['id', 'created_time', 'parent', 'has_children', 'archived', 'in_trash']) assert.equal(child[key], undefined);
        }
        return true;
      }).reply(200, list(Array.from({ length: size }, (_, i) => ({ id: 'new-' + (offset + i) }))));
    }
    const result = await execute(mode);
    assert.equal('copiedBlocks' in result ? result.copiedBlocks : result.newBlocks.results.length, count);
  });
}
for (const mode of ['copy', 'diary']) {
  test(mode + ' の分割境界にある子孫を正しい新IDへ追加', async () => {
    const blocks = Array.from({ length: 101 }, (_, i) => block('b-' + i)); blocks[100].has_children = true;
    setup(mode, blocks);
    const child = block('child'); child.has_children = true;
    api().get('/v1/blocks/b-100/children').query(true).reply(200, list([child]));
    api().get('/v1/blocks/child/children').query(true).reply(200, list([block('grandchild')]));
    api().post('/v1/pages').reply(200, page('new'));
    api().patch('/v1/blocks/new/children', body => body.children.length === 100).reply(200, list(blocks.slice(0, 100).map((b, i) => ({ id: 'new-' + i }))));
    api().patch('/v1/blocks/new/children', body => body.children.length === 1).reply(200, list([{ id: 'new-100' }]));
    api().patch('/v1/blocks/new-100/children').reply(200, list([{ id: 'new-child' }]));
    api().patch('/v1/blocks/new-child/children', body => { assert.equal(body.children[0].to_do.checked, false); return true; }).reply(200, list([{ id: 'new-grandchild' }]));
    await execute(mode);
  });
  for (const type of ['template', 'meeting_notes', 'unsupported', 'child_page', 'link_preview']) {
    test(mode + ' の作成不能ブロックは新ページ作成前に拒否: ' + type, async () => {
      setup(mode, [block('bad', type)]);
      await assert.rejects(execute(mode), /Cannot copy block type/);
    });
  }
}
test('Diary のコピー元なし', async () => {
  resolve(); api().post('/v1/data_sources/ds-db/query').reply(200, list([]));
  await assert.rejects(duplicatePage(client(), 'db'), /No matching page found/);
});
