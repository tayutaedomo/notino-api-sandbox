import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isFullPage, isFullBlock, PageObjectResponse, Client } from '@notionhq/client';
import { createNotionClient } from '../functions/lib/notion_client';
import { copyPage } from '../functions/lib/notion_copy_page';
import { IntegrationTransport, runCli, readState } from './lib/integration_safety';
import { PreparedPool } from './lib/integration_pool';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required for dedicated test databases.');
  return value;
}

async function expectRows(notion: Client, dataSourceId: string, count: number): Promise<PageObjectResponse[]> {
  const response = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: count + 1 });
  assert.equal(response.results.length, count, 'Unexpected test database page count.');
  assert.equal(response.has_more, false, 'Unexpected additional test pages.');
  return response.results.map(page => {
    if (!isFullPage(page)) throw new Error('Test page properties are unavailable.');
    return page;
  });
}

function title(page: PageObjectResponse): string {
  const name = page.properties.Name;
  assert.equal(name.type, 'title');
  if (name.type !== 'title') throw new Error('Name must be title.');
  return name.title.map(item => item.plain_text).join('');
}

async function verifyBody(notion: Client, pageId: string, marker: string): Promise<void> {
  const roots = await notion.blocks.children.list({ block_id: pageId });
  assert.equal(roots.results.length, 1);
  const root = roots.results[0]; assert.ok(isFullBlock(root) && root.type === 'toggle');
  const children = await notion.blocks.children.list({ block_id: root.id });
  assert.equal(children.results.length, 1);
  const todo = children.results[0]; assert.ok(isFullBlock(todo) && todo.type === 'to_do');
  assert.equal(todo.to_do.checked, false);
  const grandchildren = await notion.blocks.children.list({ block_id: todo.id });
  assert.equal(grandchildren.results.length, 1);
  const text = grandchildren.results[0]; assert.ok(isFullBlock(text) && text.type === 'paragraph');
  assert.equal(text.paragraph.rich_text.map(item => item.plain_text).join(''), marker);
}

export async function verifyIntegration(guard?: IntegrationTransport, prepared?: PreparedPool): Promise<void> {
  // Never fall back to production credentials or IDs.
  const key = required('NOTION_TEST_KEY');
  const databaseIds = [1, 2, 3, 4].map(i => required('NOTION_TEST_DB_ID_' + i));
  const normalized = databaseIds.map(id => id.replace(/-/g, '').toLowerCase());
  if (normalized.some(id => !/^[0-9a-f]{32}$/.test(id)) || new Set(normalized).size !== 4) {
    throw new Error('Provide four distinct test database UUIDs.');
  }
  if (!guard || guard.file !== process.env.NOTION_TEST_RUN_FILE) throw new Error('Audited integration run is required. Use yarn test:integration --execute.');
  process.env.NOTION_DATA_SOURCE_MAP = process.env.NOTION_TEST_DATA_SOURCE_MAP || '';
  const notion = createNotionClient(key);
  assert.ok(prepared, 'Verified database preparation is required.');
  assert.deepEqual(prepared.databaseIds.map(id => id.replace(/-/g, '').toLowerCase()), normalized);
  assert.equal(prepared.dataSourceIds.length, 4);
  assert.equal(new Set(prepared.dataSourceIds).size, 4);
  assert.ok(prepared.statusName, 'Status needs at least one option.');
  const sources = prepared.dataSourceIds;
  const owned = readState(guard.file).resources.sources;
  for (const id of sources) {
    assert.ok(owned.some(source => source.replace(/-/g, '').toLowerCase() === id.replace(/-/g, '').toLowerCase()), 'Data source was not verified by this run.');
    await expectRows(notion, id, 0);
  }
  const statusName = prepared.statusName;
  const today = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const date = today.replace(/\//g, '-');
  const day = today.replace(/\//g, '').slice(2);
  const marker = 'Integration ' + randomUUID();
  const env = { ...process.env, NOTION_KEY: key, ...Object.fromEntries(databaseIds.map((id, i) => ['NOTION_DB_ID_' + (i + 1), id])) };
  const run = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number }) => runCli(guard.file, command, args, options);
  await run('yarn', ['all:create'], { env, timeout: 120000 });
  await expectRows(notion, sources[3], 0);
  for (let i = 0; i < 3; i++) {
    const [page] = await expectRows(notion, sources[i], 1);
    assert.equal(title(page), day + ' ' + ['Retro', 'Body', 'Sleep'][i]);
    const value = page.properties.Date; assert.ok(value.type === 'date'); assert.equal(value.date?.start, date);
    assert.ok(page.parent.type === 'data_source_id'); assert.equal(page.parent.data_source_id, sources[i]);
  }
  const source = await notion.pages.create({ parent: { type: 'data_source_id', data_source_id: sources[3] }, properties: {
    Name: { title: [{ text: { content: marker } }] }, Month: { number: 200001 }, Tags: { multi_select: [{ name: 'diary' }] }, Status: { status: { name: statusName } },
  } });
  const root = await notion.blocks.children.append({ block_id: source.id, children: [{ toggle: { rich_text: [{ text: { content: marker } }] } }] });
  await notion.blocks.children.append({ block_id: root.results[0].id, children: [{ to_do: { rich_text: [{ text: { content: 'Test TODO' } }], checked: true, children: [{ paragraph: { rich_text: [{ text: { content: marker } }] } }] } }] });
  const copied = await copyPage(key, { databaseId: databaseIds[3], searchProperty: 'Name', searchValue: marker, sortProperty: 'Created time' });
  assert.equal(copied.copiedBlocks, 1);
  const copiedPage = await notion.pages.retrieve({ page_id: copied.newPage.id }); assert.ok(isFullPage(copiedPage));
  const status = copiedPage.properties.Status; assert.ok(status.type === 'status'); assert.equal(status.status?.name, statusName);
  await verifyBody(notion, copied.newPage.id, marker);
  console.log('実API確認成功: 日次3ページ、階層コピー、TODO、status。後片付けは実行管理側で行います。');
}

if (require.main === module) verifyIntegration().catch(error => {
  console.error(error instanceof Error ? error.message : 'Integration verification failed.');
  process.exitCode = 1;
});
