const nock = require('nock');
const { createNotionClient } = require('../../functions/lib/notion_client');
const api = () => nock('https://api.notion.com');
const page = (id = 'source', properties = {}) => ({ object: 'page', url: 'https://example.com/page', id, properties, icon: null, cover: null });
const block = (id = 'block', type = 'to_do', content = {}) => ({
  object: 'block', id, type, has_children: false, archived: false, in_trash: false,
  created_time: '2026-01-01T00:00:00Z', last_edited_time: '2026-01-01T00:00:00Z',
  created_by: { object: 'user', id: 'user' }, last_edited_by: { object: 'user', id: 'user' },
  parent: { type: 'page_id', page_id: 'source' },
  [type]: { rich_text: [], checked: true, ...content },
});
const list = results => ({ object: 'list', results, has_more: false, next_cursor: null });
const client = () => createNotionClient('test-key');
const resolve = (db = 'db') => api().get('/v1/databases/' + db).reply(200, { object: 'database', id: db, data_sources: [{ id: 'ds-' + db, name: 'Source' }] });
const schema = (type = 'title', property = 'Name') => api().get('/v1/data_sources/ds-db').reply(200, { object: 'data_source', title: [], id: 'ds-db', properties: { [property]: { id: 'prop', type } } });
module.exports = { api, page, block, list, client, resolve, schema };
