import { createNotionClient } from '../functions/lib/notion_client';

async function main(): Promise<void> {
  const notion = createNotionClient();

  const response = await notion.users.list({});
  console.log('Got response:', response);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
