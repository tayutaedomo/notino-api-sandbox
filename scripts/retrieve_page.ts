import { createNotionClient } from '../functions/lib/notion_client';

async function main(): Promise<void> {
  const notion = createNotionClient();
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
