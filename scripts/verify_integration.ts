import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isFullPage, isFullBlock, PageObjectResponse, Client } from '@notionhq/client';
import { createNotionClient, resolveDataSource } from '../functions/lib/notion_client';
import { copyPage } from '../functions/lib/notion_copy_page';
import { IntegrationTransport, runCli } from './lib/integration_safety';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required for dedicated test databases.');
  return value;
}

async function rows(notion: Client, dataSourceId: string): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 });
    for (const page of response.results) {
      if (!isFullPage(page)) throw new Error('Test page properties are unavailable.');
      pages.push(page);
    }
    if (response.has_more && !response.next_cursor) throw new Error('Missing query cursor.');
    cursor = response.has_more ? response.next_cursor! : undefined;
  } while (cursor);
  return pages;
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

export async function verifyIntegration(guard?: IntegrationTransport): Promise<void> {
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
  const sources: string[] = [];
  let statusName = '';
  for (const [index, databaseId] of databaseIds.entries()) {
    const id = await resolveDataSource(notion, databaseId);
    const schema = await notion.dataSources.retrieve({ data_source_id: id });
    if (!('properties' in schema)) throw new Error('Test schema is unavailable.');
    const expected: Record<string, string> = index < 3
      ? { Name: 'title', Date: 'date', 'Created time': 'created_time' }
      : { Name: 'title', Month: 'number', Tags: 'multi_select', Status: 'status', 'Created time': 'created_time' };
    for (const [name, type] of Object.entries(expected)) {
      if (schema.properties[name]?.type !== type) throw new Error(name + ' must be ' + type + '.');
    }
    if (index === 3) {
      const status = schema.properties.Status;
      if (status.type !== 'status' || !status.status.options.length) throw new Error('Status needs at least one option.');
      statusName = status.status.options[0].name;
    }
    if ((await rows(notion, id)).length) throw new Error('Dedicated test databases must be empty before verification.');
    sources.push(id);
  }
  const today = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const date = today.replace(/\//g, '-');
  const day = today.replace(/\//g, '').slice(2);
  const marker = 'Integration ' + randomUUID();
  const names = new Set(['Retro', 'Body', 'Sleep'].map(suffix => day + ' ' + suffix));
  names.add(marker);
  const env = { ...process.env, NOTION_KEY: key, ...Object.fromEntries(databaseIds.map((id, i) => ['NOTION_DB_ID_' + (i + 1), id])) };
  const run = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number }) => runCli(guard.file, command, args, options);
  const knownIds = new Set<string>();
  try {
    await run('yarn', ['all:create'], { env, timeout: 120000 });
    assert.equal((await rows(notion, sources[3])).length, 0);
    for (let i = 0; i < 3; i++) {
      const pages = await rows(notion, sources[i]); assert.equal(pages.length, 1);
      const page = await notion.pages.retrieve({ page_id: pages[0].id }); assert.ok(isFullPage(page));
      assert.equal(title(page), day + ' ' + ['Retro', 'Body', 'Sleep'][i]);
      const value = page.properties.Date; assert.ok(value.type === 'date'); assert.equal(value.date?.start, date);
      assert.ok(page.parent.type === 'data_source_id'); assert.equal(page.parent.data_source_id, sources[i]);
      knownIds.add(page.id);
    }
    const source = await notion.pages.create({ parent: { type: 'data_source_id', data_source_id: sources[3] }, properties: {
      Name: { title: [{ text: { content: marker } }] }, Month: { number: 200001 }, Tags: { multi_select: [{ name: 'diary' }] }, Status: { status: { name: statusName } },
    } });
    knownIds.add(source.id);
    const root = await notion.blocks.children.append({ block_id: source.id, children: [{ toggle: { rich_text: [{ text: { content: marker } }] } }] });
    await notion.blocks.children.append({ block_id: root.results[0].id, children: [{ to_do: { rich_text: [{ text: { content: 'Test TODO' } }], checked: true, children: [{ paragraph: { rich_text: [{ text: { content: marker } }] } }] } }] });
    const copied = await copyPage(key, { databaseId: databaseIds[3], searchProperty: 'Name', searchValue: marker, sortProperty: 'Created time' });
    knownIds.add(copied.newPage.id); assert.equal(copied.copiedBlocks, 1);
    const copiedPage = await notion.pages.retrieve({ page_id: copied.newPage.id }); assert.ok(isFullPage(copiedPage));
    const status = copiedPage.properties.Status; assert.ok(status.type === 'status'); assert.equal(status.status?.name, statusName);
    await verifyBody(notion, copied.newPage.id, marker);
  } finally {
    const errors: unknown[] = [];
    for (const id of sources) {
      try {
        for (const page of await rows(notion, id)) if (names.has(title(page))) knownIds.add(page.id);
      } catch (error) { errors.push(error); }
    }
    for (const id of knownIds) {
      try { await notion.pages.update({ page_id: id, in_trash: true }); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new Error('Verification cleanup is incomplete. Inspect the dedicated test databases before rerunning.');
  }
  console.log('実API確認成功: 日次3ページ、階層コピー、TODO、status。検証ページをゴミ箱へ移動しました。');
}

if (require.main === module) verifyIntegration().catch(error => {
  console.error(error instanceof Error ? error.message : 'Integration verification failed.');
  process.exitCode = 1;
});
