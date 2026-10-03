import { Client, isFullPage } from '@notionhq/client';
import { fetchPreparedBlocks, appendPreparedBlocks } from './notion_blocks';
import { resolveDataSource } from './notion_client';
import {
  CreatePageResponse,
} from '@notionhq/client';

export async function duplicatePage(notion: Client, databaseId: string) {
  const dataSourceId = await resolveDataSource(notion, databaseId);
  const latestPage = await queryLatestPage(notion, dataSourceId);
  if (!latestPage) throw new Error('No matching page found');
  const latestBlocks = await fetchPreparedBlocks(notion, latestPage.id);

  const newPage = await createPage(notion, dataSourceId);
  console.log('New page created.', databaseId);

  const newBlocks = await appendPreparedBlocks(notion, newPage.id, latestBlocks);
  console.log('New blocks appended.', databaseId, newPage.id);

  return { databaseId, newPage, newBlocks };
}

async function queryLatestPage(
  notion: Client,
  databaseId: string
) {
  const response = await notion.dataSources.query({
    data_source_id: databaseId,
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

  const page = response.results[0];
  if (!page) return null;
  if (!isFullPage(page)) throw new Error('Source page properties are unavailable.');
  return page;
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
      data_source_id: databaseId,
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
