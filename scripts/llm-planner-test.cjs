const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { planVideoScript, normalizeCaptionSegments } = require("../electron/llm-planner.cjs");

(async () => {
  assert.deepEqual(
    normalizeCaptionSegments("值得吗？后悔吗？", ["值得吗？后悔吗？"]),
    ["值得吗？", "后悔吗？"],
    "同一模型分段中的连续问句必须按问号强制拆开"
  );
  const calls = [];
  const replies = [
    {
      title: "雨夜归来",
      summary: "青年在雨夜回到故乡。",
      narration: "1938年，他离开车站。雨中的老街空无一人。"
    },
    {
      publish: {
        title: "雨夜归乡",
        subtitle: ["他离开多年", "终于回到故乡"],
        summary: "1938年的雨夜，一名青年提着旧皮箱回到空寂老街。",
        tags: ["#人物故事", "#雨夜归乡"],
        comments: ["那个年代的归乡太有画面了。", "旧皮箱这个细节很戳人。"]
      },
      character_card: {
        enabled: true,
        name: "林安",
        identity: "青年作家",
        gender: "男",
        age_stages: ["20岁左右"],
        face: "清瘦长脸",
        hair: "短黑发",
        clothing: "深色长衫",
        stable_prompt: "20岁左右中国青年作家，清瘦长脸，短黑发，深色长衫"
      },
      product_card: { enabled: false, stable_prompt: "" },
      era_and_location: [{ segment: "全篇", era: "1938年", location: "中国南方老城", prompt: "1938年中国南方老城" }],
      key_objects: ["旧皮箱"],
      facts: ["1938年离开车站"],
      visual_continuity: ["长衫和旧皮箱保持一致"]
    },
    {
      scenes: [
        { index: 1, narration: "1938年，他离开车站。" },
        { index: 2, narration: "雨中的老街空无一人。" }
      ]
    },
    {
      scenes: [
        {
          index: 1,
          narration: "1938年，他离开车站。",
          visual: "青年提着皮箱走出车站",
          desc_prompt: "青年提着旧皮箱走出木质车站，中景",
          use_reference: true,
          reference_reason: "主角清晰出现",
          subject_presence: "character",
          era_and_location: "1938年中国南方老城",
          duration_hint: 5
        },
        {
          index: 2,
          narration: "雨中的老街空无一人。",
          visual: "雨夜老街空镜",
          desc_prompt: "空无一人的石板老街，雨水反光，远景",
          use_reference: false,
          reference_reason: "环境空镜",
          subject_presence: "none",
          era_and_location: "1938年中国南方老城",
          duration_hint: 5
        }
      ]
    }
  ];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      calls.push({ url: req.url, body: JSON.parse(body) });
      const content = JSON.stringify(replies[calls.length - 1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-planner-"));
  const referencePath = path.join(workDir, "reference.png");
  fs.writeFileSync(referencePath, "test");

  try {
    const result = await planVideoScript({
      config: { llm: { protocol: "openai", api_key: "test-key", model: "test-model", base_url: `http://127.0.0.1:${port}/v1`, proxy_url: "" } },
      task: {
        id: "test-task",
        title: "",
        input_text: "1938年，他离开车站。雨中的老街空无一人。",
        track: "character-story",
        prompt_template_id: "character-story",
        style: "black-white",
        ratio: "9:16",
        processing_mode: "auto",
        rewrite_intensity: "standard",
        narrative_pov: "original",
        keep_promotion: 0,
        target_scenes: 2,
        task_type: "story",
        reference_image_path: referencePath
      },
      outputDir: workDir
    });

    assert.equal(calls.length, 4, "应依次执行文案、元数据、旁白切分、分镜画面四次请求");
    assert.equal(calls[0].url, "/v1/chat/completions");
    assert.equal(result.metadata.planner_mode, "staged-llm");
    assert.equal(result.title, "雨夜归乡");
    assert.equal(result.subtitle.length, 2);
    assert.equal(result.tags[0], "#人物故事");
    assert.equal(result.scenes.length, 2);
    assert.deepEqual(result.scenes[0].caption_segments, []);
    assert.equal(result.scenes[0].use_reference, true);
    assert.equal(result.scenes[1].use_reference, false);
    assert.match(result.scenes[0].image_prompt, /清瘦长脸/);
    assert.match(result.scenes[0].image_prompt, /无文字/);
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "01-rewrite-request.json")));
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "02-metadata-parsed.json")));
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "03-scenes-plan-parsed.json")));
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "03-scenes-001-002-parsed.json")));

    const resumed = await planVideoScript({
      config: { llm: { protocol: "openai", api_key: "test-key", model: "test-model", base_url: `http://127.0.0.1:${port}/v1`, proxy_url: "" } },
      task: {
        id: "test-task",
        title: "",
        input_text: "1938年，他离开车站。雨中的老街空无一人。",
        track: "character-story",
        prompt_template_id: "character-story",
        style: "black-white",
        ratio: "9:16",
        processing_mode: "auto",
        rewrite_intensity: "standard",
        narrative_pov: "original",
        keep_promotion: 0,
        target_scenes: 2,
        task_type: "story",
        reference_image_path: referencePath
      },
      outputDir: workDir
    });
    assert.equal(calls.length, 4, "恢复执行时应复用文案、元数据、旁白切分和分镜批次检查点，不重复调用模型");
    assert.deepEqual(resumed.scenes.map(item => item.image_prompt), result.scenes.map(item => item.image_prompt));
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "01-rewrite-reused.json")));
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "03-scenes-reused.json")));

    console.log("LLM staged planner and checkpoint reuse test passed");
  } finally {
    server.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
