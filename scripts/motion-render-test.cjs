const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnAsync, ffmpegPath } = require("../electron/services.cjs");
const { renderVideo } = require("../electron/media.cjs");

const ANIMATIONS = [
  "无动画", "缩放", "缩放 II", "左拉镜", "右拉镜",
  "向左缩小", "向右缩小", "形变左缩", "形变右缩", "上下分割",
  "左右分割", "向左下降", "向右下降", "旋转缩小", "旋转上升",
  "翻转", "形变缩小", "回弹伸缩", "滑滑梯"
];

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-motion-"));
  const app = { isPackaged: false };
  const config = { media: { ffmpeg_path: process.env.FFMPEG_PATH || "" } };
  const ffmpeg = ffmpegPath(app, config);
  const imagePath = path.join(root, "source.png");
  const audioPath = path.join(root, "voice.wav");

  await spawnAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=s=240x426:r=1", "-frames:v", "1", imagePath]);
  await spawnAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.8", audioPath]);

  const results = [];
  for (let index = 0; index < ANIMATIONS.length; index += 1) {
    const animation = ANIMATIONS[index];
    const outputDir = path.join(root, String(index + 1).padStart(2, "0"));
    fs.mkdirSync(outputDir, { recursive: true });
    const output = await renderVideo({
      app,
      config,
      scenes: [{ index: 1, narration: "", image_path: imagePath, audio_path: audioPath, duration: .8 }],
      outputDir,
      ratio: "9:16",
      template: {
        canvas: { width: 240, height: 426, backgroundColor: "#000000" },
        image: { fit: "cover", top: 0, height: 1, animation, motionStrength: .5 },
        title: { visible: false }, subtitle: { visible: false }, caption: { visible: false }, disclaimer: { visible: false }
      },
      renderOptions: {
        animation, motionStrength: .5,
        burnTitle: false, burnSubtitle: false, burnCaption: false, burnDisclaimer: false
      }
    });
    const size = fs.statSync(output.finalVideo).size;
    if (size < 1024) throw new Error(`${animation} 输出文件异常`);
    results.push({ animation, size });
  }

  console.log(JSON.stringify({ passed: results.length, results, outputDir: root }, null, 2));
  if (!process.env.KEEP_SMOKE_OUTPUT) fs.rmSync(root, { recursive: true, force: true });
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
