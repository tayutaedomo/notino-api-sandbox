import { Client } from '@notionhq/client';

async function main(): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const databaseId = process.argv[2];

  // Get today's date as `YYYY-MM-DD` format
  const todayStr = new Date().toISOString().split('T')[0];

  // Make title
  const titleSuffix = process.argv[3];
  const titleDayStr = todayStr.replace(/-/g, '').slice(2);
  const title = `${titleDayStr} ${titleSuffix}`;

  const newPage = await notion.pages.create({
    parent: {
      database_id: databaseId,
    },
    properties: {
      Title: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
      Date: {
        type: 'date',
        date: {
          start: todayStr,
          end: null,
          time_zone: null,
        },
      },
    },
  });
  console.log(JSON.stringify(newPage, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
