import { Client, isFullPage } from '@notionhq/client';
import { fetchPreparedBlocks, appendPreparedBlocks, cleanRichText } from './notion_blocks';
import { createNotionClient, resolveDataSource } from './notion_client';
import {
  CreatePageResponse,
  PageObjectResponse,
  QueryDataSourceParameters,
  CreatePageParameters,
} from '@notionhq/client';

type DataSourceFilter = QueryDataSourceParameters['filter'];
type CreateProperties = CreatePageParameters['properties'];
type SourceProperties = PageObjectResponse['properties'];

export interface CopyPageParams {
  databaseId: string;
  searchProperty: string;
  searchValue: string;
  sortProperty: string;
  sortDirection?: string;
}

export interface CopyPageResult {
  sourcePage: { id: string };
  newPage: CreatePageResponse;
  copiedBlocks: number;
}

export async function copyPage(notionKey: string, params: CopyPageParams): Promise<CopyPageResult> {
  const notion = createNotionClient(notionKey);
  const {
    databaseId,
    searchProperty,
    searchValue,
    sortProperty,
    sortDirection = 'descending',
  } = params;

  const dataSourceId = await resolveDataSource(notion, databaseId);
  const sourcePage = await queryPage(
    notion,
    dataSourceId,
    searchProperty,
    searchValue,
    sortProperty,
    sortDirection,
  );
  if (!sourcePage) {
    throw new Error('No matching page found');
  }

  const sourceBlocks = await fetchPreparedBlocks(notion, sourcePage.id);
  const newPage = await createPageCopy(notion, dataSourceId, sourcePage);
  const newBlocks = await appendPreparedBlocks(notion, newPage.id, sourceBlocks);

  return {
    sourcePage: { id: sourcePage.id },
    newPage,
    copiedBlocks: newBlocks.results.length,
  };
}

async function queryPage(
  notion: Client,
  databaseId: string,
  searchProperty: string,
  searchValue: string,
  sortProperty: string,
  sortDirection: string,
): Promise<PageObjectResponse | null> {
  const source = await notion.dataSources.retrieve({ data_source_id: databaseId });
  if (!('properties' in source)) throw new Error('Data source schema is unavailable.');
  const property =
    source.properties[searchProperty] ||
    Object.values(source.properties).find((item) => item.id === searchProperty);
  if (!property || (property.type !== 'title' && property.type !== 'rich_text')) {
    throw new Error('Search property must be title or rich_text.');
  }
  const filter: DataSourceFilter =
    property.type === 'title'
      ? { property: searchProperty, title: { contains: searchValue } }
      : { property: searchProperty, rich_text: { contains: searchValue } };
  if (sortDirection !== 'ascending' && sortDirection !== 'descending')
    throw new Error('Invalid sort direction.');

  const response = await notion.dataSources.query({
    data_source_id: databaseId,
    page_size: 1,
    filter,
    sorts: [
      {
        property: sortProperty,
        direction: sortDirection,
      },
    ],
  });

  const page = response.results[0];
  if (!page) return null;
  if (!isFullPage(page)) throw new Error('Source page properties are unavailable.');
  return page;
}

async function createPageCopy(
  notion: Client,
  databaseId: string,
  sourcePage: PageObjectResponse,
): Promise<CreatePageResponse> {
  const properties = copyProperties(sourcePage.properties);

  const createPageParams: CreatePageParameters = {
    parent: {
      data_source_id: databaseId,
    },
    properties,
  };

  if (
    sourcePage.icon &&
    (sourcePage.icon.type === 'emoji' || sourcePage.icon.type === 'external')
  ) {
    createPageParams.icon = sourcePage.icon;
  }

  if (sourcePage.cover && sourcePage.cover.type === 'external') {
    createPageParams.cover = sourcePage.cover;
  }

  return await notion.pages.create(createPageParams);
}

function copyProperties(sourceProperties: SourceProperties): CreateProperties {
  const copied: CreateProperties = {};
  for (const [key, property] of Object.entries(sourceProperties)) {
    switch (property.type) {
      case 'title':
        copied[key] = { title: cleanRichText(property.title) };
        break;
      case 'rich_text':
        copied[key] = { rich_text: cleanRichText(property.rich_text) };
        break;
      case 'number':
        copied[key] = { number: property.number };
        break;
      case 'select':
        copied[key] = { select: property.select ? { name: property.select.name } : null };
        break;
      case 'status':
        copied[key] = { status: property.status ? { name: property.status.name } : null };
        break;
      case 'multi_select':
        copied[key] = { multi_select: property.multi_select.map((item) => ({ name: item.name })) };
        break;
      case 'date':
        copied[key] = { date: property.date };
        break;
      case 'checkbox':
        copied[key] = { checkbox: property.checkbox };
        break;
      case 'url':
        copied[key] = { url: property.url };
        break;
      case 'email':
        copied[key] = { email: property.email };
        break;
      case 'phone_number':
        copied[key] = { phone_number: property.phone_number };
        break;
      case 'relation':
        copied[key] = { relation: property.relation.map((item) => ({ id: item.id })) };
        break;
      case 'people':
        copied[key] = { people: property.people.map((item) => ({ id: item.id })) };
        break;
      case 'files':
        copied[key] = {
          files: property.files.map((item) =>
            item.type === 'external'
              ? { name: item.name, type: 'external', external: { url: item.external.url } }
              : { name: item.name, type: 'file', file: { url: item.file.url } },
          ),
        };
        break;
      case 'formula':
      case 'rollup':
      case 'created_time':
      case 'created_by':
      case 'last_edited_time':
      case 'last_edited_by':
      case 'unique_id':
      case 'button':
      case 'verification':
        break;
      default:
        console.warn('Unhandled property type:', (property as { type: string }).type);
    }
  }
  return copied;
}
