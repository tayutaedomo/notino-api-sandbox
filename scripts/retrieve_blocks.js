const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const pageId = process.argv[2];

  const response = await notion.blocks.children.list({
    block_id: pageId,
  });
  console.log('Got response:', response);

  if (response.results.length > 0) {
    console.log(JSON.stringify(response.results[0], null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
