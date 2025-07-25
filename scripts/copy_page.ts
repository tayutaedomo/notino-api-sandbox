import { copyPage } from '../functions/lib/notion_copy_page';

async function main(): Promise<void> {
  const [databaseId, searchProperty, searchValue, sortProperty, sortDirection = 'descending'] = process.argv.slice(2);

  if (!databaseId || !searchProperty || !searchValue || !sortProperty) {
    console.error('Usage: node copy_page.ts <database_id> <search_property> <search_value> <sort_property> [sort_direction]');
    process.exit(1);
  }

  try {
    const result = await copyPage(process.env.NOTION_KEY || '', {
      databaseId,
      searchProperty,
      searchValue,
      sortProperty,
      sortDirection,
    });
    
    console.log('Created new page:', result.newPage);
    console.log('Copied blocks:', result.copiedBlocks);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });