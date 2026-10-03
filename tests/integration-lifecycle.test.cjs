const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createRun,readState,IntegrationTransport}=require('../scripts/lib/integration_safety');
const {provisionAndVerify,cleanupDatabases}=require('../scripts/integration');
const parent='00000000-0000-0000-0000-000000000001';
/** @param {string} failure */
async function lifecycle(failure) {
 const dir=mkdtempSync(path.join(tmpdir(),'notion-lifecycle-'));const file=createRun(dir,parent);const title='Notion API Test '+readState(file).id;let creates=0;let trashes=0;let now=Date.now();
 const transport=/** @type {typeof fetch} */ (async (input,init)=>{
  const url=new URL(String(input));const method=init?.method||'GET';
  if(url.pathname==='/v1/databases') {creates++;if(failure==='create'&&creates===2)return Response.json({code:'restricted_resource'},{status:403});return Response.json({object:'database',id:'db-'+creates,data_sources:[{id:'ds-'+creates}]});}
  if(method==='PATCH') {trashes++;if(failure==='cleanup')return Response.json({code:'restricted_resource'},{status:403});return Response.json({object:'database',id:url.pathname.split('/').pop(),in_trash:true});}
  return Response.json({object:'database',id:url.pathname.split('/').pop(),parent:{type:'page_id',page_id:parent},title:[{plain_text:title+' Retro'}]});
 });
 const guard=new IntegrationTransport(file,transport,{now:()=>now,sleep:async ms=>{now+=ms;}});let verified=false;
 try {
  const task=provisionAndVerify(file,guard,'test-key',async ids=>{assert.equal(ids.length,4);verified=true;if(failure==='verify')throw new Error('verification failed');});
  if(failure) await assert.rejects(task);else await task;
  assert.equal(creates,failure==='create'?2:4);assert.equal(verified,failure!=='create');
  assert.equal(trashes,failure==='create'?1:4);
  assert.equal(readState(file).status,failure==='cleanup'?'cleanup':'complete');
  assert.match(readFileSync(path.join(dir,readState(file).id+'.jsonl'),'utf8'),/verification_|provision_failed/);
  if(failure==='cleanup'){failure='';await cleanupDatabases(file,guard,'test-key');assert.equal(readState(file).status,'complete');assert.equal(trashes,8);}
 } finally {rmSync(dir,{recursive:true,force:true});}
}
for(const failure of ['', 'create','verify','cleanup'])test('DB自動準備と後片付け: '+(failure||'成功'),()=>lifecycle(failure));
test('通常起動はAPIを呼ばず予定を表示',()=>{
 const output=execFileSync('node',['--require','ts-node/register','scripts/integration.ts'],{env:{...process.env,NOTION_TEST_KEY:'',NOTION_TEST_PARENT_PAGE_ID:''},encoding:'utf8'});
 assert.match(output,/--execute/);assert.match(output,/DB.*4/);
});
