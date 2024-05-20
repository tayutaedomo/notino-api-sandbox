const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const databaseId = process.argv[2];

  // 今日の日付を YYYY-MM-DD の形式で取得する
  const todayStr = new Date().toISOString().split('T')[0];

  // タイトルを作成する
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
