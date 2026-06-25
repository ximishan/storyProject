const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { completePipeline } = require('../electron/pipeline.cjs');
const { resolveVisualStyle } = require('../electron/visual-styles.cjs');
const { isCancellationError } = require('../electron/cancellation.cjs');

const png = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrV8AAAAASUVORK5CYII=', 'base64'),
  Buffer.alloc(1024)
]);

(async () => {
  let postCount = 0;
  let cancelRequested = false;
  const polls = new Map();
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      postCount += 1;
      const taskId = `task-${postCount}`;
      polls.set(taskId, 0);
      cancelRequested = true;
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: [{ status: 'submitted', task_id: taskId }] }));
      });
      return;
    }
    const match = req.url.match(/^\/v1\/tasks\/(task-\d+)$/);
    if (req.method === 'GET' && match) {
      const taskId = match[1];
      const count = (polls.get(taskId) || 0) + 1;
      polls.set(taskId, count);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (count < 2) {
        res.end(JSON.stringify({ code: 200, data: { status: 'processing', progress: 50 } }));
      } else {
        res.end(JSON.stringify({
          code: 200,
          data: {
            status: 'completed', progress: 100,
            result: { images: [{ url: [`http://127.0.0.1:${server.address().port}/image.png`] }] }
          }
        }));
      }
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
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storybound-soft-cancel-'));
    const style = resolveVisualStyle('realistic');
    const task = {
      id: 'soft-cancel-task',
      ratio: '9:16',
      material_source: 'ai',
      character_consistency_mode: 'off',
      reference_image_path: '',
      product_reference_image_path: '',
      style: style.id,
      style_config: style,
      task_type: 'story',
      podcast_image_mode: 'per_scene',
      current_step: 3,
      shouldCancel: () => cancelRequested
    };
    const config = {
      image_provider: 'apimart',
      apimart: {
        api_key: 'test-key',
        base_url: `http://127.0.0.1:${port}/v1`,
        model: 'gpt-image-2',
        ratio: '9:16',
        resolution: '1k',
        concurrency: 2,
        official_fallback: false,
        policy_fallback: false,
        poll_interval_ms: 20,
        poll_timeout_seconds: 30,
        proxy_url: ''
      },
      tts: { provider: 'system', system: { voice: '', volume: 100 } },
      media: { ffmpeg_path: '', bgm_path: '', use_default_bgm: false },
      jianying: { draft_path: '' }
    };
    const script = {
      title: '取消测试',
      scenes: Array.from({ length: 4 }, (_, index) => ({
        index: index + 1,
        narration: `第${index + 1}段旁白`,
        image_prompt: `第${index + 1}个写实彩色场景`,
        desc_prompt: `第${index + 1}个写实彩色场景`,
        image_status: 'pending',
        audio_status: 'pending'
      })),
      runtime: { current_stage: 'review', current_step: 3 }
    };

    let error = null;
    try {
      await completePipeline({
        app: { isPackaged: false }, task, config, outputDir, script,
        emit: () => {}, checkpoint: () => {}
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && isCancellationError(error), `expected cancellation, got ${error?.message}`);
    assert.ok(postCount >= 1 && postCount <= 2, `only in-flight workers may submit; got ${postCount}`);
    assert.ok(postCount < script.scenes.length, 'no later image scenes may be submitted');

    const snapshot = JSON.parse(fs.readFileSync(path.join(outputDir, 'pipeline.json'), 'utf8'));
    const completed = snapshot.scenes.filter(scene => scene.image_status === 'completed');
    const pending = snapshot.scenes.filter(scene => scene.image_status === 'pending');
    assert.equal(completed.length, postCount, 'every submitted task must be downloaded and marked completed');
    assert.ok(pending.length >= script.scenes.length - postCount, 'unsubmitted scenes remain pending');
    completed.forEach(scene => {
      assert.ok(scene.image_path && fs.statSync(scene.image_path).size > 512);
    });
    assert.equal(fs.readdirSync(path.join(outputDir, 'audio')).length, 0, 'audio stage must not start');
    assert.equal(snapshot.runtime.current_stage, 'cancelled_after_images');

    console.log('image-soft-cancel-test: ok');
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
