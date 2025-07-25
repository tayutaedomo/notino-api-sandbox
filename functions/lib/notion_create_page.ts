import { Client } from '@notionhq/client';

export async function createPage(notion: Client, databaseId: string, titleSuffix: string) {
  // Get today's date as `YYYY-MM-DD` format
  const todayStr = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Make title
  const dateStr = todayStr.replace(/\//g, '-');
  const titleDayStr = todayStr.replace(/\//g, '').slice(2);
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
          start: dateStr,
          end: null,
          time_zone: null,
        },
      },
    },
  });

  return { databaseId, newPage };
}