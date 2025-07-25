import { Client } from '@notionhq/client';
import { duplicatePage } from '../functions/lib/notion_duplicate_page';

async function main(): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const databaseId = process.argv[2];

  if (!databaseId) {
    console.error('Usage: node duplicate_page.ts <database_id>');
    process.exit(1);
  }

  try {
    const result = await duplicatePage(notion, databaseId);
    console.log('Got new page:', result.newPage);
    console.log('Got new blocks:', JSON.stringify(result.newBlocks));
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });