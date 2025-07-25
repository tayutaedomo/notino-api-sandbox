import { Client } from '@notionhq/client';
import { createPage } from '../functions/lib/notion_create_page';

async function main(): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const databaseId = process.argv[2];
  const titleSuffix = process.argv[3];

  if (!databaseId || !titleSuffix) {
    console.error('Usage: node create_page.ts <database_id> <title_suffix>');
    process.exit(1);
  }

  try {
    const result = await createPage(notion, databaseId, titleSuffix);
    console.log(JSON.stringify(result.newPage, null, 2));
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