const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createRun, readState, acquireLock, IntegrationTransport, runCli, LIMITS } = require('../scripts/lib/integration_safety');
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

test('ページと本文の上限も送信前に止める', () => scenario(async ({file,guard,calls}) => {
 await guard.fetch('https://api.notion.com/v1/databases',dbRequest());
 const state=readState(file); state.counts.pages=LIMITS.pages;state.resources.pages.push({id:'page-1',trashed:false});state.counts.blocks=LIMITS.blocks-1;
 writeFileSync(file,JSON.stringify(state));
 await assert.rejects(guard.fetch('https://api.notion.com/v1/pages',{method:'POST',body:JSON.stringify({parent:{data_source_id:'ds-1'}})}),/Page creation limit/);
 await assert.rejects(guard.fetch('https://api.notion.com/v1/blocks/page-1/children',{method:'PATCH',body:JSON.stringify({children:[{toggle:{children:[{paragraph:{}}]}}]})}),/Block creation limit/);
 assert.equal(calls.length,1);
}));
test('通常通信の上限に達しても後片付けの枠を確保', () => scenario(async ({file,guard,calls}) => {
 await guard.fetch('https://api.notion.com/v1/databases',dbRequest());
 const state=readState(file);state.counts.requests=LIMITS.requests;writeFileSync(file,JSON.stringify(state));
 await assert.rejects(guard.fetch('https://api.notion.com/v1/users'),/Request limit/);
 guard.cleanup();await guard.fetch('https://api.notion.com/v1/databases/db-1',{method:'PATCH',body:JSON.stringify({in_trash:true})});assert.equal(calls.length,2);
 const exhausted=readState(file);exhausted.counts.cleanupRequests=30;writeFileSync(file,JSON.stringify(exhausted));
 await assert.rejects(guard.fetch('https://api.notion.com/v1/users'),/Request limit/);
}));
test('完了後も24時間以内の再作成と累計5回超を拒否', () => scenario(async ({file,dir}) => {
 const state=readState(file);state.status='complete';writeFileSync(file,JSON.stringify(state));
 assert.throws(()=>createRun(dir,parent),/24 hours/);
 state.startedAt='2026-01-01T00:00:00Z';writeFileSync(file,JSON.stringify(state));
 for(let i=0;i<4;i++)writeFileSync(path.join(dir,'history-'+i+'.json'),JSON.stringify({...state,id:'history-'+i}));
 assert.throws(()=>createRun(dir,parent),/Lifetime run limit/);
}));
test('ログを書けない場合はAPIを送信しない', () => scenario(async ({file,guard,calls}) => {
 const log=file.replace(/\.json$/,'.jsonl');rmSync(log);require('node:fs').mkdirSync(log);
 await assert.rejects(guard.fetch('https://api.notion.com/v1/databases',dbRequest()));assert.equal(calls.length,0);
}));

test('実際のall:createの子プロセスにも監査と上限を適用', () => scenario(async ({file,guard}) => {
 await guard.fetch('https://api.notion.com/v1/databases',dbRequest());
 const env={...process.env,NOTION_TEST_RUN_FILE:file,NOTION_KEY:'test-key',NOTION_DATA_SOURCE_MAP:'',NOTION_DB_ID_1:'db-1',NOTION_DB_ID_2:'db-1',NOTION_DB_ID_3:'db-1',NOTION_DB_ID_4:'unused',NODE_OPTIONS:'--require '+JSON.stringify(path.resolve('tests/helpers/integration-child.cjs'))};
 await runCli(file,'yarn',['all:create'],{env,timeout:60000});
 const state=readState(file);assert.equal(state.counts.pages,3);assert.equal(state.counts.requests,7);
 const log=readFileSync(file.replace(/\.json$/,'.jsonl'),'utf8');assert.match(log,/cli_succeeded/);assert.match(log,/test-page/);
}));

test('ページのテンプレートと初期本文で上限を迂回できない', () => scenario(async ({guard,calls}) => {
 await guard.fetch('https://api.notion.com/v1/databases',dbRequest());
 for(const extra of [{template:{type:'default'}},{children:[{paragraph:{}}]}])await assert.rejects(guard.fetch('https://api.notion.com/v1/pages',{method:'POST',body:JSON.stringify({parent:{data_source_id:'ds-1'},...extra})}),/not permitted/);
 assert.equal(calls.length,1);
}));
test('CLIタイムアウトを記録して終了を待つ', () => scenario(async ({file}) => {
 await assert.rejects(runCli(file,process.execPath,['-e','setTimeout(()=>{},10000)'],{env:{...process.env,NODE_OPTIONS:''},timeout:100}),/CLI verification failed/);
 assert.match(readFileSync(file.replace(/\.json$/,'.jsonl'),'utf8'),/"interrupted":true/);
}));

test('仕上げ用の実API検証はページ5個と本文6個に制限', () => {
 assert.equal(LIMITS.pages,5);assert.equal(LIMITS.blocks,6);assert.equal(LIMITS.requests,80);
});
