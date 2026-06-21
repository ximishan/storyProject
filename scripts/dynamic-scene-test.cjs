const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  generateRunningHubVideo,
  spawnAsync,
  ffmpegPath
} = require("../electron/services.cjs");
const { renderVideo } = require("../electron/media.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-dynamic-"));
  const app = { isPackaged: false };
  const config = {
    runninghub: { api_key: "test-key", base_url: "https://www.runninghub.cn", proxy_url: "" },
    media: { ffmpeg_path: "" }
  };
  const ffmpeg = ffmpegPath(app, config);
  const imagePath = path.join(root, "source.png");
  const mockVideoPath = path.join(root, "mock-source.mp4");
  const generatedVideoPath = path.join(root, "generated.mp4");
  const audioPath = path.join(root, "voice.wav");

  await spawnAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=360x640", "-frames:v", "1", imagePath]);
  await spawnAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=2", "-pix_fmt", "yuv420p", mockVideoPath]);
  await spawnAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", audioPath]);

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push({
      url: requestUrl,
      body: typeof options.body === "string" ? JSON.parse(options.body) : null
    });
    if (requestUrl.endsWith("/media/upload/binary")) {
      return new Response(JSON.stringify({ code: 0, data: { download_url: "https://upload.test/source.png" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (requestUrl.endsWith("/image-to-video")) {
      return new Response(JSON.stringify({ taskId: "video-task-1", status: "RUNNING" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (requestUrl.endsWith("/openapi/v2/query")) {
      return new Response(JSON.stringify({
        status: "SUCCESS",
        results: [{ url: "https://download.test/generated.mp4", outputType: "mp4" }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (requestUrl === "https://download.test/generated.mp4") {
      return new Response(fs.readFileSync(mockVideoPath), { status: 200 });
    }
    throw new Error(`未预期的测试请求：${requestUrl}`);
  };

  try {
    const generated = await generateRunningHubVideo({
      config,
      imagePath,
      prompt: "主体自然运动，镜头稳定",
      ratio: "4:3",
      durationSec: 8,
      destination: generatedVideoPath
    });
    const output = await renderVideo({
      app,
      config,
      scenes: [{
        index: 1,
        narration: "动态分镜离线测试",
        image_path: imagePath,
        video_path: generatedVideoPath,
        audio_path: audioPath,
        duration: 4
      }],
      outputDir: root,
      ratio: "9:16",
      template: {
        canvas: { width: 360, height: 640, backgroundColor: "#000000" },
        image: { top: 0, height: 1, fit: "cover", animation: "缩放" },
        caption: { fontSize: 16 }
      }
    });
    const { stderr } = await spawnAsync(ffmpeg, ["-i", output.finalVideo, "-f", "null", "-"]);
    const duration = stderr.match(/Duration:\s*(\d+:\d+:[\d.]+)/)?.[1] || "";
    const submit = calls.find(call => call.url.endsWith("/image-to-video"));
    const checks = {
      videoApiUsed: Boolean(submit),
      nearestRatioMapped: submit?.body?.aspectRatio === "3:2",
      generatedVideoDownloaded: fs.existsSync(generatedVideoPath) && fs.statSync(generatedVideoPath).size > 1000,
      renderedWithNarrationDuration: /^00:00:04\./.test(duration),
      finalVideoExists: fs.existsSync(output.finalVideo) && fs.statSync(output.finalVideo).size > 1000,
      providerRecorded: generated.provider === "runninghub-video-x"
    };
    if (Object.values(checks).some(value => !value)) {
      throw new Error(JSON.stringify({ checks, duration, submit }, null, 2));
    }
    console.log(JSON.stringify({ checks, duration }, null, 2));
  } finally {
    global.fetch = originalFetch;
    if (!process.env.KEEP_SMOKE_OUTPUT) fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
