import { Client } from '@notionhq/client';
import { resolveDataSource } from './notion_client';

export async function createPage(
  notion: Client,
  databaseId: string,
  titleSuffix: string
) {
  const dataSourceId = await resolveDataSource(notion, databaseId);
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
      type: 'data_source_id',
      data_source_id: dataSourceId,
    },
    properties: {
      Name: {
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
