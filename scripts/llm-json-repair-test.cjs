const assert = require("node:assert");
const http = require("node:http");
const { cleanJsonText, testModelConnection } = require("../electron/llm-planner.cjs");

(async () => {
  const locallyRepaired = cleanJsonText(
    '{"title":"测试","summary":"一句摘要","narration":"他说："努力吧！"然后继续前进。\n第二行",}'
  );
  assert.equal(locallyRepaired.title, "测试");
  assert.equal(locallyRepaired.narration, '他说："努力吧！"然后继续前进。\n第二行');

  assert.throws(() => cleanJsonText(`{
    "scenes": [
      {
        "index": 17,
        "narration": "1945年她带着三个女儿去了美国，为了养家，她进入正在筹建的联合国工作。",
        "caption_segments": ["1945年她带着三个女儿", "去了美国", "为了养家", "她进入正在筹建的联合国工作"]
        "visual": "她带着三个女儿抵达美国，随后走进联合国筹建办公室"
      }
    ]
  }`), /JSON 格式错误/);


  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw);
      calls.push(body);
      const isRepairRequest = String(body.messages?.[0]?.content || "").includes("JSON 修复器");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: isRepairRequest ? '{"ok":true}' : "这不是 JSON，必须再次修复"
          }
        }]
      }));
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await testModelConnection({
      llm: {
        provider: "custom",
        protocol: "openai",
        api_key: "test-key",
        model: "test-model",
        base_url: `http://127.0.0.1:${port}/v1`,
        proxy_url: ""
      }
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2, "本地无法修复时应只追加一次模型 JSON 修复请求");
    assert.match(calls[1].messages[0].content, /JSON 修复器/);
    console.log("LLM JSON local repair and one-shot model repair test passed");
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
