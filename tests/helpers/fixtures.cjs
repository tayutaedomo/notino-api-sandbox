const nock = require('nock');
const { Client } = require('@notionhq/client');
const api = () => nock('https://api.notion.com');
const page = (id = 'source', properties = {}) => ({ object: 'page', id, properties, icon: null, cover: null });
const block = (id = 'block', type = 'to_do', content = {}) => ({
  object: 'block', id, type, has_children: false, archived: false, in_trash: false,
  created_time: '2026-01-01T00:00:00Z', last_edited_time: '2026-01-01T00:00:00Z',
  created_by: { object: 'user', id: 'user' }, last_edited_by: { object: 'user', id: 'user' },
  parent: { type: 'page_id', page_id: 'source' },
  [type]: { rich_text: [], checked: true, ...content },
});
const list = results => ({ object: 'list', results, has_more: false, next_cursor: null });
const client = () => new Client({ auth: 'test-key' });
module.exports = { api, page, block, list, client };
