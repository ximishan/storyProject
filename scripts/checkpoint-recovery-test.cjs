const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { preparePipeline, completePipeline } = require("../electron/pipeline.cjs");

(async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-checkpoint-"));
  const root = path.join(__dirname, "..");
  const app = { isPackaged: false };
  const task = {
    id: "checkpoint-test",
    title: "断点恢复测试",
    input_text: "少年走出车站。雨后的老街亮起灯光。",
    track: "character-story",
    prompt_template_id: "character-story",
    style: "cinematic",
    ratio: "9:16",
    target_scenes: 2,
    processing_mode: "direct",
    material_source: "ai",
    pause_mode: "every",
    pause_points: "[]",
    current_step: 3,
    task_type: "story",
    tts_speed: 1
  };
  const config = {
    llm: { provider: "local", protocol: "local" },
    image_provider: "placeholder",
    placeholder: { concurrency: 1 },
    tts: { provider: "system", volcengine: {} },
    media: { ffmpeg_path: path.join(root, "resources", "bin", "ffmpeg.exe"), bgm_path: "", use_default_bgm: false },
    runninghub: { api_key: "" },
    jianying: { draft_path: "" },
    task_storage_path: outputRoot
  };
  const checkpoints = [];
  const checkpoint = value => checkpoints.push(value);
  try {
    const prepared = await preparePipeline({ task, config, baseOutputDir: outputRoot, emit: () => {}, checkpoint });
    const first = await completePipeline({ app, task, config, ...prepared, emit: () => {}, checkpoint });
    assert.equal(first.paused, true);
    assert.equal(first.pauseStep, 4);
    assert.equal(first.script.scenes.length, 2);
    const firstImage = first.script.scenes[0].image_path;
    const secondImage = first.script.scenes[1].image_path;
    const firstMtime = fs.statSync(firstImage).mtimeMs;
    const secondMtime = fs.statSync(secondImage).mtimeMs;

    await new Promise(resolve => setTimeout(resolve, 30));
    fs.rmSync(secondImage, { force: true });
    const pipelineFile = path.join(first.outputDir, "pipeline.json");
    const interrupted = JSON.parse(fs.readFileSync(pipelineFile, "utf8"));
    interrupted.runtime.current_stage = "images";
    interrupted.runtime.current_step = 4;
    interrupted.scenes[1].image_status = "running";
    fs.writeFileSync(pipelineFile, JSON.stringify(interrupted, null, 2), "utf8");

    const resumedTask = { ...task, current_step: 3 };
    const resumed = await completePipeline({
      app,
      task: resumedTask,
      config,
      outputDir: first.outputDir,
      script: interrupted,
      emit: () => {},
      checkpoint
    });
    assert.equal(resumed.paused, true);
    assert.equal(fs.statSync(firstImage).mtimeMs, firstMtime, "已完成图片必须原样复用");
    assert.ok(fs.statSync(secondImage).mtimeMs > secondMtime, "缺失图片必须重新生成");
    assert.equal(resumed.script.scenes[0].image_status, "completed");
    assert.equal(resumed.script.scenes[1].image_status, "completed");
    assert.ok(checkpoints.some(item => item.pipeline?.runtime?.current_stage === "review_images"));
    console.log("Per-scene checkpoint recovery test passed");
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
