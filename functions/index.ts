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
