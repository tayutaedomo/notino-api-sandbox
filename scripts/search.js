const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_KEY });

  const response = await notion.search({
    query: '',
  });
  console.log('Got response:', response);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
