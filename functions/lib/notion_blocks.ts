import {
  Client,
  isFullBlock,
  BlockObjectResponse,
  BlockObjectRequest,
  AppendBlockChildrenResponse,
  RichTextItemResponse,
} from '@notionhq/client';

type RichTextRequest = Extract<
  BlockObjectRequest,
  { paragraph: unknown }
>['paragraph']['rich_text'][number];
export interface PreparedBlock {
  request: BlockObjectRequest;
  children: PreparedBlock[];
  inlineCount: number;
}

export function cleanRichText(items: RichTextItemResponse[]): RichTextRequest[] {
  return items.map((item) => {
    const annotations = item.annotations;
    if (item.type === 'text')
      return {
        type: 'text',
        text: { content: item.text.content, link: item.text.link },
        annotations,
      };
    if (item.type === 'equation')
      return { type: 'equation', equation: { expression: item.equation.expression }, annotations };
    if (item.type === 'mention') {
      const mention = item.mention;
      if (mention.type === 'user' && mention.user?.id)
        return {
          type: 'mention',
          mention: { type: 'user', user: { id: mention.user.id } },
          annotations,
        };
      if (mention.type === 'page' && mention.page?.id)
        return {
          type: 'mention',
          mention: { type: 'page', page: { id: mention.page.id } },
          annotations,
        };
      if (mention.type === 'database' && mention.database?.id)
        return {
          type: 'mention',
          mention: { type: 'database', database: { id: mention.database.id } },
          annotations,
        };
      if (mention.type === 'date' && mention.date?.start)
        return { type: 'mention', mention: { type: 'date', date: mention.date }, annotations };
      if (mention.type === 'template_mention' && mention.template_mention?.type)
        return {
          type: 'mention',
          mention: { type: 'template_mention', template_mention: mention.template_mention },
          annotations,
        };
    }
    return {
      type: 'text',
      text: { content: item.plain_text || '[mention]', link: null },
      annotations,
    };
  });
}

// Only fields accepted by the creation API are copied from each response type.
const fields: Record<string, readonly string[]> = {
  paragraph: ['rich_text', 'color'],
  heading_1: ['rich_text', 'color', 'is_toggleable'],
  heading_2: ['rich_text', 'color', 'is_toggleable'],
  heading_3: ['rich_text', 'color', 'is_toggleable'],
  bulleted_list_item: ['rich_text', 'color'],
  numbered_list_item: ['rich_text', 'color'],
  quote: ['rich_text', 'color'],
  to_do: ['rich_text', 'color'],
  toggle: ['rich_text', 'color'],
  callout: ['rich_text', 'color', 'icon'],
  code: ['rich_text', 'caption', 'language'],
  equation: ['expression'],
  divider: [],
  breadcrumb: [],
  table_of_contents: ['color'],
  bookmark: ['url', 'caption'],
  embed: ['url', 'caption'],
  link_to_page: ['type', 'page_id', 'database_id', 'comment_id'],
  image: ['type', 'external', 'file', 'caption'],
  video: ['type', 'external', 'file', 'caption'],
  audio: ['type', 'external', 'file', 'caption'],
  pdf: ['type', 'external', 'file', 'caption'],
  file: ['type', 'external', 'file', 'caption', 'name'],
  table_row: ['cells'],
  table: ['table_width', 'has_column_header', 'has_row_header'],
  column_list: [],
  column: ['width_ratio'],
  synced_block: [],
};

