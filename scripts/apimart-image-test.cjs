const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { generateSceneImage } = require('../electron/services.cjs');
const { isCancellationError } = require('../electron/cancellation.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrV8AAAAASUVORK5CYII=', 'base64');

(async () => {
  let postCount = 0;
  let pollCount = 0;
  const submittedBodies = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      postCount += 1;
      assert.equal(req.headers.authorization, 'Bearer test-key');
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body);
        submittedBodies.push(payload);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: [{ status: 'submitted', task_id: `task-${postCount}` }] }));
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/tasks/task-')) {
      pollCount += 1;
      assert.equal(req.headers.authorization, 'Bearer test-key');
      if (pollCount === 1) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'temporary unavailable' } }));
        return;
      }
      if (pollCount % 2 === 0) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: { status: 'processing', progress: 50 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        code: 200,
        data: {
          status: 'completed',
          progress: 100,
          result: { images: [{ url: [`http://127.0.0.1:${server.address().port}/image.png`] }] }
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

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const config = {
      image_provider: 'apimart',
      apimart: {
        api_key: 'test-key',
        base_url: `http://127.0.0.1:${port}/v1`,
        model: 'gpt-image-2',
        ratio: '9:16',
        resolution: '2k',
        concurrency: 2,
        official_fallback: true,
        policy_fallback: false,
        poll_interval_ms: 20,
        poll_timeout_seconds: 30,
        proxy_url: ''
      }
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storybound-apimart-test-'));
    const destination = path.join(dir, 'first.png');
    let cancelRequested = false;
    let remote = null;
    const result = await generateSceneImage({
      app: { isPackaged: false },
      config,
      prompt: '一位老人站在窗边，写实彩色摄影',
      destination,
      ratio: '9:16',
      materialSource: 'ai',
      shouldStopSubmitting: () => cancelRequested,
      onRemoteTask: value => {
        remote = value;
        cancelRequested = true;
      }
    });
    assert.ok(fs.existsSync(destination), 'submitted task must still download after soft cancel');
    assert.equal(postCount, 1, 'only one task should be submitted');
    assert.equal(remote.taskId, 'task-1');
    assert.equal(result.provider, 'Apimart');
    assert.equal(submittedBodies[0].model, 'gpt-image-2');
    assert.equal(submittedBodies[0].n, 1);
    assert.equal(submittedBodies[0].size, '9:16');
    assert.equal(submittedBodies[0].resolution, '2k');
    assert.equal(submittedBodies[0].official_fallback, true);

    // A task that has not been submitted must be blocked after cancellation.
    const beforeBlockedPost = postCount;
    let blockedError = null;
    try {
      await generateSceneImage({
        app: { isPackaged: false },
        config,
        prompt: '不应提交的新图片',
        destination: path.join(dir, 'blocked.png'),
        ratio: '9:16',
        materialSource: 'ai',
        shouldStopSubmitting: () => true
      });
    } catch (error) {
      blockedError = error;
    }
    assert.ok(blockedError && isCancellationError(blockedError));
    assert.equal(postCount, beforeBlockedPost, 'cancelled task must not submit a new image');

    // Resume must poll the existing task without creating another POST.
    pollCount = 2; // next poll returns completed in this test server.
    const beforeResumePost = postCount;
    const resumed = await generateSceneImage({
      app: { isPackaged: false },
      config,
      prompt: '恢复已有任务',
      destination: path.join(dir, 'resume.png'),
      ratio: '9:16',
      materialSource: 'ai',
      resumeTaskId: 'task-1',
      shouldStopSubmitting: () => true
    });
    assert.equal(postCount, beforeResumePost);
    assert.equal(resumed.taskId, 'task-1');
    assert.ok(fs.existsSync(path.join(dir, 'resume.png')));

    console.log('apimart-image-test: ok');
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
