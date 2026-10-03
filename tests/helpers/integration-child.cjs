const nock=require('nock');nock.disableNetConnect();
const {page}=require('./fixtures.cjs');
const scope=nock('https://api.notion.com').persist();
scope.get('/v1/databases/db-1').reply(200,{object:'database',id:'db-1',data_sources:[{id:'ds-1'}]});
scope.post('/v1/pages').reply(200,page('test-page'));
require('../../scripts/lib/integration-preload.cjs');
