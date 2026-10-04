const loader = require('ts-node').register();
const { IntegrationTransport } = require('./integration_safety');
// The CLI's own ts-node must compile each file only once.
loader.enabled(false);
if (!process.env.NOTION_TEST_RUN_FILE) throw new Error('Audited integration run is required.');
globalThis.fetch = new IntegrationTransport(process.env.NOTION_TEST_RUN_FILE).fetch;
