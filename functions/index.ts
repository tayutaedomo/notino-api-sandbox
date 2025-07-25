import { Request, Response } from 'express';
import { Client } from '@notionhq/client';
import {
  BlockObjectResponse,
  CreatePageResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { copyPage } from './lib/notion_copy_page';

export const helloWorld = (req: Request, res: Response) => {
  res.send('Hello, World!');
};

// Endpoint: notionAuth
export const notionAuth = async (req: Request, res: Response) => {
  const NOTION_KEY = process.env.NOTION_KEY || '';
  const notion = new Client({ auth: NOTION_KEY });
  const response = await notion.users.list({});
  res.json(response);
};

// Endpoint: notionCreatePage
export const notionCreatePage = async (req: Request, res: Response) => {
  const databaseId = req.query.id as string;
  if (!databaseId) {
    res.status(400).send('Database ID is required.');
    return;
  }

  const NOTION_KEY = process.env.NOTION_KEY || '';
  const notion = new Client({ auth: NOTION_KEY });

  // Get today's date as `YYYY-MM-DD` format
  const todayStr = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Make title
  const titleSuffix = req.query.title || ('Title' as string);
  const dateStr = todayStr.replace(/\//g, '-');
  const titleDayStr = todayStr.replace(/\//g, '').slice(2);
  const title = `${titleDayStr} ${titleSuffix}`;

  const newPage = await notion.pages.create({
    parent: {
      database_id: databaseId,
    },
    properties: {
      Title: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
      Date: {
        type: 'date',
        date: {
          start: dateStr,
          end: null,
          time_zone: null,
        },
      },
    },
  });

  res.json({ databaseId, newPage });
};

// Endpoint: notionDuplicatePage
export const notionDuplicatePage = async (req: Request, res: Response) => {
  const databaseId = req.query.id as string;
  if (!databaseId) {
    res.status(400).send('Page ID is required.');
    return;
  }

  const NOTION_KEY = process.env.NOTION_KEY || '';
  const notion = new Client({ auth: NOTION_KEY });

  const latestPage = await queryLatestPage(notion, databaseId);
  const latestBlocks = await queryLatestPageBlocks(notion, latestPage.id);

  const newPage = await createPage(notion, databaseId);
  console.log('New page created.', databaseId);

  const newBlocks = await appendBlocks(notion, newPage.id, latestBlocks);
  console.log('New blocks appended.', databaseId, newPage.id);

  res.json({ databaseId, newPage, newBlocks });
};

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
    return block;
  });

  return await notion.blocks.children.append({
    block_id: pageId,
    children: newBlocks as any,
  });
}

// Endpoint: notionCopyPage
export const notionCopyPage = async (req: Request, res: Response) => {
  const databaseId = req.query.db as string;
  const searchProperty = req.query.sp as string;
  const searchValue = req.query.sv as string;
  const sortProperty = req.query.so as string;
  const sortDirection = (req.query.sod as string) || 'descending';

  if (!databaseId || !searchProperty || !searchValue || !sortProperty) {
    res.status(400).send('Missing required parameters: db, sp, sv, so');
    return;
  }

  try {
    const NOTION_KEY = process.env.NOTION_KEY || '';
    
    const result = await copyPage(NOTION_KEY, {
      databaseId,
      searchProperty,
      searchValue,
      sortProperty,
      sortDirection,
    });

    res.json({ 
      databaseId,
      ...result,
    });
  } catch (error) {
    console.error('Error copying page:', error);
    if (error instanceof Error && error.message === 'No matching page found') {
      res.status(404).send('No matching page found');
    } else {
      res.status(500).send('Internal server error');
    }
  }
};
