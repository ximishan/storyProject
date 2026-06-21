const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { generateSceneImage } = require("../electron/services.cjs");
const { regenerateScene } = require("../electron/pipeline.cjs");

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrV8AAAAASUVORK5CYII=";

(async () => {
  let postCount = 0;
  let pollCount = 0;
  let instantComplete = false;
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/codex/v1/images/generations") {
      postCount += 1;
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        assert.equal(req.headers.authorization, "Bearer test-key");
        JSON.parse(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          response: {
            poll_url: `http://127.0.0.1:${server.address().port}/api/image-tasks?ids=sync-gen-test`
          }
        }));
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/api/image-tasks?ids=")) {
      pollCount += 1;
      assert.equal(req.headers.authorization, "Bearer test-key");
      if (!instantComplete && pollCount <= 2) {
        res.writeHead(502, { "content-type": "text/html" });
        res.end("<html><body>Bad Gateway</body></html>");
        return;
      }
      if (!instantComplete && pollCount === 3) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ response: { status: "in_progress" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        response: {
          status: "completed",
          result: { images: [{ b64_json: pngBase64 }] }
        }
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-poll-test-"));
  const destination = path.join(tmp, "1.png");
  const config = {
    image_provider: "gpt_image",
    gpt_image: {
      api_key: "test-key",
      base_url: `http://127.0.0.1:${port}/codex/v1/images/generations`,
      model: "gpt-image-test",
      response_format: "auto",
      moderation: "none",
      policy_fallback: false,
      poll_interval_ms: 10,
      poll_timeout_seconds: 30
    }
  };

  let remote = null;
  const result = await generateSceneImage({
    app: { isPackaged: false }, config, prompt: "普通室内人物纪实画面",
    destination, ratio: "9:16", index: 1, materialSource: "ai",
    onRemoteTask: value => { remote = value; }
  });
  assert.ok(fs.existsSync(destination));
  assert.equal(postCount, 1);
  assert.ok(pollCount >= 4);
  assert.match(remote.taskId, /\/api\/image-tasks\?ids=sync-gen-test/);
  assert.equal(result.taskId, "sync-gen-test");

  instantComplete = true;
  const resumeDestination = path.join(tmp, "2.png");
  const beforePost = postCount;
  const resume = await generateSceneImage({
    app: { isPackaged: false }, config, prompt: "不会重新提交",
    destination: resumeDestination, ratio: "9:16", index: 2, materialSource: "ai",
    resumeTaskId: remote.taskId
  });
  assert.ok(fs.existsSync(resumeDestination));
  assert.equal(postCount, beforePost);
  assert.equal(resume.taskId, "sync-gen-test");

  const recoverDir = path.join(tmp, "recover-task");
  fs.mkdirSync(path.join(recoverDir, "image-debug"), { recursive: true });
  fs.writeFileSync(path.join(recoverDir, "image-debug", "9-download.json"), JSON.stringify({
    image_url: remote.taskId,
    response_field: "response.poll_url"
  }));
  const recoverScript = {
    scenes: [{ index: 9, narration: "旁白", image_prompt: "普通室内人物纪实画面", image_remote_task_id: "" }],
    runtime: {}
  };
  const beforeRecoverPost = postCount;
  await regenerateScene({
    app: { isPackaged: false },
    task: { id: "task-recover", ratio: "9:16", material_source: "ai", style_config: {} },
    config,
    outputDir: recoverDir,
    script: recoverScript,
    sceneIndex: 9,
    kind: "image"
  });
  assert.equal(postCount, beforeRecoverPost);
  assert.ok(fs.existsSync(path.join(recoverDir, "images", "9.png")));
  assert.equal(recoverScript.scenes[0].image_remote_task_id, "sync-gen-test");

  server.close();
  console.log("Image poll_url detection, 502 waiting, result extraction, checkpoint resume, and old debug recovery test passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
