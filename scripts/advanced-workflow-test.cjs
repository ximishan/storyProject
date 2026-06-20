const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { runPipeline, preparePipeline, completePipeline } = require("../electron/pipeline.cjs");
const { generateSceneImage, spawnAsync } = require("../electron/services.cjs");

const root = path.join(__dirname, "..");
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-advanced-"));
const ffmpeg = path.join(root, "resources", "bin", "ffmpeg.exe");
const app = { isPackaged: false };
const baseConfig = {
  llm: { provider: "local", protocol: "local" },
  image_provider: "placeholder",
  tts: { provider: "system", volcengine: {}, minimax: {} },
  media: { ffmpeg_path: ffmpeg, bgm_path: "", use_default_bgm: false },
  jianying: { draft_path: "" },
  task_storage_path: outputRoot
};

async function inspect(file) {
  const { stderr } = await spawnAsync(ffmpeg, ["-i", file, "-f", "null", "-"]);
  return {
    hasAudio: /Audio:/.test(stderr),
    hasVideo: /Video:/.test(stderr),
    resolution: stderr.match(/Video:.*?(\d{3,5})x(\d{3,5})/)?.slice(1).map(Number)
  };
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const reference = path.join(outputRoot, "reference.png");
  await generateSceneImage({
    app, config: baseConfig, prompt: "固定主角参考图", destination: reference, ratio: "9:16", index: 0
  });
  const task = {
    id: "advanced-flow",
    title: "高级流程测试",
    input_text: "我在橱窗里看到一盏灯，点击链接即可购买。后来我带着它走进雨夜。故事最终告诉我们，微光也能照亮回家的路。",
    track: "character-story",
    style: "cinematic",
    ratio: "9:16",
    target_scenes: 2,
    target_length: 90,
    rewrite_intensity: "deep",
    narrative_pov: "third",
    keep_promotion: 0,
    material_source: "ai",
    tts_speed: 1,
    reference_image_path: reference,
    cover_image_mode: "title",
    cover_template: { title_position: "center", title_color: "#FFE066", prompt: "电影海报" },
    draft_template: {
      canvas: { width: 1080, height: 1920, ratio: "9:16" },
      image: { ratio: "9:16", fit: "cover", top: 0, height: 1, animation: "缩放" },
      title: { visible: true, fontSize: 30, color: "#FFE066", y: .08 },
      caption: { visible: true, fontSize: 22, color: "#88FFCC", y: -.16, maxCharsPerLine: 12 },
      audio: { narrationVolume: 10, bgmVolume: 2 }
    }
  };
  const prepared = await preparePipeline({
    task, config: baseConfig, baseOutputDir: outputRoot, emit: () => {}
  });
  if (/点击|购买|橱窗/.test(prepared.script.narration)) throw new Error("推广内容未删除");
  const paused = await completePipeline({
    app, task: { ...task, pause_mode: "every", current_step: 3 },
    config: baseConfig, outputDir: prepared.outputDir, script: prepared.script, emit: () => {}
  });
  if (!paused.paused || paused.pauseStep !== 4 || !paused.script.scenes.every(scene => scene.image_path && !scene.audio_path)) {
    throw new Error("图片审核暂停点验证失败");
  }
  const audioPaused = await completePipeline({
    app, task: { ...task, pause_mode: "every", current_step: 4 },
    config: baseConfig, outputDir: prepared.outputDir, script: paused.script, emit: () => {}
  });
  if (!audioPaused.paused || audioPaused.pauseStep !== 5 || !audioPaused.script.scenes.every(scene => scene.audio_path)) {
    throw new Error("配音审核暂停点验证失败");
  }
  const resumed = await completePipeline({
    app, task: { ...task, pause_mode: "every", current_step: 5 },
    config: baseConfig, outputDir: prepared.outputDir, script: audioPaused.script, emit: () => {}
  });
  const result = await runPipeline({
    app, task, config: baseConfig, baseOutputDir: outputRoot, emit: () => {}
  });
  const info = await inspect(result.finalVideo);
  const checks = {
    referenceExists: fs.existsSync(reference),
    coverGenerated: fs.existsSync(result.coverPath),
    finalVideo: fs.existsSync(result.finalVideo),
    draft: fs.existsSync(path.join(result.draftDir, "draft_info.json")),
    hasAudio: info.hasAudio,
    hasVideo: info.hasVideo,
    resolution: JSON.stringify(info.resolution) === JSON.stringify([1080, 1920]),
    promotionRemoved: !/点击|购买|橱窗/.test(result.script.narration)
    ,imageReviewPause: paused.paused && audioPaused.paused && resumed.finalVideo && fs.existsSync(resumed.finalVideo)
  };
  if (Object.values(checks).some(value => !value)) throw new Error(JSON.stringify(checks, null, 2));
  console.log(JSON.stringify({ checks, cover: result.coverPath, video: result.finalVideo }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
