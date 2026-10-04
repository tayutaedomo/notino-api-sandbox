const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const path = require('node:path');
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}
/** @param {string} target @param {string} query @param {number} status @param {string} expected @param {string} scenario */
async function check(target, query, status, expected, scenario = 'http') {
  const port = await freePort();
  const bin = path.join(
    path.dirname(require.resolve('@google-cloud/functions-framework')),
    'main.js',
  );
  const child = spawn(
    process.execPath,
    [bin, '--target=' + target, '--source=dist/functions/index.js', '--port=' + port],
    {
      env: {
        ...process.env,
        NOTION_KEY: 'test-key',
        NOTION_DATA_SOURCE_MAP: '',
        NOTION_TEST_LOG: '',
        NOTION_TEST_SCENARIO: scenario,
        NODE_OPTIONS: '--require ' + path.resolve('tests/helpers/cli-mock.cjs'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(interval);
        reject(new Error(output || 'Framework startup timeout'));
      }, 10000);
      const interval = setInterval(() => {
        if (output.includes('URL:')) {
          clearTimeout(timer);
          clearInterval(interval);
          resolve(undefined);
        } else if (child.exitCode !== null) {
          clearTimeout(timer);
          clearInterval(interval);
          reject(new Error(output));
        }
      }, 20);
      child.once('error', reject);
    });
    const response = await fetch('http://127.0.0.1:' + port + '/' + query);
    assert.equal(response.status, status);
    assert.ok((await response.text()).includes(expected));
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
}
for (const [target, query, expected] of [
  ['helloWorld', '', 'Hello, World!'],
  ['notionAuth', '', 'user'],
  ['notionCreatePage', '?id=db&title=Retro', '261003 Retro'],
  ['notionDuplicatePage', '?id=db', '261003 Diary'],
  ['notionCopyPage', '?db=db&sp=Name&sv=Retro&so=Created%20time', 'copiedBlocks'],
]) {
  test('HTTP成功: ' + target, () => check(target, query, 200, expected));
}
for (const target of ['notionCreatePage', 'notionDuplicatePage', 'notionCopyPage'])
  test('HTTP必須入力: ' + target, () => check(target, '', 400, 'required'));
test('HTTPコピー対象なし', () =>
  check(
    'notionCopyPage',
    '?db=db&sp=Name&sv=missing&so=Name',
    404,
    'No matching page found',
    'empty-copy',
  ));
test('HTTPコピー失敗', () =>
  check(
    'notionCopyPage',
    '?db=db&sp=Name&sv=Retro&so=Name',
    500,
    'Internal server error',
    'api-error',
  ));
