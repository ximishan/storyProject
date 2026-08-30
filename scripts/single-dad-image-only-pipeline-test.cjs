const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { completePipeline, _pipelineTest } = require("../electron/pipeline.cjs");

(async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-single-dad-image-only-"));
  try {
    const imagesDir = path.join(outputDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    const scenes = [1, 2].map(index => {
      const imagePath = path.join(imagesDir, `${index}.png`);
      fs.writeFileSync(imagePath, Buffer.alloc(1024, index));
      return {
        index,
        narration: `测试旁白${index}`,
        image_prompt: `父女日常测试画面${index}`,
        image_path: imagePath,
        image_status: "completed",
        audio_status: "pending",
        video_status: "pending"
      };
    });

    const events = [];
    const result = await completePipeline({
      app: {},
      config: {},
      outputDir,
      task: {
        id: "single-dad-image-only-test",
        prompt_template_id: "single-dad-story",
        current_step: 4
      },
      script: {
        title: "测试父女图文",
        scenes,
        runtime: { current_stage: "review_images", current_step: 4 }
      },
      emit: (step, message) => events.push({ step, message }),
      checkpoint: () => {}
    });

    assert.equal(result.finalVideo, "");
    assert.equal(result.subtitlePath, "");
    assert.equal(result.draftDir, "");
    assert.equal(result.coverPath, "");
    assert.equal(result.script.runtime.output_mode, "image_story");
    assert.equal(result.script.runtime.current_stage, "completed");
    assert.equal(result.script.runtime.render_status, "skipped");
    assert.equal(result.script.runtime.draft_status, "skipped");
    assert.equal(result.script.runtime.cover_status, "skipped");
    assert.ok(result.script.scenes.every(scene => scene.audio_status === "skipped"));
    assert.ok(result.script.scenes.every(scene => scene.video_status === "skipped"));
    assert.equal(fs.existsSync(path.join(outputDir, "audio")), false, "图文模式不应创建 audio 目录");
    assert.equal(fs.existsSync(path.join(outputDir, "final.mp4")), false, "图文模式不应生成 final.mp4");
    assert.equal(fs.existsSync(path.join(outputDir, "subtitles.srt")), false, "图文模式不应生成字幕");
    assert.ok(events.some(event => event.step === 8 && /图文/.test(event.message)));

    const saved = JSON.parse(fs.readFileSync(path.join(outputDir, "pipeline.json"), "utf8"));
    assert.equal(saved.runtime.output_mode, "image_story");

    // “补齐缺失画面”必须彻底放弃旧 task_id，并删除旧 submit/poll 日志。
    const repairDir = path.join(outputDir, "repair-case");
    const repairImagesDir = path.join(repairDir, "images");
    const repairDebugDir = path.join(repairDir, "image-debug");
    fs.mkdirSync(repairImagesDir, { recursive: true });
    fs.mkdirSync(repairDebugDir, { recursive: true });
    const readyImage = path.join(repairImagesDir, "2.png");
    fs.writeFileSync(readyImage, Buffer.alloc(1024, 2));
    for (const suffix of ["submit", "poll", "response", "download", "content-policy", "style-audit"]) {
      fs.writeFileSync(path.join(repairDebugDir, `1-${suffix}.json`), "old", "utf8");
    }

    const repairScript = {
      title: "补图测试",
      scenes: [
        {
          index: 1,
          narration: "爸爸拿着梳子",
          image_prompt: "爸爸拿着梳子",
          image_path: "",
          image_status: "failed",
          image_error: "旧错误",
          image_attempts: 4,
          image_remote_task_id: "task-old-should-not-resume",
          image_remote_provider: "Apimart",
          image_provider: "Apimart",
          source_url: "https://old.example/image.png"
        },
        {
          index: 2,
          narration: "女儿看着镜子",
          image_prompt: "女儿看着镜子",
          image_path: readyImage,
          image_status: "completed",
          image_remote_task_id: "task-completed-kept"
        }
      ],
      runtime: { current_stage: "review_images_partial", current_step: 4 }
    };

    assert.equal(_pipelineTest.isSingleDadRepair({
      task: { prompt_template_id: "single-dad-story", current_step: 3 },
      script: repairScript
    }), true);
    const cleared = _pipelineTest.prepareFreshMissingImages(repairScript, repairDir);
    assert.equal(cleared, 1);
    assert.equal(repairScript.scenes[0].image_status, "pending");
    assert.equal(repairScript.scenes[0].image_attempts, 0);
    assert.equal(repairScript.scenes[0].image_error, "");
    assert.equal(repairScript.scenes[0].image_remote_task_id, "");
    assert.equal(repairScript.scenes[0].image_remote_provider, "");
    assert.equal(repairScript.scenes[0].image_provider, "");
    assert.equal(repairScript.scenes[0].source_url, "");
    assert.equal(repairScript.scenes[1].image_remote_task_id, "task-completed-kept", "已完成图片不能被补图流程清掉");
    for (const suffix of ["submit", "poll", "response", "download", "content-policy", "style-audit"]) {
      assert.equal(fs.existsSync(path.join(repairDebugDir, `1-${suffix}.json`)), false, `旧 ${suffix} 日志应被删除`);
    }
    const repairSaved = JSON.parse(fs.readFileSync(path.join(repairDir, "pipeline.json"), "utf8"));
    assert.equal(repairSaved.runtime.current_stage, "repair_images_ready");
    assert.equal(repairSaved.scenes[0].image_remote_task_id, "");

    console.log("single-dad-image-only-pipeline-test: passed");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
