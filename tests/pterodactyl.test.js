const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PterodactylClient, PterodactylApiError } = require('../src/pterodactyl');

async function panel(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return new PterodactylClient(`http://127.0.0.1:${server.address().port}/`, 'test-only-key');
}

test('API failures retain status without exposing upstream response details', async t => {
  const client = await panel(t, (_req, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ detail: 'private backend diagnostic' }] }));
  });
  await assert.rejects(client.request('/api/client'), error => {
    assert.ok(error instanceof PterodactylApiError);
    assert.equal(error.status, 403);
    assert.equal(error.message, 'Pterodactyl API 403');
    return true;
  });
});

test('all paginated servers are collected with authentication', async t => {
  const client = await panel(t, (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-only-key');
    const page = new URL(req.url, 'http://localhost').searchParams.get('page');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ attributes: { identifier: page } }], meta: { pagination: { total_pages: 2 } } }));
  });
  assert.deepEqual((await client.listServers()).map(server => server.attributes.identifier), ['1', '2']);
});

test('running server uptime is read from resources', async t => {
  const client = await panel(t, (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ attributes: { current_state: 'running', resources: { uptime: 65000 } } }));
  });
  assert.deepEqual(await client.getServerRuntime({ attributes: { identifier: 'demo' } }), { state: 'running', uptimeMs: 65000 });
});

test('suspended servers do not require a resource request', async () => {
  const client = new PterodactylClient('http://127.0.0.1:1', 'test-only-key');
  assert.deepEqual(await client.getServerRuntime({ attributes: { status: 'suspended' } }), { state: 'suspended', uptimeMs: 0 });
});
