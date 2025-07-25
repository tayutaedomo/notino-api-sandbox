import { Client } from '@notionhq/client';
import {
  BlockObjectResponse,
  CreatePageResponse,
  PartialBlockObjectResponse,
  PageObjectResponse,
  QueryDatabaseParameters,
  CreatePageParameters,
} from '@notionhq/client/build/src/api-endpoints';

type DatabaseFilter = QueryDatabaseParameters['filter'];
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
  const notion = new Client({ auth: notionKey });
  const { databaseId, searchProperty, searchValue, sortProperty, sortDirection = 'descending' } = params;

  const sourcePage = await queryPage(notion, databaseId, searchProperty, searchValue, sortProperty, sortDirection);
  if (!sourcePage) {
    throw new Error('No matching page found');
  }

  const sourceBlocks = await queryPageBlocks(notion, sourcePage.id);
  const newPage = await createPageCopy(notion, databaseId, sourcePage);
  const newBlocks = await appendBlocks(notion, newPage.id, sourceBlocks);

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
  sortDirection: string
): Promise<PageObjectResponse | null> {
  const filter = createFilter(searchProperty, searchValue);
  
  const response = await notion.databases.query({
    database_id: databaseId,
    page_size: 1,
    filter,
    sorts: [
      {
        property: sortProperty,
        direction: sortDirection as 'ascending' | 'descending',
      },
    ],
  });

  return response.results.length > 0 ? (response.results[0] as PageObjectResponse) : null;
}

function createFilter(property: string, value: string): DatabaseFilter {
  return {
    or: [
      {
        property,
        title: {
          contains: value,
        },
      },
      {
        property,
        rich_text: {
          contains: value,
        },
      },
    ],
  };
}

async function queryPageBlocks(
  notion: Client,
  pageId: string
): Promise<(PartialBlockObjectResponse | BlockObjectResponse)[]> {
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  return response.results.length > 0 ? response.results : [];
}

async function createPageCopy(
  notion: Client,
  databaseId: string,
  sourcePage: PageObjectResponse
): Promise<CreatePageResponse> {
  const properties = copyProperties(sourcePage.properties);

  const createPageParams: CreatePageParameters = {
    parent: {
      database_id: databaseId,
    },
    properties,
  };

  if (sourcePage.icon && (sourcePage.icon.type === 'emoji' || sourcePage.icon.type === 'external')) {
    createPageParams.icon = sourcePage.icon;
  }

  if (sourcePage.cover && sourcePage.cover.type === 'external') {
    createPageParams.cover = sourcePage.cover;
  }

  return await notion.pages.create(createPageParams);
}

function copyProperties(sourceProperties: SourceProperties): CreateProperties {
  const copiedProperties: CreateProperties = {};

  for (const [key, property] of Object.entries(sourceProperties)) {
    switch (property.type) {
      case 'title':
        copiedProperties[key] = {
          title: property.title as any,
        };
        break;
      case 'rich_text':
        copiedProperties[key] = {
          rich_text: property.rich_text as any,
        };
        break;
      case 'number':
        copiedProperties[key] = {
          number: property.number,
        };
        break;
      case 'select':
        if (property.select) {
          copiedProperties[key] = {
            select: {
              name: property.select.name,
            },
          };
        }
        break;
      case 'multi_select':
        copiedProperties[key] = {
          multi_select: property.multi_select.map((item) => ({
            name: item.name,
          })),
        };
        break;
      case 'date':
        if (property.date) {
          copiedProperties[key] = {
            date: property.date,
          };
        }
        break;
      case 'checkbox':
        copiedProperties[key] = {
          checkbox: property.checkbox,
        };
        break;
      case 'url':
        if (property.url) {
          copiedProperties[key] = {
            url: property.url,
          };
        }
        break;
      case 'email':
        if (property.email) {
          copiedProperties[key] = {
            email: property.email,
          };
        }
        break;
      case 'phone_number':
        if (property.phone_number) {
          copiedProperties[key] = {
            phone_number: property.phone_number,
          };
        }
        break;
      case 'relation':
        copiedProperties[key] = {
          relation: property.relation,
        };
        break;
      case 'people':
        copiedProperties[key] = {
          people: property.people,
        };
        break;
      case 'files':
        copiedProperties[key] = {
          files: property.files,
        };
        break;
      case 'formula':
      case 'rollup':
      case 'created_time':
      case 'created_by':
      case 'last_edited_time':
      case 'last_edited_by':
        break;
      default:
        console.warn(`Unhandled property type: ${(property as any).type}`);
        break;
    }
  }

  return copiedProperties;
}

async function appendBlocks(
  notion: Client,
  pageId: string,
  sourceBlocks: (PartialBlockObjectResponse | BlockObjectResponse)[]
) {
  const newBlocks = sourceBlocks.map((block) => {
    const { id, created_time, created_by, last_edited_time, last_edited_by, parent, ...blockWithoutMetadata } = block as any;
    
    if (blockWithoutMetadata.type === 'to_do' && blockWithoutMetadata.to_do) {
      blockWithoutMetadata.to_do.checked = false;
    }

    return blockWithoutMetadata;
  });

  return await notion.blocks.children.append({
    block_id: pageId,
    children: newBlocks as any,
  });
}