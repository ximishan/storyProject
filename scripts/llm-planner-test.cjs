const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { planVideoScript, normalizeCaptionSegments, mergeAdjacentSimilarVisualScenes, stripPromotionalContent } = require("../electron/llm-planner.cjs");

(async () => {
  assert.equal(
    stripPromotionalContent("我在橱窗里看到一盏灯，点击链接即可购买。后来我带着它走进雨夜。"),
    "后来我带着它走进雨夜。",
    "应删除带购买号召的推广句"
  );
  assert.equal(
    stripPromotionalContent("他攒了三个月工资，终于购买了回家的车票。"),
    "他攒了三个月工资，终于购买了回家的车票。",
    "普通叙事中的购买行为不能被误删"
  );
  assert.deepEqual(
    normalizeCaptionSegments("值得吗？后悔吗？", ["值得吗？后悔吗？"]),
    ["值得吗？", "后悔吗？"],
    "同一模型分段中的连续问句必须按问号强制拆开"
  );
  const ironLungMerge = mergeAdjacentSimilarVisualScenes([
    {
      index: 5,
      narration: "孩子前一天还在院子里奔跑，几天后双腿就可能再也站不起来。",
      visual: "病房中排列的铁肺机器，孩子头部露出圆筒，护士在旁守护",
      desc_prompt: "1950年代美国医院病房，数台银灰色铁肺设备整齐排列，白衣护士在设备间查看仪表，远处父母坐在长椅上安静守候",
      era_and_location: "1950年代美国医院病房",
      subject_presence: "none",
      duration_hint: 6
    },
    {
      index: 6,
      narration: "病情严重的，甚至会失去自主呼吸，只能被放进一种巨大的金属圆筒里。",
      visual: "病房中一排铁肺机器，孩子头部露出，父母坐在旁边默默守候",
      desc_prompt: "1950年代美国医院病房，铁肺机器一排排延伸，孩子只露出头部，父母坐在病床旁边守候",
      era_and_location: "1950年代美国医院病房",
      subject_presence: "none",
      duration_hint: 7
    },
    {
      index: 7,
      narration: "与此同时，研究人员开始寻找疫苗。",
      visual: "实验室中研究人员查看疫苗样本",
      desc_prompt: "1950年代实验室，研究人员在显微镜旁查看样本，桌面有玻璃器皿",
      era_and_location: "1950年代美国实验室",
      subject_presence: "none",
      duration_hint: 5
    }
  ]);
  assert.equal(ironLungMerge.scenes.length, 2, "相邻铁肺病房重复画面应合并为一个镜头");
  assert.equal(ironLungMerge.merges.length, 1);
  assert.equal(ironLungMerge.merges[0].kept_index, 5);
  assert.equal(ironLungMerge.merges[0].merged_index, 6);
  assert.match(ironLungMerge.scenes[0].narration, /孩子前一天/);
  assert.match(ironLungMerge.scenes[0].narration, /病情严重/);
  assert.match(ironLungMerge.scenes[0].desc_prompt, /护士/);
  assert.match(ironLungMerge.scenes[0].desc_prompt, /父母/);
  assert.equal(ironLungMerge.scenes[1].index, 2);

  const differentSceneMerge = mergeAdjacentSimilarVisualScenes([
    {
      index: 1,
      narration: "研究人员进入实验室。",
      visual: "实验室中研究人员查看样本",
      desc_prompt: "1950年代实验室，研究人员查看玻璃样本",
      era_and_location: "1950年代实验室"
    },
    {
      index: 2,
      narration: "孩子们在学校排队接种。",
      visual: "学校礼堂中孩子排队接种疫苗",
      desc_prompt: "1950年代学校礼堂，孩子们排成长队等待接种疫苗",
      era_and_location: "1950年代学校礼堂"
    }
  ]);
  assert.equal(differentSceneMerge.scenes.length, 2, "地点和主体不同的相邻镜头不能合并");

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
      groups: [
        { unit_ids: [1, 2] },
        { unit_ids: [3] }
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
    assert.ok(fs.existsSync(path.join(workDir, "llm-debug", "03-scenes-plan-semi-parsed.json")));
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
