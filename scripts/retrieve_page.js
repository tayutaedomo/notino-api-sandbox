const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const pageId = process.argv[2];

  const response = await notion.pages.retrieve({
    page_id: pageId,
  });
  console.log('Got response:', response);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
