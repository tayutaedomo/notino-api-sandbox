const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRun, readState, IntegrationTransport } = require('../scripts/lib/integration_safety');
const { provisionAndVerify, cleanupRun } = require('../scripts/integration');
const { createNotionClient } = require('../functions/lib/notion_client');
const parent = '00000000-0000-0000-0000-000000000001';
/** @param {(ctx:{dir:string,file:string,guard:import('../scripts/lib/integration_safety').IntegrationTransport, counts:{creates:number,dbTrash:number,pageTrash:number}, setFailure:(value:string)=>void, next:()=>{file:string,guard:import('../scripts/lib/integration_safety').IntegrationTransport}, verify:(ids:string[],guard:import('../scripts/lib/integration_safety').IntegrationTransport)=>Promise<void>})=>Promise<void>} task */
async function scenario(task) {
  const dir = mkdtempSync(path.join(tmpdir(), 'notion-reuse-'));
  const file = createRun(dir, parent);
  let failure = '';
  let now = Date.now();
  const counts = { creates: 0, dbTrash: 0, pageTrash: 0 };
  /** @type {Map<string,any>} */ const databases = new Map();
  let pageNumber = 0;
  const transport = /** @type {typeof fetch} */ (
    async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method || 'GET';
      const id = url.pathname.split('/')[3];
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.pathname === '/v1/databases') {
        counts.creates++;
        if (failure === 'create' && counts.creates === 2)
          return Response.json({ code: 'restricted_resource' }, { status: 403 });
        const value = {
          object: 'database',
          id: 'db-' + counts.creates,
          title: body.title.map((/** @type {any} */ t) => ({ plain_text: t.text.content })),
          parent: { type: 'page_id', page_id: parent },
          in_trash: false,
          data_sources: [{ id: 'ds-' + counts.creates }],
          properties: body.initial_data_source.properties,
        };
        databases.set(value.id, value);
        return Response.json(value);
      }
      if (method === 'PATCH') {
        if (url.pathname.includes('/databases/')) counts.dbTrash++;
        else counts.pageTrash++;
        if (failure === 'cleanup')
          return Response.json({ code: 'restricted_resource' }, { status: 403 });
        return Response.json({ id, in_trash: true });
      }
      if (url.pathname === '/v1/pages')
        return Response.json({ object: 'page', id: 'page-' + ++pageNumber });
      if (url.pathname.includes('/pages/'))
        return Response.json({
          object: 'page',
          id,
          url: 'https://example.com/test',
          parent: {
            type: 'data_source_id',
            data_source_id: failure === 'page-parent' ? 'external-source' : 'ds-1',
          },
        });
      if (url.pathname.includes('/data_sources/')) {
        const value = databases.get(id.replace('ds-', 'db-'));
        /** @type {Record<string,any>} */
        const properties = Object.fromEntries(
          Object.entries(value.properties).map(([name, value]) => [
            name,
            { type: Object.keys(/** @type {object} */ (value))[0] },
          ]),
        );
        if (properties.Status)
          properties.Status = {
            type: failure === 'schema' ? 'number' : 'status',
            status: { options: [{ name: 'Not started' }] },
          };
        return Response.json({ object: 'data_source', id, properties });
      }
      const value = databases.get(id);
      if (failure === 'missing')
        return Response.json({ code: 'object_not_found' }, { status: 404 });
      return Response.json({
        ...value,
        ...(failure === 'parent' ? { parent: { type: 'page_id', page_id: 'other' } } : {}),
        ...(failure === 'name' ? { title: [{ plain_text: 'Other DB' }] } : {}),
        ...(failure === 'source' ? { data_sources: [{ id: 'other-source' }] } : {}),
        ...(failure === 'trash' ? { in_trash: true } : {}),
      });
    }
  );
  const makeGuard = (/** @type {string} */ file) =>
    new IntegrationTransport(file, transport, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
  const verify = async (
    /** @type {string[]} */ ids,
    /** @type {import('../scripts/lib/integration_safety').IntegrationTransport} */ guard,
  ) => {
    assert.equal(ids.length, 4);
    await createNotionClient('test-key', { fetch: guard.fetch }).pages.create({
      parent: { data_source_id: 'ds-1' },
      properties: { Name: { title: [] } },
    });
    if (failure === 'verify') throw new Error('Verification failed');
  };
  try {
    await task({
      dir,
      file,
      guard: makeGuard(file),
      counts,
      setFailure: (value) => {
        failure = value;
      },
      verify,
      next: () => {
        const state = readState(file);
        state.startedAt = '2026-01-01T00:00:00Z';
        writeFileSync(file, JSON.stringify(state));
        const nextFile = createRun(dir, parent);
        return { file: nextFile, guard: makeGuard(nextFile) };
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('初回は4DBを登録し、検証ページだけを片付ける', () =>
  scenario(async ({ dir, file, guard, counts, verify }) => {
    await provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard));
    assert.deepEqual(counts, { creates: 4, dbTrash: 0, pageTrash: 1 });
    assert.equal(readState(file).status, 'complete');
    const pool = JSON.parse(readFileSync(path.join(dir, 'pool.json'), 'utf8'));
    assert.equal(pool.databases.length, 4);
    assert.ok(pool.databases.every((/** @type {any} */ db) => db.dataSourceId));
  }));
test('2回目は同じDBを再利用し追加作成しない', () =>
  scenario(async ({ dir, file, guard, counts, verify, next }) => {
    await provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard));
    const second = next();
    await provisionAndVerify(second.file, second.guard, 'test-key', (ids) =>
      verify(ids, second.guard),
    );
    assert.deepEqual(counts, { creates: 4, dbTrash: 0, pageTrash: 2 });
    assert.match(
      readFileSync(path.join(dir, readState(second.file).id + '.jsonl'), 'utf8'),
      /database_reused/,
    );
  }));
for (const failure of ['missing', 'parent', 'name', 'schema', 'source', 'trash'])
  test('不正な既存DBを置換しない: ' + failure, () =>
    scenario(async ({ file, guard, counts, verify, next, setFailure }) => {
      await provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard));
      const second = next();
      setFailure(failure);
      await assert.rejects(
        provisionAndVerify(second.file, second.guard, 'test-key', (ids) =>
          verify(ids, second.guard),
        ),
      );
      assert.equal(counts.creates, 4);
      assert.equal(counts.dbTrash, 0);
      assert.equal(counts.pageTrash, 1);
    }),
  );
