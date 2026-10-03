require('ts-node/register');
const { IntegrationTransport } = require('./integration_safety');
if (!process.env.NOTION_TEST_RUN_FILE) throw new Error('Audited integration run is required.');
globalThis.fetch = new IntegrationTransport(process.env.NOTION_TEST_RUN_FILE).fetch;
