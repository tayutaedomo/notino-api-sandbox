const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const run = promisify(execFile);
for (const failure of ['', 'retro', 'body', 'sleep']) {
  test('all:create の順序と停止: ' + (failure || '成功'), async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notion-daily-'));
    const log = path.join(dir, 'requests.jsonl');
    const env = { ...process.env, NOTION_KEY: 'test-key', NOTION_DB_ID_1: 'retro', NOTION_DB_ID_2: 'body', NOTION_DB_ID_3: 'sleep', NOTION_DB_ID_4: 'diary', NOTION_DATA_SOURCE_MAP: '', NOTION_TEST_LOG: log, NOTION_TEST_FAIL_DB: failure, NODE_OPTIONS: '--require ' + path.resolve('tests/helpers/cli-mock.cjs') };
    try {
      /** @type {Error & {code?: number, stderr?: string} | undefined} */
      let error;
      let result;
      try { result = await run('yarn', ['all:create'], { env, timeout: 60000 }); } catch (e) { error = /** @type {Error & {code?: number, stderr?: string}} */ (e); }
      if (failure) { assert.equal(error?.code, 1); } else { assert.ok(result, error?.stderr); }
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const expected = ['retro', 'body', 'sleep'];
      if (failure) expected.splice(expected.indexOf(failure) + 1);
      assert.deepEqual(calls.map(c => c.db), expected);
      for (const call of calls) {
        assert.equal(call.body.properties.Name.title[0].text.content, '261003 ' + (/** @type {Record<string, string>} */ ({ retro: 'Retro', body: 'Body', sleep: 'Sleep' }))[call.db]);
        assert.equal(call.body.properties.Date.date.start, '2026-10-03');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
