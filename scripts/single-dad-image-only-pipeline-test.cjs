const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { completePipeline } = require("../electron/pipeline.cjs");

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
    console.log("single-dad-image-only-pipeline-test: passed");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
