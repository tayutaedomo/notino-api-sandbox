const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const run = promisify(execFile);
/** @param {Record<string, string>} settings @param {RegExp} message */
async function rejects(settings, message) {
  const env = { ...process.env, NOTION_TEST_KEY: '', NOTION_TEST_DB_ID_1: '', NOTION_TEST_DB_ID_2: '', NOTION_TEST_DB_ID_3: '', NOTION_TEST_DB_ID_4: '', NOTION_TEST_DATA_SOURCE_MAP: '', NOTION_TEST_SCENARIO: '', NOTION_TEST_LOG: '', ...settings, NODE_OPTIONS: '--require ' + path.resolve('tests/helpers/cli-mock.cjs') };
  await assert.rejects(run('node', ['--require', 'ts-node/register', 'scripts/verify_integration.ts'], { env, timeout: 30000 }), e => e instanceof Error && 'code' in e && e.code === 1 && 'stderr' in e && message.test(String(e.stderr)));
}
test('実API確認に通常のNOTION_KEYを流用しない', () => rejects({ NOTION_KEY: 'production-must-not-be-used' }, /NOTION_TEST_KEY is required/));
test('検証DBの不足は接続前に拒否', () => rejects({ NOTION_TEST_KEY: 'test-key' }, /NOTION_TEST_DB_ID_1 is required/));
test('同じ検証DBの重複指定を拒否', () => rejects({ NOTION_TEST_KEY: 'test-key', ...Object.fromEntries([1,2,3,4].map(i => ['NOTION_TEST_DB_ID_' + i, '00000000-0000-0000-0000-000000000001'])) }, /four distinct/));
test('検証DBのスキーマ不足は書き込み前に拒否', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'notion-preflight-')); const log = path.join(dir, 'requests.jsonl');
  try {
    await rejects({ NOTION_TEST_KEY: 'test-key', ...Object.fromEntries([1,2,3,4].map(i => ['NOTION_TEST_DB_ID_' + i, '00000000-0000-0000-0000-' + String(i).padStart(12,'0')])), NOTION_TEST_SCENARIO: 'http', NOTION_TEST_LOG: log }, /Date must be date/);
    assert.equal(existsSync(log), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
