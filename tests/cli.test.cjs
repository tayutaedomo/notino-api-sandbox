const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const run = promisify(execFile);
const env = {
  ...process.env,
  NOTION_KEY: 'test-key',
  NOTION_DB_ID_1: 'retro',
  NOTION_DB_ID_2: 'body',
  NOTION_DB_ID_3: 'sleep',
  NOTION_DB_ID_4: 'diary',
  NOTION_PAGE_ID: 'source',
  NOTION_DATA_SOURCE_MAP: '',
  NOTION_TEST_LOG: '',
  NOTION_TEST_SCENARIO: 'cli',
  NODE_OPTIONS: '--require ' + path.resolve('tests/helpers/cli-mock.cjs'),
};
for (const [command, expected] of [
  ['auth', 'user'],
  ['search', 'data_source'],
  ['retro:query', 'source'],
  ['body:query', 'source'],
  ['sleep:query', 'source'],
  ['diary:query', 'source'],
  ['diary:page', 'source'],
  ['diary:blocks', 'block'],
  ['diary:dup', 'created-diary'],
  ['retro:dup', 'Copied blocks: 1'],
  ['diary:dup2', 'Copied blocks: 1'],
]) {
  test('CLI: ' + command, async () => {
    const { stdout } = await run('yarn', [command], { env, timeout: 30000 });
    assert.ok(stdout.includes(expected), stdout);
  });
}
test('CLIの必須引数なしは非0で終了', async () => {
  await assert.rejects(
    run('node', ['--require', 'ts-node/register', 'scripts/create_page.ts'], {
      env,
      timeout: 30000,
    }),
    (e) => e instanceof Error && 'code' in e && e.code === 1,
  );
});
