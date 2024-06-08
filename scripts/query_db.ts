import { Client } from '@notionhq/client';

async function main(): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const databaseId = process.argv[2];

  const response = await notion.databases.query({
    database_id: databaseId,
    page_size: 3,
    sorts: [
      {
        property: 'Created time',
        direction: 'descending', // or ascending
      },
    ],
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
