const fs = require("node:fs");
const path = require("node:path");
const { spawnAsync, generateSceneImage, synthesizeSpeech } = require("../electron/services.cjs");
const { renderMusicVideo } = require("../electron/media.cjs");
const { generateMusicDraft } = require("../electron/draft.cjs");

const root = path.join(__dirname, "..");
const output = path.join(root, ".feature-smoke");
const ffmpeg = path.join(root, "resources", "bin", "ffmpeg.exe");
const app = { isPackaged: false };
const config = {
  image_provider: "placeholder",
  tts: { provider: "system", volcengine: {}, minimax: {} },
  media: { ffmpeg_path: ffmpeg, bgm_path: "", use_default_bgm: false },
  jianying: { draft_path: "" }
};

async function main() {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const audioPath = path.join(output, "music.wav");
  await spawnAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", audioPath]);
  const images = [];
  for (let index = 1; index <= 3; index += 1) {
    const destination = path.join(output, `${index}.png`);
    await generateSceneImage({ app, config, prompt: `音乐场景 ${index}`, destination, ratio: "9:16", index });
    images.push(destination);
  }
  const voicePath = path.join(output, "voice.wav");
  await synthesizeSpeech({ app, config, text: "这是配音实验室功能测试。", destination: voicePath, speed: 1 });
  const video = await renderMusicVideo({
    app, config, audioPath, images, lyrics: "第一句歌词\n第二句歌词\n第三句歌词",
    outputDir: output, ratio: "9:16"
  });
  const draft = await generateMusicDraft({
    app, config, title: "音乐MV冒烟测试", outputDir: output,
    audioPath, audioDuration: video.totalDuration, images,
    lyrics: "第一句歌词\n第二句歌词\n第三句歌词", ratio: "9:16"
  });
  const result = {
    voice: fs.existsSync(voicePath) && fs.statSync(voicePath).size > 1000,
    video: fs.existsSync(video.finalVideo) && fs.statSync(video.finalVideo).size > 1000,
    lyrics: fs.existsSync(video.subtitlePath),
    draft: fs.existsSync(path.join(draft.draft_dir, "draft_info.json"))
  };
  console.log(JSON.stringify({ result, video, draft }, null, 2));
  if (Object.values(result).some(value => !value)) process.exitCode = 1;
  if (!process.env.KEEP_SMOKE_OUTPUT) fs.rmSync(output, { recursive: true, force: true });
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