test('検証失敗後もDBを維持してページだけ片付ける', () =>
  scenario(async ({ file, guard, counts, verify, setFailure }) => {
    setFailure('verify');
    await assert.rejects(provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard)));
    assert.deepEqual(counts, { creates: 4, dbTrash: 0, pageTrash: 1 });
    assert.equal(readState(file).status, 'complete');
  }));
test('ページの後片付けを再開できる', () =>
  scenario(async ({ file, guard, counts, verify, setFailure }) => {
    setFailure('cleanup');
    await assert.rejects(provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard)));
    assert.equal(readState(file).status, 'cleanup');
    setFailure('');
    await cleanupRun(file, guard, 'test-key');
    assert.equal(readState(file).status, 'complete');
    assert.equal(counts.dbTrash, 0);
  }));
test('初期DBの作成失敗を記録し、結果不明な作成を繰り返さない', () =>
  scenario(async ({ file, guard, counts, verify, next, setFailure }) => {
    setFailure('create');
    await assert.rejects(provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard)));
    setFailure('');
    const second = next();
    await assert.rejects(
      provisionAndVerify(second.file, second.guard, 'test-key', (ids) => verify(ids, second.guard)),
    );
    assert.equal(counts.creates, 2);
    assert.equal(counts.dbTrash, 0);
  }));
test('管理ファイルが消えても既存DBを増やさない', () =>
  scenario(async ({ dir, file, guard, counts, verify, next }) => {
    await provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard));
    unlinkSync(path.join(dir, 'pool.json'));
    const second = next();
    await assert.rejects(
      provisionAndVerify(second.file, second.guard, 'test-key', (ids) => verify(ids, second.guard)),
    );
    assert.equal(counts.creates, 4);
  }));
test('再利用DBの削除は通信前に拒否', () =>
  scenario(async ({ file, guard, counts, verify }) => {
    await provisionAndVerify(file, guard, 'test-key', async (ids) => {
      await assert.rejects(
        guard.fetch('https://api.notion.com/v1/databases/' + ids[0], {
          method: 'PATCH',
          body: JSON.stringify({ in_trash: true }),
        }),
        /cannot be trashed/,
      );
      await verify(ids, guard);
    });
    assert.equal(counts.dbTrash, 0);
  }));
test('DB ID記録直前の中断は実行状態から管理ファイルを復元', () =>
  scenario(async ({ dir, file, guard, counts, verify }) => {
    await provisionAndVerify(file, guard, 'test-key', async (ids) => {
      const registry = path.join(dir, 'pool.json');
      const pool = JSON.parse(readFileSync(registry, 'utf8'));
      pool.databases.pop();
      writeFileSync(registry, JSON.stringify(pool));
      await verify(ids, guard);
    });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'pool.json'), 'utf8')).databases.length, 4);
    assert.equal(counts.creates, 4);
    assert.equal(counts.dbTrash, 0);
  }));
test('壊れた管理ファイルを自動で作り直さない', () =>
  scenario(async ({ dir, file, guard, counts, verify, next }) => {
    await provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard));
    const second = next();
    writeFileSync(path.join(dir, 'pool.json'), '{bad');
    await assert.rejects(
      provisionAndVerify(second.file, second.guard, 'test-key', (ids) => verify(ids, second.guard)),
    );
    assert.equal(counts.creates, 4);
    assert.equal(counts.dbTrash, 0);
  }));
test('所属が変わったページを削除せず停止する', () =>
  scenario(async ({ file, guard, counts, verify, setFailure }) => {
    setFailure('page-parent');
    await assert.rejects(provisionAndVerify(file, guard, 'test-key', (ids) => verify(ids, guard)));
    assert.equal(counts.pageTrash, 0);
    assert.equal(counts.dbTrash, 0);
    setFailure('');
    await cleanupRun(file, guard, 'test-key');
    assert.equal(counts.pageTrash, 1);
  }));
test('通常起動は通信なしで初回作成と再利用の予定を表示', () => {
  const output = execFileSync('node', ['--require', 'ts-node/register', 'scripts/integration.ts'], {
    env: { ...process.env, NOTION_TEST_KEY: '', NOTION_TEST_PARENT_PAGE_ID: '' },
    encoding: 'utf8',
  });
  assert.match(output, /--execute/);
  assert.match(output, /再利用/);
});
