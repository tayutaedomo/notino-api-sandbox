import { Client } from '@notionhq/client';

type TransportOptions = Pick<NonNullable<ConstructorParameters<typeof Client>[0]>, 'fetch' | 'timeoutMs'>;
export const NOTION_API_VERSION = '2026-03-11';

export function createNotionClient(auth = process.env.NOTION_KEY || '', options: TransportOptions = {}): Client {
  return new Client({ ...options, auth, notionVersion: NOTION_API_VERSION, retry: false });
}

export async function resolveDataSource(notion: Client, databaseId: string): Promise<string> {
  if (!databaseId) throw new Error('Database ID is required.');
  let mapping: Record<string, string> = {};
  if (process.env.NOTION_DATA_SOURCE_MAP) {
    let parsed: unknown;
    try { parsed = JSON.parse(process.env.NOTION_DATA_SOURCE_MAP); }
    catch { throw new Error('NOTION_DATA_SOURCE_MAP must be a JSON object of string IDs.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        Object.values(parsed).some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error('NOTION_DATA_SOURCE_MAP must be a JSON object of string IDs.');
    }
    mapping = parsed as Record<string, string>;
  }
  const normalize = (id: string) => id.replace(/-/g, '').toLowerCase();
  const key = Object.keys(mapping).find(id => normalize(id) === normalize(databaseId));
  const selected = key === undefined ? undefined : mapping[key];
  const database = await notion.databases.retrieve({ database_id: databaseId });
  if (!('data_sources' in database)) throw new Error('Database does not expose data sources.');
  if (selected) {
    const source = database.data_sources.find(item => normalize(item.id) === normalize(selected));
    if (!source) throw new Error('Selected data source does not belong to this database.');
    return source.id;
  }
  if (database.data_sources.length !== 1) {
    throw new Error('Cannot select a data source. Set NOTION_DATA_SOURCE_MAP for this database.');
  }
  return database.data_sources[0].id;
}
