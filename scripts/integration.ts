import { existsSync } from 'node:fs';
import path from 'node:path';
import { isFullPage } from '@notionhq/client';
import { createNotionClient } from '../functions/lib/notion_client';
import { type PreparedPool, preparePool, synchronizePool } from './lib/integration_pool';
import {
  acquireLock,
  completeRun,
  createRun,
  IntegrationTransport,
  LIMITS,
  readState,
  record,
  validId,
} from './lib/integration_safety';
import { verifyIntegration } from './verify_integration';

async function cleanupLegacyDatabases(
  file: string,
  guard: IntegrationTransport,
  key: string,
): Promise<void> {
  guard.cleanup();
  const notion = createNotionClient(key, { fetch: guard.fetch });
  let failed = false;
  for (const resource of readState(file).resources.databases.slice().reverse()) {
    if (resource.trashed) continue;
    try {
      const state = readState(file);
      const database = await notion.databases.retrieve({ database_id: resource.id });
      if (
        !('parent' in database) ||
        database.parent.type !== 'page_id' ||
        database.parent.page_id.replace(/-/g, '').toLowerCase() !==
          state.parent.replace(/-/g, '').toLowerCase() ||
        !database.title
          .map((item) => item.plain_text)
          .join('')
          .startsWith('Notion API Test ' + state.id + ' ')
      )
        throw new Error('Database ownership cannot be confirmed.');
      await notion.databases.update({ database_id: resource.id, in_trash: true });
    } catch {
      failed = true;
      record(file, 'cleanup_failed', { databaseId: resource.id });
    }
  }
  if (failed) throw new Error('Cleanup incomplete. Use the logged run ID to resume cleanup.');
  completeRun(file);
}

export async function cleanupRun(
  file: string,
  guard: IntegrationTransport,
  key: string,
): Promise<void> {
  if (readState(file).databasePolicy !== 'retain') return cleanupLegacyDatabases(file, guard, key);
  guard.cleanup();
  const notion = createNotionClient(key, { fetch: guard.fetch });
  let failed = false;
  try {
    await synchronizePool(file, notion);
  } catch {
    failed = true;
    record(file, 'registry_recovery_failed');
  }
  for (const resource of readState(file).resources.pages.slice().reverse()) {
    if (resource.trashed) continue;
    try {
      const page = await notion.pages.retrieve({ page_id: resource.id });
      const sources = readState(file).resources.sources;
      if (!isFullPage(page) || page.parent.type !== 'data_source_id')
        throw new Error('Test page ownership changed.');
      const sourceId = page.parent.data_source_id;
      if (
        !sources.some(
          (id) => id.replace(/-/g, '').toLowerCase() === sourceId.replace(/-/g, '').toLowerCase(),
        )
      )
        throw new Error('Test page ownership changed.');
      await notion.pages.update({ page_id: resource.id, in_trash: true });
    } catch {
      failed = true;
      record(file, 'cleanup_failed', { pageId: resource.id });
    }
  }
  if (failed) throw new Error('Page cleanup incomplete. Resume using the logged run ID.');
  completeRun(file);
}

export async function provisionAndVerify(
  file: string,
  guard: IntegrationTransport,
  key: string,
  verify: (ids: string[], prepared: PreparedPool) => Promise<void>,
): Promise<void> {
  const notion = createNotionClient(key, { fetch: guard.fetch });
  try {
    const prepared = await preparePool(file, notion);
    record(file, 'verification_started');
    await verify(prepared.databaseIds, prepared);
    record(file, 'verification_succeeded');
  } catch {
    record(file, 'provision_failed');
    throw new Error('Preparation or verification failed. See the audit log.');
  } finally {
    await cleanupRun(file, guard, key);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let execute = false;
  let recover = false;
  let cleanupId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') execute = true;
    else if (args[i] === '--recover-lock') recover = true;
    else if (args[i] === '--cleanup') {
      cleanupId = args[++i];
      if (!cleanupId || !validId(cleanupId)) throw new Error('--cleanup requires a run UUID.');
    } else throw new Error('Unknown argument: ' + args[i]);
  }
  if (recover && !cleanupId) throw new Error('--recover-lock is only allowed with --cleanup.');
  if (!execute) {
    console.log(
      cleanupId
        ? '予定: 実行ID ' + cleanupId + ' の記録済み検証ページだけをゴミ箱へ移動。DBは維持。'
        : '予定: 初回だけ検証DB 4個を作成し、以後は再利用。ページ5個・本文6ブロック以内で検証し、検証ページだけをゴミ箱へ移動。',
    );
    console.log(
      '累計5回まで。通信上限: 通常' +
        LIMITS.requests +
        '件、後片付け' +
        LIMITS.cleanupRequests +
        '件、間隔1秒、24時間に1回。実API操作には --execute を指定してください。',
    );
    return;
  }
  const key = process.env.NOTION_TEST_KEY?.trim();
  if (!key) throw new Error('NOTION_TEST_KEY is required.');
  const parent = process.env.NOTION_TEST_PARENT_PAGE_ID?.trim();
  if (!cleanupId && (!parent || !validId(parent)))
    throw new Error('NOTION_TEST_PARENT_PAGE_ID must be a dedicated page UUID.');
  const dir = path.resolve('.notion-test-runs');
  const release = acquireLock(dir, recover);
  let file: string | undefined;
  try {
    if (cleanupId) {
      const saved = path.join(dir, cleanupId + '.json');
      if (!existsSync(saved)) throw new Error('Run state was not found.');
      file = saved;
      if (readState(file).status === 'complete') {
        console.log('後片付けは完了済みです。');
        return;
      }
    } else file = createRun(dir, parent!);
    console.log(
      '実行ID: ' + readState(file).id + '\n操作ログ: ' + file.replace(/\.json$/, '.jsonl'),
    );
    const guard = new IntegrationTransport(file);
    if (cleanupId) await cleanupRun(file, guard, key);
    else {
      const notion = createNotionClient(key, { fetch: guard.fetch });
      const page = await notion.pages.retrieve({ page_id: parent! });
      if (!isFullPage(page) || page.in_trash)
        throw new Error('Dedicated parent page is unavailable.');
      await provisionAndVerify(file, guard, key, async (ids, prepared) => {
        const originalFetch = globalThis.fetch;
        const original = { ...process.env };
        try {
          globalThis.fetch = guard.fetch;
          process.env.NOTION_TEST_RUN_FILE = file;
          process.env.NODE_OPTIONS =
            '--require ' + JSON.stringify(path.resolve('scripts/lib/integration-preload.cjs'));
          process.env.NOTION_TEST_DATA_SOURCE_MAP = '';
          ids.forEach((id, index) => {
            process.env['NOTION_TEST_DB_ID_' + (index + 1)] = id;
          });
          await verifyIntegration(guard, prepared);
        } finally {
          globalThis.fetch = originalFetch;
          for (const name of Object.keys(process.env))
            if (!(name in original)) delete process.env[name];
          Object.assign(process.env, original);
        }
      });
    }
    console.log('検証ページの後片付けが完了しました。検証用DBは再利用のため維持します。');
  } catch {
    if (file) {
      record(file, 'run_failed');
      const state = readState(file);
      if (state.status === 'running' && !state.counts.databases && !state.pending.length)
        completeRun(file);
    }
    throw new Error(
      '実行できませんでした。設定・状態・操作ログを確認してください。' +
        (file
          ? ' 実行ID: ' + readState(file).id
          : ' 未完了実行・24時間以内の再実行・ロックも確認してください。'),
    );
  } finally {
    release();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Integration failed.');
    process.exitCode = 1;
  });
