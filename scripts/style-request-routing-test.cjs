const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { generateSceneImage } = require("../electron/services.cjs");
const { resolveVisualStyle } = require("../electron/visual-styles.cjs");

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9p8AAAAASUVORK5CYII=";

(async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      requests.push(parsed);
      res.setHeader("content-type", "application/json");
      if (requests.length === 1) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "content policy violation", code: "content_policy_violation" } }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ data: [{ b64_json: PNG_1X1 }] }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-style-route-"));
  const destination = path.join(tmp, "images", "1.png");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const realistic = resolveVisualStyle("realistic");
  const config = {
    image_provider: "modelscope",
    modelscope: {
      base_url: `http://127.0.0.1:${address.port}/v1`,
      api_key: "test-key",
      model: "test-image-model",
      response_format: "b64_json",
      negative_prompt_field: "negative_prompt",
      policy_fallback: true
    }
  };

  try {
    const result = await generateSceneImage({
      app: { isPackaged: false },
      config,
      prompt: "黑白纪实摄影，完全无彩色，1938年华北前线，一位医生正在为伤员做手术，鲜血，极近景，9:16竖构图",
      styleConfig: realistic,
      destination,
      ratio: "9:16",
      index: 1,
      materialSource: "ai",
      requestId: "style-route-test"
    });

    assert.equal(requests.length, 2, "内容审核后应只重试一次并成功");
    for (const request of requests) {
      assert.ok(request.prompt.startsWith(realistic.prefix), "最终请求缺少写实彩色前缀");
      assert.ok(request.prompt.endsWith(realistic.suffix), "最终请求缺少写实彩色后缀");
      assert.match(request.prompt, /自然色彩/);
      assert.doesNotMatch(request.prompt, /黑白纪实摄影|完全无彩色|纯灰阶黑白/);
      assert.equal(request.negative_prompt, realistic.negative_prompt, "负向提示词没有按原版配置发送");
    }
    assert.equal(result.styleId, "realistic");
    assert.equal(result.fallbackLevel, "minimal");
    assert.ok(fs.existsSync(destination));
    const auditPath = path.join(tmp, "image-debug", "1-style-audit.json");
    assert.ok(fs.existsSync(auditPath), "没有生成画风审计日志");
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    assert.equal(audit.selected_style_id, "realistic");
    assert.equal(audit.resolved_style_id, "realistic");
    assert.doesNotMatch(audit.final_positive_prompt, /黑白纪实摄影|完全无彩色/);
    console.log("Style request routing and content-policy retry test passed");
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
