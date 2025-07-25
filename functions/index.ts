import { Request, Response } from 'express';
import { Client } from '@notionhq/client';
import { copyPage } from './lib/notion_copy_page';
import { duplicatePage } from './lib/notion_duplicate_page';
import { createPage } from './lib/notion_create_page';

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

  const titleSuffix = (req.query.title as string) || 'Title';
  const result = await createPage(notion, databaseId, titleSuffix);
  res.json(result);
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

  const result = await duplicatePage(notion, databaseId);
  res.json(result);
};


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
