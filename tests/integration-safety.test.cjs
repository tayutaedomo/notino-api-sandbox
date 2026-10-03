const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createRun, readState, acquireLock, IntegrationTransport } = require('../scripts/lib/integration_safety');
const parent = '00000000-0000-0000-0000-000000000001';
/** @param {(ctx: {file:string, dir:string, guard:import('../scripts/lib/integration_safety').IntegrationTransport, calls: Array<{url:string, init:RequestInit|undefined}>}) => Promise<void>} task */
async function scenario(task) {
  const dir = mkdtempSync(path.join(tmpdir(), 'notion-safety-')); let now = Date.now();
  /** @type {Array<{url:string, init:RequestInit|undefined}>} */
  const calls = []; let index = 0;
  const fetch = /** @type {typeof globalThis.fetch} */ (async (input, init) => {
    calls.push({ url: String(input), init }); index++;
    return Response.json({ object: 'database', id: 'db-' + index, data_sources: [{ id: 'ds-' + index }], parent: { type: 'page_id', page_id: parent } });
  });
  const file = createRun(dir, parent);
  const guard = new IntegrationTransport(file, fetch, { now: () => now, sleep: async ms => { now += ms; } });
  try { await task({file, dir, guard, calls}); } finally { rmSync(dir, {recursive:true, force:true}); }
}
const dbRequest = () => ({ method:'POST', body:JSON.stringify({parent:{type:'page_id',page_id:parent},title:[{text:{content:'Test'}}],initial_data_source:{properties:{Name:{title:{}}}}}) });
test('DB作成の送信前後を記録しトークンを残さない', () => scenario(async ({file,dir,guard}) => {
  await guard.fetch('https://api.notion.com/v1/databases', {...dbRequest(), headers:{Authorization:'Bearer secret'}});
  const state = readState(file); assert.equal(state.resources.databases.length,1);
  const log = readFileSync(path.join(dir,state.id + '.jsonl'),'utf8');
  assert.match(log,/request_started/); assert.match(log,/request_finished/); assert.match(log,/db-1/); assert.doesNotMatch(log,/secret|Authorization/);
}));
test('DBは4個まで、上限超過は通信前に停止', () => scenario(async ({guard,calls}) => {
  for (let i=0;i<4;i++) await guard.fetch('https://api.notion.com/v1/databases',dbRequest());
  await assert.rejects(guard.fetch('https://api.notion.com/v1/databases',dbRequest()),/Database creation limit/); assert.equal(calls.length,4);
}));
test('親ページと無関係なリソースの操作を拒否', () => scenario(async ({guard,calls}) => {
  await assert.rejects(guard.fetch('https://api.notion.com/v1/databases',{method:'POST',body:JSON.stringify({parent:{page_id:'production'}})}),/parent/);
  await assert.rejects(guard.fetch('https://api.notion.com/v1/pages/production',{method:'PATCH',body:JSON.stringify({in_trash:true})}),/owned/); assert.equal(calls.length,0);
}));
test('通信間隔を子プロセス用の別インスタンスにも引き継ぐ', () => scenario(async ({file,guard}) => {
  await guard.fetch('https://api.notion.com/v1/databases',dbRequest());
  const last = readState(file).lastRequestAt; let slept=0;
  const second = new IntegrationTransport(file, async () => Response.json({results:[]}), {now:()=>last, sleep:async ms=>{slept+=ms;}});
  await second.fetch('https://api.notion.com/v1/users'); assert.equal(slept,1000);
}));
test('429は再送せず、後片付けもRetry-Afterまで停止', () => scenario(async ({file,guard,calls}) => {
  await guard.fetch('https://api.notion.com/v1/databases',dbRequest());
  const limited = new IntegrationTransport(file,async()=>Response.json({code:'rate_limited'},{status:429,headers:{'Retry-After':'120'}}));
  await limited.fetch('https://api.notion.com/v1/users');
  await assert.rejects(guard.fetch('https://api.notion.com/v1/users'),/API stopped/); assert.equal(calls.length,1);
  guard.cleanup(); await assert.rejects(guard.fetch('https://api.notion.com/v1/databases/db-1',{method:'PATCH',body:JSON.stringify({in_trash:true})}),/Retry-After/);
}));
test('通信失敗の作成は結果不明として記録し新しい実行を拒否', () => scenario(async ({file,dir}) => {
  const broken = new IntegrationTransport(file,async()=>{throw new Error('secret token should not be logged');});
  await assert.rejects(broken.fetch('https://api.notion.com/v1/databases',dbRequest()),/request failed/);
  assert.equal(readState(file).pending.length,1); assert.throws(()=>createRun(dir,parent),/unfinished/);
  assert.doesNotMatch(readFileSync(path.join(dir,readState(file).id+'.jsonl'),'utf8'),/secret token/);
}));
test('排他ロックは同時実行を拒否', () => scenario(async ({dir}) => {
  const release=acquireLock(dir); try { assert.throws(()=>acquireLock(dir),/locked/); } finally {release();}
}));
test('後片付けモードで新規作成を拒否', () => scenario(async ({guard,calls}) => {
  guard.cleanup(); await assert.rejects(guard.fetch('https://api.notion.com/v1/databases',dbRequest()),/cleanup/); assert.equal(calls.length,0);
}));
