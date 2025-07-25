import { Client } from '@notionhq/client';
import {
  BlockObjectResponse,
  CreatePageResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

export async function duplicatePage(notion: Client, databaseId: string) {
  const latestPage = await queryLatestPage(notion, databaseId);
  const latestBlocks = await queryLatestPageBlocks(notion, latestPage.id);

  const newPage = await createPage(notion, databaseId);
  console.log('New page created.', databaseId);

  const newBlocks = await appendBlocks(notion, newPage.id, latestBlocks);
  console.log('New blocks appended.', databaseId, newPage.id);

  return { databaseId, newPage, newBlocks };
}

async function queryLatestPage(
  notion: Client,
  databaseId: string
): Promise<any> {
  const response = await notion.databases.query({
    database_id: databaseId,
    page_size: 1,
    filter: {
      property: 'Tags',
      multi_select: {
        contains: 'diary',
      },
    },
    sorts: [
      {
        property: 'Name',
        direction: 'descending',
      },
    ],
  });

  return response.results.length > 0 ? response.results[0] : null;
}

async function queryLatestPageBlocks(
  notion: Client,
  pageId: string
): Promise<(PartialBlockObjectResponse | BlockObjectResponse)[]> {
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  return response.results.length > 0 ? response.results : [];
}

async function createPage(
  notion: Client,
  databaseId: string
): Promise<CreatePageResponse> {
  const todayStr = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const monthStr = todayStr.replace(/\//g, '').slice(0, 6);
  const titleDayStr = todayStr.replace(/\//g, '').slice(2);
  const title = `${titleDayStr} Diary`;

  return await notion.pages.create({
    parent: {
      database_id: databaseId,
    },
    // favorite: true, // Not supported yet?
    icon: {
      type: 'emoji',
      emoji: '😃',
    },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
      Month: {
        type: 'number',
        number: parseInt(monthStr),
      },
      Tags: {
        type: 'multi_select',
        multi_select: [
          {
            name: 'diary',
          },
        ],
      },
    },
  });
}

async function appendBlocks(
  notion: Client,
  pageId: string,
  sourceBlocks: (PartialBlockObjectResponse | BlockObjectResponse)[]
) {
  const newBlocks = sourceBlocks.map((block: any) => {
    delete block.id;

    if (block.type === 'to_do' && block.to_do) {
      block.to_do.checked = false;
    }

    return block;
  });

  return await notion.blocks.children.append({
    block_id: pageId,
    children: newBlocks as any,
  });
}