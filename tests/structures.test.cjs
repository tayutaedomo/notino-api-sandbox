const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');
const { api, block, list, client } = require('./helpers/fixtures.cjs');
const {
  fetchPreparedBlocks,
  appendPreparedBlocks,
  cleanRichText,
} = require('../functions/lib/notion_blocks');
nock.disableNetConnect();
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  assert.deepEqual(pending, []);
});
const text = (content = 'text') => ({
  type: 'text',
  text: { content, link: null },
  plain_text: content,
  annotations: { bold: true, color: 'default' },
});
test('テーブルは最初の行を含めて作成し残り250行を分割する', async () => {
  const table = block('table', 'table', {
    table_width: 1,
    has_column_header: false,
    has_row_header: false,
  });
  table.has_children = true;
  api()
    .get('/v1/blocks/source/children')
    .query(true)
    .reply(200, list([table]));
  const rows = Array.from({ length: 251 }, (_, i) =>
    block('row-' + i, 'table_row', { cells: [[text(String(i))]] }),
  );
  for (let offset = 0; offset < rows.length; offset += 100) {
    const response = list(rows.slice(offset, offset + 100));
    response.has_more = offset + 100 < rows.length;
    response.next_cursor = response.has_more ? 'cursor-' + (offset + 100) : null;
    api()
      .get('/v1/blocks/table/children')
      .query((query) =>
        offset === 0 ? !query.start_cursor : query.start_cursor === 'cursor-' + offset,
      )
      .reply(200, response);
  }
  const prepared = await fetchPreparedBlocks(client(), 'source');
  api()
    .patch('/v1/blocks/new/children', (body) => {
      assert.equal(body.children[0].table.children[0].table_row.cells[0][0].text.content, '0');
      return true;
    })
    .reply(200, list([{ id: 'new-table' }]));
  for (let offset = 1; offset < rows.length; offset += 100) {
    const size = Math.min(100, rows.length - offset);
    api()
      .patch('/v1/blocks/new-table/children', (body) => {
        assert.equal(body.children.length, size);
        assert.equal(body.children[0].table_row.cells[0][0].text.content, String(offset));
        return true;
      })
      .reply(
        200,
        list(Array.from({ length: size }, (_, i) => ({ id: 'new-row-' + (offset + i) }))),
      );
  }
  assert.equal((await appendPreparedBlocks(client(), 'new', prepared)).results.length, 1);
});
test('カラムの初期本文と子孫を新IDへ関連付ける', async () => {
  const columns = block('columns', 'column_list');
  columns.has_children = true;
  const a = block('a', 'column', { width_ratio: 0.5 });
  a.has_children = true;
  const b = block('b', 'column', { width_ratio: 0.5 });
  b.has_children = true;
  const todo = block('todo');
  todo.has_children = true;
  api()
    .get('/v1/blocks/source/children')
    .query(true)
    .reply(200, list([columns]));
  api()
    .get('/v1/blocks/columns/children')
    .query(true)
    .reply(200, list([a, b]));
  api()
    .get('/v1/blocks/a/children')
    .query(true)
    .reply(200, list([todo]));
  api()
    .get('/v1/blocks/todo/children')
    .query(true)
    .reply(200, list([block('descendant')]));
  api()
    .get('/v1/blocks/b/children')
    .query(true)
    .reply(200, list([block('second')]));
  const prepared = await fetchPreparedBlocks(client(), 'source');
  api()
    .patch('/v1/blocks/new/children', (body) => {
      assert.equal(body.children[0].column_list.children.length, 2);
      assert.equal(
        body.children[0].column_list.children[0].column.children[0].to_do.checked,
        false,
      );
      return true;
    })
    .reply(200, list([{ id: 'new-columns' }]));
  api()
    .get('/v1/blocks/new-columns/children')
    .query(true)
    .reply(200, list([{ id: 'new-a' }, { id: 'new-b' }]));
  api()
    .get('/v1/blocks/new-a/children')
    .query(true)
    .reply(200, list([{ id: 'new-todo' }]));
  api()
    .patch('/v1/blocks/new-todo/children')
    .reply(200, list([{ id: 'new-descendant' }]));
  await appendPreparedBlocks(client(), 'new', prepared);
});
test('メディアとキャプションの読み取り専用情報を除去', async () => {
  const file = { url: 'https://example.com/image', expiry_time: 'soon' };
  const source = block('image', 'image', { type: 'file', file, caption: [text()] });
  api()
    .get('/v1/blocks/source/children')
    .query(true)
    .reply(200, list([source]));
  const prepared = await fetchPreparedBlocks(client(), 'source');
  assert.ok('image' in prepared[0].request);
  const image = prepared[0].request.image;
  assert.ok(image.type === 'external');
  assert.deepEqual(image.external, { url: 'https://example.com/image' });
  assert.ok(image.caption);
  assert.equal('plain_text' in image.caption[0], false);
  assert.equal(file.expiry_time, 'soon');
});
test('有効なメンションを維持し読み取り専用情報を除去', () => {
  const items = [
    {
      type: 'mention',
      mention: {
        type: 'user',
        user: {
          object: 'user',
          id: 'user',
          name: 'Name',
          type: 'person',
          person: { email: 'private@example.com' },
        },
      },
      plain_text: 'Name',
      annotations: {},
    },
  ];
  const cleaned = cleanRichText(
    /** @type {import('@notionhq/client').RichTextItemResponse[]} */ (items),
  );
  assert.deepEqual(cleaned[0], {
    type: 'mention',
    mention: { type: 'user', user: { id: 'user' } },
    annotations: {},
  });
});
test('部分ブロックは本文欠落として拒否', async () => {
  api()
    .get('/v1/blocks/source/children')
    .query(true)
    .reply(200, list([{ object: 'block', id: 'partial' }]));
  await assert.rejects(fetchPreparedBlocks(client(), 'source'), /Block content is unavailable/);
});
