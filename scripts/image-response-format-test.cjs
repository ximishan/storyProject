const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { generateSceneImage } = require("../electron/services.cjs");

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const PNG = Buffer.from(PNG_BASE64, "base64");

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  let call = 0;
  let port = 0;
  let flakyDownloads = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/asset.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG);
      return;
    }
    if (req.url === "/flaky.png") {
      flakyDownloads += 1;
      if (flakyDownloads < 3) {
        res.writeHead(502, { "content-type": "text/plain", "retry-after": "0" });
        res.end("temporary bad gateway");
      } else {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG);
      }
      return;
    }
    if (req.url === "/protected.png") {
      if (req.headers.authorization !== "Bearer sk-test") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing authorization" }));
      } else {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG);
      }
      return;
    }
    if (req.url === "/json-link") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: { url: `http://127.0.0.1:${port}/asset.png` } }));
      return;
    }
    if (req.url !== "/v1/images/generations") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    await readBody(req);
    call += 1;
    res.writeHead(200, { "content-type": "application/json" });
    if (call === 1) {
      res.end(JSON.stringify({ data: [{ image: PNG_BASE64 }] }));
    } else if (call === 2) {
      res.end(JSON.stringify({ result: { images: [{ image_url: `http://127.0.0.1:${port}/flaky.png` }] } }));
    } else if (call === 3) {
      res.end(JSON.stringify({ choices: [{ message: { content: `生成完成：![image](http://127.0.0.1:${port}/protected.png)` } }] }));
    } else if (call === 4) {
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${port}/json-link` }] }));
    } else {
      res.end(JSON.stringify({ id: "task-only-123", status: "queued" }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-image-response-"));
  const config = {
    image_provider: "custom_image",
    custom_image: {
      base_url: `http://127.0.0.1:${port}/v1`,
      api_key: "sk-test",
      model: "gpt-image-2",
      async_mode: false,
      submit_path: "/images/generations",
      quality: "high",
      response_format: "auto",
      moderation: "none",
      policy_fallback: false,
      image_field: "data.0.url",
      extra_body_json: "",
      ratio_mapping_json: "",
      proxy_url: ""
    }
  };
  try {
    for (let index = 1; index <= 4; index += 1) {
      const destination = path.join(tempDir, `${index}.png`);
      const result = await generateSceneImage({ config, prompt: `测试图片 ${index}`, destination, ratio: "1:1" });
      assert.ok(fs.existsSync(destination));
      assert.ok(fs.statSync(destination).size > 10);
      assert.ok(result.responseField);
    }
    assert.strictEqual(flakyDownloads, 3);
    const destination = path.join(tempDir, "5.png");
    await assert.rejects(
      generateSceneImage({ config, prompt: "任务模式", destination, ratio: "1:1" }),
      error => /返回了任务 ID/.test(error.message) && /response\.json/.test(error.message)
    );
    assert.ok(fs.existsSync(path.join(tempDir, "image-debug", "5-response.json")));
    console.log("Image response format, transient 502 retry, auth download and JSON indirection test passed");
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
