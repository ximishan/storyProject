const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const electronDir = path.join(__dirname, "..", "electron");
const servicesPath = require.resolve(path.join(electronDir, "services.cjs"));
const mediaPath = require.resolve(path.join(electronDir, "media.cjs"));
const draftPath = require.resolve(path.join(electronDir, "draft.cjs"));
const coverPath = require.resolve(path.join(electronDir, "cover.cjs"));
const calls = [];

require.cache[servicesPath] = {
  id: servicesPath,
  filename: servicesPath,
  loaded: true,
  exports: {
    generateSceneImage: async args => {
      calls.push({ index: args.index, referenceImagePath: args.referenceImagePath });
      fs.writeFileSync(args.destination, `image-${args.index}`);
      return { provider: args.referenceImagePath ? "edit" : "generation" };
    },
    generateRunningHubVideo: async () => { throw new Error("should not run"); },
    synthesizeSpeech: async args => { fs.writeFileSync(args.destination, "audio"); },
    mediaDuration: async () => 3,
    resolveResource: () => ""
  }
};
require.cache[mediaPath] = {
  id: mediaPath,
  filename: mediaPath,
  loaded: true,
  exports: {
    renderVideo: async ({ outputDir }) => {
      const finalVideo = path.join(outputDir, "final.mp4");
      const subtitlePath = path.join(outputDir, "subtitles.srt");
      fs.writeFileSync(finalVideo, "video");
      fs.writeFileSync(subtitlePath, "subtitle");
      return { finalVideo, subtitlePath };
    }
  }
};
require.cache[draftPath] = {
  id: draftPath,
  filename: draftPath,
  loaded: true,
  exports: { generateJianyingDraft: async () => ({ draft_dir: "" }) }
};
require.cache[coverPath] = {
  id: coverPath,
  filename: coverPath,
  loaded: true,
  exports: { generateCover: async () => "" }
};

const { completePipeline } = require(path.join(electronDir, "pipeline.cjs"));

(async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-reference-route-"));
  const referencePath = path.join(outputDir, "reference.png");
  fs.writeFileSync(referencePath, "reference");
  try {
    await completePipeline({
      app: { isPackaged: false },
      config: {
        image_provider: "custom_image",
        custom_image: { concurrency: 2 },
        tts: { provider: "system" },
        media: { use_default_bgm: false }
      },
      outputDir,
      task: {
        id: "route-test",
        material_source: "ai",
        reference_image_path: referencePath,
        ratio: "9:16",
        tts_speed: 1,
        task_type: "story",
        video_intro: 0,
        bgm_id: "none",
        pause_mode: "none",
        pause_points: "[]",
        shouldCancel: () => false,
        draft_template: null,
        cover_template: null
      },
      script: {
        title: "测试",
        summary: "",
        narration: "人物镜头。环境空镜。",
        scenes: [
          { index: 1, narration: "人物镜头。", visual: "人物", image_prompt: "人物", use_reference: true, duration_hint: 3 },
          { index: 2, narration: "环境空镜。", visual: "环境", image_prompt: "环境", use_reference: false, duration_hint: 3 }
        ]
      },
      emit: () => {}
    });
    calls.sort((a, b) => a.index - b.index);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].referenceImagePath, referencePath, "人物镜头应携带参考图");
    assert.equal(calls[1].referenceImagePath, "", "环境镜头不应携带参考图");
    console.log("Per-scene reference routing test passed");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
