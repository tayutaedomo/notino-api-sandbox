import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { Client, CreateDatabaseParameters, GetDatabaseResponse } from '@notionhq/client';
import { readState, saveState, record, writeJson } from './integration_safety';

const roles = ['Retro', 'Body', 'Sleep', 'Diary'] as const;
type Role = (typeof roles)[number];
type Entry = { role: Role; id: string; dataSourceId?: string };
export interface PreparedPool {
  databaseIds: string[];
  dataSourceIds: string[];
  statusName: string;
}
interface Pool {
  version: 1;
  parent: string;
  ownerRunId: string;
  attempted: Role[];
  databases: Entry[];
}
const same = (a: string, b: string) =>
  a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();
const poolFile = (file: string) => path.join(path.dirname(file), 'pool.json');
function readPool(file: string): Pool {
  const value = JSON.parse(readFileSync(file, 'utf8')) as Pool;
  if (
    value.version !== 1 ||
    typeof value.parent !== 'string' ||
    typeof value.ownerRunId !== 'string' ||
    !Array.isArray(value.attempted) ||
    value.attempted.some((role) => !roles.includes(role)) ||
    !Array.isArray(value.databases) ||
    value.databases.length > 4 ||
    value.databases.some(
      (db) =>
        !roles.includes(db.role) ||
        typeof db.id !== 'string' ||
        !db.id ||
        (db.dataSourceId !== undefined &&
          (typeof db.dataSourceId !== 'string' || !db.dataSourceId)),
    ) ||
    new Set(value.databases.map((db) => db.role)).size !== value.databases.length ||
    new Set(value.databases.map((db) => db.id.replace(/-/g, '').toLowerCase())).size !==
      value.databases.length
  )
    throw new Error('Invalid test database registry.');
  return value;
}
function schema(
  role: Role,
): NonNullable<NonNullable<CreateDatabaseParameters['initial_data_source']>['properties']> {
  return role !== 'Diary'
    ? { Name: { title: {} }, Date: { date: {} }, 'Created time': { created_time: {} } }
    : {
        Name: { title: {} },
        Month: { number: {} },
        Tags: { multi_select: { options: [{ name: 'diary' }] } },
        Status: { status: {} },
        'Created time': { created_time: {} },
      };
}
async function validateDatabase(
  notion: Client,
  pool: Pool,
  entry: Entry,
  created?: GetDatabaseResponse,
): Promise<string> {
  const database =
    created && 'parent' in created
      ? created
      : await notion.databases.retrieve({ database_id: entry.id });
  const expected = 'Notion API Test ' + pool.ownerRunId + ' ' + entry.role;
  if (
    !('parent' in database) ||
    database.parent.type !== 'page_id' ||
    !same(database.parent.page_id, pool.parent) ||
    database.in_trash ||
    database.title.map((item) => item.plain_text).join('') !== expected ||
    database.data_sources.length !== 1
  )
    throw new Error('Test database ownership or availability changed.');
  const id = database.data_sources[0].id;
  if (entry.dataSourceId && !same(entry.dataSourceId, id))
    throw new Error('Test data source changed.');
  return id;
}
async function validateSchema(notion: Client, role: Role, id: string): Promise<string> {
  const source = await notion.dataSources.retrieve({ data_source_id: id });
  if (!('properties' in source)) throw new Error('Test schema is unavailable.');
  for (const [name, value] of Object.entries(schema(role))) {
    if (source.properties[name]?.type !== Object.keys(value)[0])
      throw new Error('Test database schema changed: ' + name);
  }
  if (role === 'Diary') {
    const status = source.properties.Status;
    if (status.type !== 'status' || !status.status.options.length)
      throw new Error('Status needs at least one option.');
    return status.status.options[0].name;
  }
  return '';
}
/** Recover IDs persisted by the transport if the process stopped before registry update. */
export async function synchronizePool(file: string, notion: Client): Promise<void> {
  const registry = poolFile(file);
  if (!existsSync(registry)) return;
  const pool = readPool(registry);
  const state = readState(file);
  if (!same(pool.parent, state.parent)) throw new Error('Test parent differs from the registry.');
  for (const resource of state.resources.databases) {
    if (pool.databases.some((entry) => same(entry.id, resource.id))) continue;
    if (pool.ownerRunId !== state.id)
      throw new Error('Unregistered database belongs to another run.');
    const role = roles.find(
      (role) =>
        pool.attempted.includes(role) && !pool.databases.some((entry) => entry.role === role),
    );
    if (!role) throw new Error('Cannot reconcile an unregistered test database.');
    const entry: Entry = { role, id: resource.id };
    entry.dataSourceId = await validateDatabase(notion, pool, entry);
    pool.databases.push(entry);
    writeJson(registry, pool);
    record(file, 'database_registered', { databaseId: entry.id, role, recovered: true });
  }
}
export async function preparePool(file: string, notion: Client): Promise<PreparedPool> {
  const registry = poolFile(file);
  const state = readState(file);
  state.databasePolicy = 'retain';
  saveState(file, state);
  let pool: Pool;
  let statusName = '';
  if (existsSync(registry)) pool = readPool(registry);
  else {
    const retained = readdirSync(path.dirname(file))
      .filter((name) => name !== 'lock.json' && name !== 'pool.json' && name.endsWith('.json'))
      .map((name) => readState(path.join(path.dirname(file), name)));
    if (retained.some((run) => run.databasePolicy === 'retain' && run.resources.databases.length))
      throw new Error('Database registry is missing; refusing replacement creation.');
    pool = { version: 1, parent: state.parent, ownerRunId: state.id, attempted: [], databases: [] };
    writeJson(registry, pool);
    record(file, 'database_pool_initialized');
  }
  if (!same(pool.parent, state.parent)) throw new Error('Test parent differs from the registry.');
  const current = readState(file);
  for (const entry of pool.databases)
    if (!current.resources.databases.some((db) => same(db.id, entry.id)))
      current.resources.databases.push({ id: entry.id, trashed: false });
  saveState(file, current);
  // Validate every existing DB before creating any missing initial DB.
  for (const entry of pool.databases) {
    const id = await validateDatabase(notion, pool, entry);
    const status = await validateSchema(notion, entry.role, id);
    if (entry.role === 'Diary') statusName = status;
    entry.dataSourceId = id;
    writeJson(registry, pool);
    record(file, 'database_reused', { databaseId: entry.id, dataSourceId: id, role: entry.role });
  }
  for (const role of roles) {
    if (pool.databases.some((entry) => entry.role === role)) continue;
    if (pool.attempted.includes(role))
      throw new Error(
        'Incomplete initial DB creation. Inspect the registry and audit log before retrying.',
      );
    pool.attempted.push(role);
    writeJson(registry, pool);
    record(file, 'database_creation_planned', { role });
    const database = await notion.databases.create({
      parent: { type: 'page_id', page_id: pool.parent },
      title: [{ text: { content: 'Notion API Test ' + pool.ownerRunId + ' ' + role } }],
      initial_data_source: { properties: schema(role) },
    });
    const entry: Entry = { role, id: database.id };
    pool.databases.push(entry);
    writeJson(registry, pool);
    const id = await validateDatabase(notion, pool, entry, database);
    entry.dataSourceId = id;
    writeJson(registry, pool);
    const status = await validateSchema(notion, role, id);
    if (role === 'Diary') statusName = status;
    record(file, 'database_registered', { databaseId: entry.id, dataSourceId: id, role });
  }
  const entries = roles.map((role) => pool.databases.find((entry) => entry.role === role)!);
  return {
    databaseIds: entries.map((entry) => entry.id),
    dataSourceIds: entries.map((entry) => entry.dataSourceId!),
    statusName,
  };
}
