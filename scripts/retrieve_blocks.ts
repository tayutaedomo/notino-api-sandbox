import { createNotionClient } from '../functions/lib/notion_client';

async function main() {
  const notion = createNotionClient();
  const pageId = process.argv[2];

  try {
    const response = await notion.blocks.children.list({
      block_id: pageId,
    });

    console.log('Got response:', response);

    if (response.results.length > 0) {
      console.log(JSON.stringify(response.results[0], null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
