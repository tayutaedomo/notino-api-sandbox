const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_KEY });
  const databaseId = process.argv[2];

  const latestPage = await queryLatestPage(notion, databaseId);
  const latestBlocks = await queryLatestPageBlocks(notion, latestPage.id);
  // console.log('Got latest page:', JSON.stringify(latestPage, null, 2));
  // console.log('Got latest blocks:', JSON.stringify(latestBlocks));

  const newPage = await createPage(notion, databaseId, latestBlocks);
  console.log('Got new page:', newPage);

  const newBlocks = await appendBlocks(notion, newPage.id, latestBlocks);
  console.log('Got new blocks:', JSON.stringify(newBlocks));
}

async function queryLatestPage(notion, databaseId) {
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

  return response.results.length > 0 ? response.results[0] : null;
}

async function queryLatestPageBlocks(notion, pageId) {
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  return response.results.length > 0 ? response.results : [];
}

async function createPage(notion, databaseId) {
  const todayStr = new Date().toISOString().split('T')[0];
  const monthStr = todayStr.replace(/-/g, '').slice(0, 6);
  const titleDayStr = todayStr.replace(/-/g, '').slice(2);
  const title = `${titleDayStr} Diary`;

  return await notion.pages.create({
    parent: {
      database_id: databaseId,
    },
    // favorite: true, // Not supported yet?
    icon: {
      type: 'emoji',
      emoji: '😃',
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
      Month: {
        type: 'number',
        number: parseInt(monthStr),
      },
      Tags: {
        type: 'multi_select',
        multi_select: [
          {
            name: 'diary',
          },
        ],
      },
    },
  });
}

// Not supported yet?
// async function addToFavorite(notion, pageId) {
//   return await notion.pages.update({
//     page_id: pageId,
//     favorite: true,
//   });
// }

async function appendBlocks(notion, pageId, sourceBlocks) {
  const newBlocks = sourceBlocks.map((block) => {
    delete block.id;
    return block;
  });

  return await notion.blocks.children.append({
    block_id: pageId,
    children: newBlocks,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
