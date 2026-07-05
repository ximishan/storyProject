const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { planVideoScript } = require("../electron/llm-planner.cjs");

function jsonReply(res, value) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
}

(async () => {
  const narrationParts = Array.from({ length: 20 }, (_, index) => `这是第${index + 1}个自然语义完整句子。`);
  const narration = narrationParts.join("");
  const calls = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw);
      const system = String(body.messages?.[0]?.content || "");
      const user = String(body.messages?.[1]?.content || "");
      calls.push({ system, user });

      if (system.includes("中文短视频文案编导")) {
        return jsonReply(res, { title: "批量分镜测试", summary: "测试摘要", narration });
      }
      if (system.includes("短视频视觉策划")) {
        return jsonReply(res, {
          publish: { title: "批量分镜测试", subtitle: [], summary: "测试摘要", tags: [], comments: [] },
          character_card: { enabled: false, stable_prompt: "" },
          product_card: { enabled: false, stable_prompt: "" },
          era_and_location: [], key_objects: [], facts: [], visual_continuity: []
        });
      }
      if (system.includes("专业的短视频分镜导演")) {
        return jsonReply(res, {
          scenes: narrationParts.map((item, index) => ({ index: index + 1, narration: item }))
        });
      }
      if (system.includes("专业短视频分镜师")) {
        const match = user.match(/固定镜头清单：\n([\s\S]*?)\n\n强制规则：/);
        assert.ok(match, "分镜批次请求必须包含固定镜头清单");
        const fixed = JSON.parse(match[1]);
        assert.ok(fixed.length <= 8, "每个模型分镜请求最多处理8个镜头");
        return jsonReply(res, {
          scenes: fixed.map(item => ({
            index: item.index,
            narration: item.narration,
            visual: `画面${item.index}`,
            desc_prompt: `第${item.index}镜的画面提示词`,
            use_reference: false,
            reference_reason: "测试环境空镜",
            subject_presence: "none",
            era_and_location: "",
            duration_hint: 5
          }))
        });
      }
      throw new Error("Unexpected request");
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-scenes-batch-"));
  try {
    const task = {
      id: "batch-test",
      title: "",
      input_text: narration,
      track: "character-story",
      prompt_template_id: "character-story",
      style: "realistic",
      ratio: "9:16",
      processing_mode: "auto",
      rewrite_intensity: "standard",
      narrative_pov: "original",
      keep_promotion: 1,
      target_scenes: 20,
      task_type: "story",
      reference_image_path: ""
    };
    const result = await planVideoScript({
      config: { llm: { protocol: "openai", api_key: "test", model: "test", base_url: `http://127.0.0.1:${port}/v1`, proxy_url: "" } },
      task,
      outputDir: workDir
    });

    assert.equal(result.scenes.length, 20);
    assert.equal(result.scenes.map(item => item.narration).join(""), narration);
    const sceneRequests = calls.filter(call => call.system.includes("专业短视频分镜师"));
    assert.equal(sceneRequests.length, 3, "20个镜头应拆成3个批次请求");
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "03-scenes-001-008-checkpoint.json")));
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "03-scenes-017-020-checkpoint.json")));

    const callsBeforeResume = calls.length;
    const resumed = await planVideoScript({
      config: { llm: { protocol: "openai", api_key: "test", model: "test", base_url: `http://127.0.0.1:${port}/v1`, proxy_url: "" } },
      task,
      outputDir: workDir
    });
    assert.equal(calls.length, callsBeforeResume, "重新运行应复用所有批次检查点");
    assert.equal(resumed.scenes.length, 20);
    console.log("20-scene batched generation and checkpoint reuse test passed");
  } finally {
    server.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
