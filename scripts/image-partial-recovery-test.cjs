const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { completePipeline } = require('../electron/pipeline.cjs');
const { resolveVisualStyle } = require('../electron/visual-styles.cjs');

const png = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrV8AAAAASUVORK5CYII=', 'base64'),
  Buffer.alloc(1024)
]);

(async () => {
  let postCount = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      postCount += 1;
      const taskId = `task-${postCount}`;
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
      res.writeHead(200, { 'content-type': 'application/json' });
      if (taskId === 'task-2') {
        res.end(JSON.stringify({ code: 200, data: { status: 'failed', error: { message: '模拟单镜失败' } } }));
      } else {
        res.end(JSON.stringify({
          code: 200,
          data: {
            status: 'completed', progress: 100,
            result: { images: [{ url: [`http://127.0.0.1:${server.address().port}/image-${taskId}.png`] }] }
          }
        }));
      }
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/image-')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storybound-partial-images-'));
    const style = resolveVisualStyle('realistic');
    const task = {
      id: 'partial-image-task',
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
      pause_mode: 'every',
      pause_points: '[4]',
      shouldCancel: () => false
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
        request_timeout_seconds: 10,
        proxy_url: ''
      },
      tts: { provider: 'system', system: { voice: '', volume: 100 } },
      media: { ffmpeg_path: '', bgm_path: '', use_default_bgm: false },
      jianying: { draft_path: '' }
    };
    const script = {
      title: '局部失败测试',
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

    const result = await completePipeline({
      app: { isPackaged: false }, task, config, outputDir, script,
      emit: () => {}, checkpoint: () => {}
    });

    assert.equal(postCount, 4, '一个镜头失败后，其他镜头仍应全部提交');
    assert.equal(result.paused, true);
    assert.equal(result.partialImages, true);
    assert.equal(result.missingImageCount, 1);
    assert.deepEqual(result.failedSceneIndexes, [2]);
    const completed = result.script.scenes.filter(scene => scene.image_status === 'completed');
    const failed = result.script.scenes.filter(scene => scene.image_status === 'failed');
    assert.equal(completed.length, 3);
    assert.equal(failed.length, 1);
    assert.equal(result.script.runtime.current_stage, 'review_images_partial');
    assert.equal(fs.readdirSync(path.join(outputDir, 'audio')).length, 0, '存在缺图时不得进入配音阶段');
    console.log('image-partial-recovery-test: ok');
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
