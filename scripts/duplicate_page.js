const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const databaseId = process.argv[2];

  const response = await notion.databases.query({
    database_id: databaseId,
    page_size: 1,
    filter: {
      property: 'Tags',
      multi_select: {
        contains: 'diary',
      },
    },
    sorts: [
      {
        property: 'Name',
        direction: 'descending',
      },
    ],
  });
  // console.log('Got response:', response);

  if (response.results.length > 0) {
    console.log(JSON.stringify(response.results[0], null, 2));
  }

  const pageData = response.results.length > 0 ? response.results[0] : null;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
