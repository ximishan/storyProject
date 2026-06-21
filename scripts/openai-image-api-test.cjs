const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { generateSceneImage, testConnection } = require("../electron/services.cjs");

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  let generationCalls = 0;
  let editCalls = 0;
  const server = http.createServer(async (req, res) => {
    try {
      assert.strictEqual(req.headers.authorization, "Bearer sk-local-test");
      const body = await readBody(req);
      if (req.url === "/codex/v1/images/generations") {
        generationCalls += 1;
        assert.match(req.headers["content-type"] || "", /application\/json/);
        const payload = JSON.parse(body.toString("utf8"));
        assert.strictEqual(payload.model, "gpt-image-2");
        assert.strictEqual(payload.quality, "high");
        assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, "response_format"), false);
        assert.ok(["1536x1024", "1024x1024"].includes(payload.size));
        assert.ok(payload.prompt);
      } else if (req.url === "/codex/v1/images/edits") {
        editCalls += 1;
        assert.match(req.headers["content-type"] || "", /multipart\/form-data; boundary=/);
        const text = body.toString("latin1");
        assert.match(text, /name="model"\r\n\r\ngpt-image-2/);
        assert.match(text, /name="quality"\r\n\r\nhigh/);
        assert.match(text, /name="response_format"\r\n\r\nb64_json/);
        assert.match(text, /name="image"; filename="reference\.png"/);
      } else {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `unexpected path ${req.url}` } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.stack || String(error) } }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-openai-image-"));
  const referenceImagePath = path.join(tempDir, "reference.png");
  fs.writeFileSync(referenceImagePath, Buffer.from(PNG_BASE64, "base64"));
  const config = {
    image_provider: "custom_image",
    custom_image: {
      display_name: "Mock GPT Image",
      base_url: `http://127.0.0.1:${address.port}/codex/v1/images/generations`,
      api_key: "sk-local-test",
      model: "gpt-image-2",
      async_mode: false,
      submit_path: "/images/generations",
      edit_path: "/images/edits",
      quality: "high",
      response_format: "auto",
      edit_response_format: "b64_json",
      status_path: "",
      task_id_field: "task_id",
      status_field: "status",
      image_field: "data.0.url",
      success_values: "succeeded,completed,success",
      extra_body_json: "",
      ratio_mapping_json: "",
      ratio: "16:9",
      resolution: "1k",
      concurrency: 1,
      proxy_url: ""
    }
  };
  try {
    const generated = path.join(tempDir, "generated.png");
    await generateSceneImage({ config, prompt: "一个小男孩", destination: generated, ratio: "16:9" });
    assert.ok(fs.existsSync(generated));

    const edited = path.join(tempDir, "edited.png");
    await generateSceneImage({ config, prompt: "保持人物，改成雨天", destination: edited, ratio: "16:9", referenceImagePath });
    assert.ok(fs.existsSync(edited));

    const tested = await testConnection(config, "image");
    assert.strictEqual(tested.ok, true);
    assert.match(tested.message, /连接成功/);
    assert.strictEqual(generationCalls, 2);
    assert.strictEqual(editCalls, 1);
    console.log("OpenAI-compatible image generation/edit integration test passed");
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
