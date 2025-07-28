import { Client } from '@notionhq/client';
import {
  CreatePageResponse,
  PageObjectResponse,
  QueryDatabaseParameters,
  CreatePageParameters,
} from '@notionhq/client/build/src/api-endpoints';

type DatabaseFilter = QueryDatabaseParameters['filter'];
type CreateProperties = CreatePageParameters['properties'];
type SourceProperties = PageObjectResponse['properties'];

interface NotionUser {
  id: string;
  name?: string;
  avatar_url?: string;
}

interface NotionParent {
  type: string;
  page_id?: string;
  database_id?: string;
  workspace?: boolean;
}

interface BlockWithChildren {
  id: string;
  type: string;
  has_children: boolean;
  created_time: string;
  created_by: NotionUser;
  last_edited_time: string;
  last_edited_by: NotionUser;
  parent: NotionParent;
  children?: BlockWithChildren[];
  [key: string]: unknown;
}

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

export async function copyPage(
  notionKey: string,
  params: CopyPageParams
): Promise<CopyPageResult> {
  const notion = new Client({ auth: notionKey });
  const {
    databaseId,
    searchProperty,
    searchValue,
    sortProperty,
    sortDirection = 'descending',
  } = params;

  const sourcePage = await queryPage(
    notion,
    databaseId,
    searchProperty,
    searchValue,
    sortProperty,
    sortDirection
  );
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

  return response.results.length > 0
    ? (response.results[0] as PageObjectResponse)
    : null;
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
): Promise<BlockWithChildren[]> {
  return await fetchBlocksRecursively(notion, pageId);
}

async function fetchBlocksRecursively(
  notion: Client,
  blockId: string,
  depth: number = 0
): Promise<BlockWithChildren[]> {
  const blocks: BlockWithChildren[] = [];
  let cursor: string | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const block of response.results) {
      if ('type' in block) {
        const blockWithChildren: BlockWithChildren = block as BlockWithChildren;

        if (block.has_children) {
          blockWithChildren.children = await fetchBlocksRecursively(
            notion,
            block.id,
            depth + 1
          );
        }

        blocks.push(blockWithChildren);
      }
    }

    hasMore = response.has_more;
    cursor = response.next_cursor || undefined;
  }

  return blocks;
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
        console.warn(
          `Unhandled property type: ${(property as { type: string }).type}`
        );
        break;
    }
  }

  return copiedProperties;
}

async function appendBlocks(
  notion: Client,
  pageId: string,
  sourceBlocks: BlockWithChildren[]
) {
  const blocksToAppend: any[] = [];
  const blocksWithChildrenMap: Map<number, BlockWithChildren[]> = new Map();

  // 最初に親ブロックのみを準備し、子ブロックは別途記録
  for (let i = 0; i < sourceBlocks.length; i++) {
    const block = sourceBlocks[i];
    const {
      id,
      created_time,
      created_by,
      last_edited_time,
      last_edited_by,
      parent,
      children,
      ...blockWithoutMetadata
    } = block;

    // ブロック内容のクリーンアップ
    const cleanedBlock = cleanBlockContent(blockWithoutMetadata);

    if (cleanedBlock.type === 'to_do' && cleanedBlock.to_do) {
      (cleanedBlock.to_do as { checked: boolean }).checked = false;
    }

    // 子ブロックがある場合は別途記録（APIには送信しない）
    if (children && children.length > 0) {
      blocksWithChildrenMap.set(i, children);
    }

    blocksToAppend.push(cleanedBlock);
  }

  // 親ブロックを追加
  const result = await notion.blocks.children.append({
    block_id: pageId,
    children: blocksToAppend,
  });

  // 子ブロックがあるものについて、順次追加（再帰的に処理）
  for (const [blockIndex, children] of blocksWithChildrenMap.entries()) {
    const parentBlockId = result.results[blockIndex].id;
    await appendBlocks(notion, parentBlockId, children);
  }

  return result;
}

function cleanBlockContent(block: any): any {
  const cleaned = JSON.parse(JSON.stringify(block));

  // rich_textを含むブロックタイプをクリーンアップ
  const blockTypeProperty = cleaned[cleaned.type];
  if (blockTypeProperty && blockTypeProperty.rich_text) {
    blockTypeProperty.rich_text = cleanRichText(blockTypeProperty.rich_text);
  }

  return cleaned;
}

function cleanRichText(richText: any[]): any[] {
  return richText.map((item: any) => {
    if (item.mention) {
      if (isValidMention(item.mention)) {
        return item;
      } else {
        return {
          type: 'text',
          text: {
            content: item.plain_text || '[mention]',
            link: null,
          },
          annotations: item.annotations || {},
        };
      }
    }
    return item;
  });
}

function isValidMention(mention: any): boolean {
  const mentionObj = mention;

  // userタイプ
  if (
    mentionObj.user?.id &&
    typeof mentionObj.user.id === 'string' &&
    mentionObj.user.id.length > 0
  ) {
    return true;
  }

  // pageタイプ
  if (
    mentionObj.page?.id &&
    typeof mentionObj.page.id === 'string' &&
    mentionObj.page.id.length > 0
  ) {
    return true;
  }

  // databaseタイプ
  if (
    mentionObj.database?.id &&
    typeof mentionObj.database.id === 'string' &&
    mentionObj.database.id.length > 0
  ) {
    return true;
  }

  // dateタイプ
  if (mentionObj.date?.start && typeof mentionObj.date.start === 'string') {
    return true;
  }

  // template_mentionタイプ
  if (mentionObj.template_mention?.type) {
    return true;
  }

  return false;
}
