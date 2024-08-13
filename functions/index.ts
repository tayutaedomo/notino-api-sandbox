import { Request, Response } from 'express';
import { Client } from '@notionhq/client';

export const helloWorld = (req: Request, res: Response) => {
  res.send('Hello, World!');
};

export const notionAuth = async (req: Request, res: Response) => {
  const NOTION_KEY = process.env.NOTION_KEY || '';
  const notion = new Client({ auth: NOTION_KEY });
  const response = await notion.users.list({});
  res.json(response);
};

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
