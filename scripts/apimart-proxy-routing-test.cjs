const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { generateSceneImage } = require('../electron/services.cjs');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrV8AAAAASUVORK5CYII=',
  'base64'
);

(async () => {
  let proxyConnections = 0;
  let postCount = 0;
  let pollCount = 0;

  const target = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      postCount += 1;
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 200, data: [{ status: 'submitted', task_id: 'task-proxy-test' }] }));
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/tasks/task-proxy-test') {
      pollCount += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        code: 200,
        data: {
          status: 'completed',
          result: { images: [{ url: [`http://127.0.0.1:${target.address().port}/image.png`] }] }
        }
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/image.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));

  const proxy = http.createServer((req, res) => {
    proxyConnections += 1;
    let targetUrl;
    try { targetUrl = new URL(req.url); }
    catch { res.writeHead(400).end(); return; }
    const upstream = http.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || 80,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers: { ...req.headers, host: targetUrl.host }
    }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', error => res.writeHead(502).end(String(error)));
    req.pipe(upstream);
  });

  proxy.on('connect', (req, clientSocket, head) => {
    proxyConnections += 1;
    const [host, rawPort] = req.url.split(':');
    const upstream = net.connect(Number(rawPort) || 443, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
  });

  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storybound-apimart-proxy-test-'));
  const destination = path.join(dir, 'result.png');
  try {
    const result = await generateSceneImage({
      app: { isPackaged: false },
      config: {
        image_provider: 'apimart',
        apimart: {
          api_key: 'test-key',
          base_url: `http://127.0.0.1:${target.address().port}/v1`,
          proxy_url: `http://127.0.0.1:${proxy.address().port}`,
          model: 'gpt-image-2',
          ratio: '1:1',
          resolution: '1k',
          poll_interval_ms: 10,
          poll_timeout_seconds: 10,
          policy_fallback: false
        }
      },
      prompt: 'proxy route test',
      destination,
      ratio: '1:1',
      materialSource: 'ai'
    });

    assert.equal(result.provider, 'Apimart');
    assert.equal(postCount, 1);
    assert.equal(pollCount, 1);
    assert.ok(proxyConnections >= 1, 'Apimart requests did not pass through the configured proxy');
    assert.ok(fs.existsSync(destination));
    console.log(`apimart-proxy-routing-test: ok (proxy connections: ${proxyConnections})`);
  } finally {
    proxy.close();
    target.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
