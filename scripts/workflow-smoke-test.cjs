const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  preparePipeline,
  completePipeline,
  regenerateScene,
  renderPrepared
} = require("../electron/pipeline.cjs");
const { spawnAsync } = require("../electron/services.cjs");

const root = path.join(__dirname, "..");
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-workflow-"));
const ffmpeg = path.join(root, "resources", "bin", "ffmpeg.exe");
const app = { isPackaged: false };
const task = {
  id: "workflow-smoke",
  title: "阶段流程冒烟测试",
  input_text: "雨停以后，少年走出车站。远方的灯光亮起，他终于找到了回家的路。",
  track: "character-story",
  style: "cinematic",
  ratio: "9:16",
  target_scenes: 2,
  tts_speed: 1
};
const config = {
  llm: { provider: "local", protocol: "local" },
  image_provider: "placeholder",
  tts: { provider: "system", volcengine: {}, minimax: {} },
  media: { ffmpeg_path: ffmpeg, bgm_path: "", use_default_bgm: false },
  jianying: { draft_path: "" },
  task_storage_path: outputRoot
};
const emit = (step, message) => console.log(`[workflow:${step}] ${message}`);

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

  const prepared = await preparePipeline({ task, config, baseOutputDir: outputRoot, emit });
  prepared.script.scenes[0].narration = "雨停以后，少年推开车站大门。";
  prepared.script.scenes[0].image_prompt = "雨后车站，少年推门而出，电影感光影";

  let completed = await completePipeline({ app, task, config, ...prepared, emit });
  const firstImageMtime = fs.statSync(completed.script.scenes[0].image_path).mtimeMs;
  const firstAudioMtime = fs.statSync(completed.script.scenes[0].audio_path).mtimeMs;
  const secondImageMtime = fs.statSync(completed.script.scenes[1].image_path).mtimeMs;
  fs.unlinkSync(completed.script.scenes[1].audio_path);
  completed = await completePipeline({
    app, task, config, outputDir: completed.outputDir, script: completed.script, emit
  });
  const resumeChecks = {
    firstImageReused: fs.statSync(completed.script.scenes[0].image_path).mtimeMs === firstImageMtime,
    firstAudioReused: fs.statSync(completed.script.scenes[0].audio_path).mtimeMs === firstAudioMtime,
    secondImageReused: fs.statSync(completed.script.scenes[1].image_path).mtimeMs === secondImageMtime,
    missingAudioRecovered: fs.existsSync(completed.script.scenes[1].audio_path)
  };

  await new Promise(resolve => setTimeout(resolve, 25));
  await regenerateScene({
    app, task, config, outputDir: completed.outputDir, script: completed.script,
    sceneIndex: 1, kind: "image", emit
  });
  await new Promise(resolve => setTimeout(resolve, 25));
  await regenerateScene({
    app, task, config, outputDir: completed.outputDir, script: completed.script,
    sceneIndex: 1, kind: "audio", emit
  });

  const rerendered = await renderPrepared({
    app, task, config, outputDir: completed.outputDir, script: completed.script, emit
  });
  const info = await inspect(rerendered.finalVideo);
  const checks = {
    preparedScript: fs.existsSync(path.join(prepared.outputDir, "script.json")),
    editedNarrationKept: completed.script.scenes[0].narration.includes("推开车站大门"),
    ...resumeChecks,
    imageRegenerated: fs.statSync(completed.script.scenes[0].image_path).mtimeMs > firstImageMtime,
    audioRegenerated: fs.statSync(completed.script.scenes[0].audio_path).mtimeMs > firstAudioMtime,
    rerenderedVideo: fs.existsSync(rerendered.finalVideo),
    rerenderedDraft: fs.existsSync(path.join(rerendered.draftDir, "draft_info.json")),
    hasAudio: info.hasAudio,
    hasVideo: info.hasVideo,
    portraitResolution: JSON.stringify(info.resolution) === JSON.stringify([1080, 1920])
  };
  if (Object.values(checks).some(value => !value)) {
    throw new Error(`阶段流程验证失败: ${JSON.stringify({ checks, info }, null, 2)}`);
  }
  console.log(JSON.stringify({ checks, video: rerendered.finalVideo }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
