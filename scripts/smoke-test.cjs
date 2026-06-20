const fs = require("node:fs");
const path = require("node:path");
const { runPipeline } = require("../electron/pipeline.cjs");
const { spawnAsync } = require("../electron/services.cjs");

const root = path.join(__dirname, "..");
const outputRoot = path.join(root, ".smoke-output");
const ffmpeg = path.join(root, "resources", "bin", "ffmpeg.exe");

async function inspect(file) {
  const { stderr } = await spawnAsync(ffmpeg, ["-i", file, "-f", "null", "-"]);
  const resolution = stderr.match(/Video:.*?(\d{3,5})x(\d{3,5})/)?.slice(1).map(Number);
  return {
    duration: stderr.match(/Duration:\s*(\d+:\d+:[\d.]+)/)?.[1],
    resolution,
    hasAudio: /Audio:/.test(stderr),
    hasVideo: /Video:/.test(stderr)
  };
}

async function runCase(spec) {
  const task = {
    id: `smoke-${spec.name}`,
    title: `冒烟测试-${spec.name}`,
    input_text: spec.text,
    track: "character-story",
    style: "cinematic",
    ratio: spec.ratio,
    target_scenes: 2,
    tts_speed: 1
  };
  const config = {
    llm: { provider: "local", protocol: "local" },
    image_provider: "placeholder",
    tts: { provider: "system", volcengine: {}, minimax: {} },
    media: { ffmpeg_path: ffmpeg, bgm_path: "", use_default_bgm: spec.bgm },
    jianying: { draft_path: "" },
    task_storage_path: outputRoot
  };
  const result = await runPipeline({
    app: { isPackaged: false },
    task,
    config,
    baseOutputDir: outputRoot,
    emit: (step, message) => console.log(`[${spec.name}:${step}] ${message}`)
  });
  const info = await inspect(result.finalVideo);
  const expected = spec.ratio === "16:9" ? [1920, 1080] : [1080, 1920];
  const checks = {
    videoExists: fs.existsSync(result.finalVideo),
    subtitlesExist: fs.existsSync(result.subtitlePath),
    draftExists: fs.existsSync(path.join(result.draftDir, "draft_info.json")),
    hasAudio: info.hasAudio,
    hasVideo: info.hasVideo,
    resolution: JSON.stringify(info.resolution) === JSON.stringify(expected)
  };
  if (Object.values(checks).some(value => !value)) {
    throw new Error(`${spec.name} 验证失败: ${JSON.stringify({ checks, info })}`);
  }
  return { name: spec.name, info, checks, finalVideo: result.finalVideo };
}

async function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const results = [];
  results.push(await runCase({
    name: "portrait",
    ratio: "9:16",
    bgm: false,
    text: "清晨，女孩推开窗户。阳光落在旧书桌上，她决定从今天开始写下自己的故事。"
  }));
  results.push(await runCase({
    name: "landscape-bgm",
    ratio: "16:9",
    bgm: true,
    text: "列车穿过辽阔的原野。远处群山被夕阳染成金色，旅人终于看见了久违的故乡。"
  }));
  console.log(JSON.stringify(results, null, 2));
  if (!process.env.KEEP_SMOKE_OUTPUT) {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