function prepare(block: BlockObjectResponse, children: PreparedBlock[]): PreparedBlock {
  const keys = fields[block.type];
  if (!keys) throw new Error('Cannot copy block type: ' + block.type);
  const original = (block as unknown as Record<string, unknown>)[block.type] as Record<
    string,
    unknown
  >;
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    if (original[key] !== undefined) payload[key] = structuredClone(original[key]);
  }
  for (const key of ['rich_text', 'caption']) {
    if (Array.isArray(payload[key]))
      payload[key] = cleanRichText(payload[key] as RichTextItemResponse[]);
  }
  if (Array.isArray(payload.cells))
    payload.cells = (payload.cells as RichTextItemResponse[][]).map(cleanRichText);
  if (payload.file && typeof payload.file === 'object') {
    payload.type = 'external';
    payload.external = { url: (payload.file as { url: string }).url };
    delete payload.file;
  }
  if (
    payload.icon &&
    typeof payload.icon === 'object' &&
    (payload.icon as { type: string }).type === 'file'
  ) {
    payload.icon = {
      type: 'external',
      external: { url: (payload.icon as { file: { url: string } }).file.url },
    };
  }
  if (block.type === 'to_do') payload.checked = false;
  // A synced source is copied as independent content, not linked back to the original.
  if (block.type === 'synced_block') payload.synced_from = null;
  let inlineCount = 0;
  if (block.type === 'table') {
    if (!children.length || children.some((child) => child.request.type !== 'table_row'))
      throw new Error('Cannot copy table without table rows.');
    inlineCount = 1;
  } else if (block.type === 'column') {
    if (!children.length || children[0].inlineCount)
      throw new Error('Cannot copy column with an empty or structurally nested first block.');
    inlineCount = 1;
  } else if (block.type === 'column_list') {
    if (children.length < 2 || children.some((child) => child.request.type !== 'column'))
      throw new Error('Cannot copy column list without at least two columns.');
    inlineCount = 2;
  }
  if (inlineCount) payload.children = children.slice(0, inlineCount).map((child) => child.request);
  return {
    request: { object: 'block', type: block.type, [block.type]: payload } as BlockObjectRequest,
    children,
    inlineCount,
  };
}

export async function fetchPreparedBlocks(
  notion: Client,
  blockId: string,
): Promise<PreparedBlock[]> {
  const blocks: PreparedBlock[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const block of response.results) {
      if (!isFullBlock(block)) throw new Error('Block content is unavailable: ' + block.id);
      const children = block.has_children ? await fetchPreparedBlocks(notion, block.id) : [];
      blocks.push(prepare(block, children));
    }
    if (response.has_more && !response.next_cursor)
      throw new Error('Missing block pagination cursor.');
    cursor = response.has_more ? response.next_cursor! : undefined;
  } while (cursor);
  return blocks;
}

async function completeChildren(notion: Client, id: string, node: PreparedBlock): Promise<void> {
  // Tables and columns must include initial children when created. Retrieve their
  // new IDs only if those inline children need additional descendants.
  if (node.children.slice(0, node.inlineCount).some((child) => child.children.length)) {
    const existing = await notion.blocks.children.list({ block_id: id, page_size: 100 });
    if (existing.results.length < node.inlineCount)
      throw new Error('Created inline blocks are missing.');
    for (let i = 0; i < node.inlineCount; i++) {
      await completeChildren(notion, existing.results[i].id, node.children[i]);
    }
  }
  await appendPreparedBlocks(notion, id, node.children.slice(node.inlineCount));
}

export async function appendPreparedBlocks(
  notion: Client,
  blockId: string,
  blocks: PreparedBlock[],
): Promise<AppendBlockChildrenResponse> {
  const results: AppendBlockChildrenResponse['results'] = [];
  for (let offset = 0; offset < blocks.length; offset += 100) {
    const batch = blocks.slice(offset, offset + 100);
    const response = await notion.blocks.children.append({
      block_id: blockId,
      children: batch.map((block) => block.request),
    });
    if (response.results.length !== batch.length)
      throw new Error('Created block count does not match the request.');
    results.push(...response.results);
    for (let i = 0; i < batch.length; i++)
      await completeChildren(notion, response.results[i].id, batch[i]);
  }
  return { object: 'list', type: 'block', block: {}, has_more: false, next_cursor: null, results };
}
