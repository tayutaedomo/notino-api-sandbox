import { createNotionClient, resolveDataSource } from '../functions/lib/notion_client';

async function main(): Promise<void> {
  const notion = createNotionClient();
  const databaseId = process.argv[2];

  const dataSourceId = await resolveDataSource(notion, databaseId);
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
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
