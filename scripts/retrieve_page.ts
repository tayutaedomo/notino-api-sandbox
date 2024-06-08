import { Client } from '@notionhq/client';

async function main(): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const pageId = process.argv[2];

  try {
    const response = await notion.pages.retrieve({
      page_id: pageId,
    });
    console.log('Got response:', response);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
