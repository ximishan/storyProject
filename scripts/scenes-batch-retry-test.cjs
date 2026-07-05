const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { planVideoScript } = require("../electron/llm-planner.cjs");

function sendModelText(res, content) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}
function sendJson(res, value) { sendModelText(res, JSON.stringify(value)); }

(async () => {
  const parts = Array.from({ length: 10 }, (_, i) => `第${i + 1}句自然旁白。`);
  const narration = parts.join("");
  const visualRanges = [];
  let repairCalls = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw);
      const system = String(body.messages?.[0]?.content || "");
      const user = String(body.messages?.[1]?.content || "");
      if (system.includes("中文短视频文案编导")) return sendJson(res, { title: "重试测试", summary: "", narration });
      if (system.includes("短视频视觉策划")) return sendJson(res, {
        publish: { title: "重试测试", subtitle: [], summary: "", tags: [], comments: [] },
        character_card: { enabled: false, stable_prompt: "" }, product_card: { enabled: false, stable_prompt: "" },
        era_and_location: [], key_objects: [], facts: [], visual_continuity: []
      });
      if (system.includes("专业的短视频分镜导演")) return sendJson(res, { scenes: parts.map((narration, i) => ({ index: i + 1, narration })) });
      if (system.includes("JSON 修复器")) {
        repairCalls += 1;
        return sendModelText(res, "仍然不是JSON");
      }
      if (system.includes("专业短视频分镜师")) {
        const fixed = JSON.parse(user.match(/固定镜头清单：\n([\s\S]*?)\n\n强制规则：/)[1]);
        const range = [fixed[0].index, fixed[fixed.length - 1].index];
        visualRanges.push(range);
        if (range[0] === 1 && range[1] === 8) return sendModelText(res, "BROKEN_1_8");
        return sendJson(res, { scenes: fixed.map(item => ({
          index: item.index, narration: item.narration, visual: `画面${item.index}`,
          desc_prompt: `提示词${item.index}`, use_reference: false,
          reference_reason: "测试", subject_presence: "none", era_and_location: "", duration_hint: 5
        })) });
      }
      throw new Error("unexpected request");
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-scenes-retry-"));
  try {
    const result = await planVideoScript({
      config: { llm: { protocol: "openai", api_key: "x", model: "x", base_url: `http://127.0.0.1:${port}/v1` } },
      task: {
        id: "retry", input_text: narration, track: "character-story", prompt_template_id: "character-story",
        style: "realistic", ratio: "9:16", processing_mode: "auto", rewrite_intensity: "standard",
        narrative_pov: "original", keep_promotion: 1, target_scenes: 10, task_type: "story"
      },
      outputDir: workDir
    });
    assert.equal(result.scenes.length, 10);
    assert.ok(repairCalls >= 1, "损坏JSON应先执行一次原有模型修复");
    assert.deepEqual(visualRanges, [[1,8],[1,4],[5,8],[9,10]], "整批失败后应只把失败批次继续拆小重试");
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "03-scenes-001-008-split-retry.json")));
    console.log("scene batch malformed-JSON split retry test passed");
  } finally {
    server.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
