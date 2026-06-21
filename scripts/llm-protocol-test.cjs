const assert = require("node:assert");
const http = require("node:http");
const { testModelConnection } = require("../electron/llm-planner.cjs");

(async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw);
      calls.push({ url: req.url, headers: req.headers, body });

      if (Object.prototype.hasOwnProperty.call(body, "temperature")) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "temperature unsupported" } }));
        return;
      }

      // 模拟部分中转站不接受 Anthropic 顶层 system 字段，验证程序会自动使用最小请求体重试。
      if (body.system) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid JSON in request body" } }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }]
      }));
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await testModelConnection({
      llm: {
        provider: "custom",
        protocol: "anthropic",
        api_key: "test-key",
        model: "test-claude",
        base_url: `http://127.0.0.1:${port}/v1`,
        proxy_url: ""
      }
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2, "Claude 原生 400 后应使用最小请求体重试一次");
    assert.equal(calls[0].url, "/v1/messages");
    assert.equal(calls[1].url, "/v1/messages");
    assert.equal(calls[0].body.temperature, undefined, "Claude 原生请求不应发送 temperature");
    assert.ok(calls[0].body.system, "首个请求应携带 system");
    assert.equal(calls[1].body.system, undefined, "回退请求应移除顶层 system");
    assert.match(calls[1].body.messages[0].content, /接口连通性测试助手/);
    console.log("LLM protocol compatibility test passed");
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
