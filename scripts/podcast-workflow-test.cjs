const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runPipeline } = require("../electron/pipeline.cjs");
const { spawnAsync } = require("../electron/services.cjs");

const root = path.join(__dirname, "..");
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-podcast-"));
const ffmpeg = path.join(root, "resources", "bin", "ffmpeg.exe");
const config = {
  llm: { provider: "local", protocol: "local" },
  image_provider: "placeholder",
  tts: { provider: "system", volcengine: {}, minimax: {} },
  media: { ffmpeg_path: ffmpeg, bgm_path: "", use_default_bgm: false },
  jianying: { draft_path: "" },
  task_storage_path: outputRoot
};

async function main() {
  const task = {
    id: "podcast-flow",
    title: "双人播客测试",
    input_text: "为什么夜空是黑色的？因为遥远星光需要时间抵达。那我们看到的是过去吗？是的，每束光都带着它出发时的信息。",
    track: "culture-knowledge",
    style: "ancient-cinematic",
    ratio: "4:3",
    target_scenes: 4,
    rewrite_intensity: "standard",
    narrative_pov: "original",
    keep_promotion: 0,
    material_source: "ai",
    processing_mode: "semi",
    task_type: "podcast",
    script_format: "dialogue",
    podcast_image_mode: "single",
    podcast_speakers: "mizai-dayi",
    tts_speed: 1,
    pause_mode: "none",
    draft_template: {
      canvas: { width: 1080, height: 1920, ratio: "9:16", backgroundColor: "#12121A", backgroundImage: "" },
      image: { ratio: "4:3", fit: "cover", top: .289, height: .422, animation: "缩放", motionStrength: 1 },
      title: { visible: true, fontSize: 20, color: "#FFDE00", y: .83 },
      subtitle: { visible: true, fontSize: 12, color: "#FFFFFF", y: .59 },
      caption: { visible: true, fontSize: 12, color: "#FFDE00", y: -.55, maxCharsPerLine: 12, background: { color: "#000000", alpha: .5 }, border: { width: 0, alpha: 0 } },
      disclaimer: { visible: true, text: "播客测试", fontSize: 8, color: "#FFFFFF", y: -.81 },
      audio: { narrationVolume: 1, bgmVolume: .2, bgmFadeOutMs: 2000 }
    }
  };
  const result = await runPipeline({ app: { isPackaged: false }, task, config, baseOutputDir: outputRoot, emit: () => {} });
  const scenes = result.script.scenes;
  const uniqueImages = new Set(scenes.map(scene => scene.image_path));
  const speakerNames = scenes.map(scene => scene.speaker_name);
  const { stderr } = await spawnAsync(ffmpeg, ["-i", result.finalVideo, "-f", "null", "-"]);
  const resolution = stderr.match(/Video:.*?(\d{3,5})x(\d{3,5})/)?.slice(1).map(Number);
  const checks = {
    alternatingSpeakers: speakerNames.every((name, index) => name === (index % 2 ? "大壹" : "咪仔")),
    speakerIdsStored: scenes.every(scene => scene.speaker_id?.endsWith("_bigtts")),
    singleImageReused: uniqueImages.size === 1,
    separateAudioSegments: new Set(scenes.map(scene => scene.audio_path)).size === scenes.length,
    portraitCanvasWithFourThreeImage: JSON.stringify(resolution) === JSON.stringify([1080, 1920]),
    finalVideo: fs.existsSync(result.finalVideo),
    draft: fs.existsSync(path.join(result.draftDir, "draft_info.json"))
  };
  if (Object.values(checks).some(value => !value)) throw new Error(JSON.stringify({ checks, speakerNames, resolution }, null, 2));
  console.log(JSON.stringify({ checks, video: result.finalVideo }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
