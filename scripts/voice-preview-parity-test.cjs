const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const voiceSource = fs.readFileSync(path.join(root, "src", "volcVoices.ts"), "utf8");
const compiled = ts.transpileModule(voiceSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(`(function(module, exports){${compiled}\n})(module, module.exports)`, {
  module: moduleBox,
  console
});
const { VOLC_VOICES, VOLC_VOICE_CATEGORIES, DEFAULT_VOLC_VOICE_ID } = moduleBox.exports;

assert.equal(VOLC_VOICES.length, 185, "应完整保留原版 185 个火山音色");
assert.equal(VOLC_VOICE_CATEGORIES.length, 6, "应包含原版 6 个分类");
assert.equal(new Set(VOLC_VOICES.map(item => item.id)).size, VOLC_VOICES.length, "音色 ID 不应重复");
assert.ok(VOLC_VOICES.some(item => item.version === "1.0"));
assert.ok(VOLC_VOICES.some(item => item.version === "2.0"));
assert.ok(VOLC_VOICES.some(item => item.id === DEFAULT_VOLC_VOICE_ID));

const appText = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const mainText = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
const preloadText = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
const servicesText = fs.readFileSync(path.join(root, "electron", "services.cjs"), "utf8");
const cssText = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

for (const expected of [
  "function VolcVoicePicker",
  "我的收藏",
  "他来到江南一个小村庄",
  "首次试听调用接口，之后读取本地缓存",
  "打开音色库并试听"
]) assert.ok(appText.includes(expected), `缺少界面功能：${expected}`);
assert.ok(mainText.includes('ipcMain.handle("voice:preview"'));
assert.ok(mainText.includes('voice-preview-cache'));
assert.ok(mainText.includes('crypto.createHash("sha256")'));
assert.ok(preloadText.includes("previewVolcVoice"));
assert.ok(servicesText.includes("requestVolcengineSpeech"));
assert.ok(cssText.includes(".voice-picker-modal"));
assert.ok(cssText.includes(".voice-picker-list"));

console.log(`voice-preview-parity-test: ${VOLC_VOICES.length} voices, ${VOLC_VOICE_CATEGORIES.length} categories passed`);

async function testTtsRequest() {
  const { requestVolcengineSpeech } = require(path.join(root, "electron", "services.cjs"));
  const previousFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: async () => JSON.stringify({ code: 20000000, data: Buffer.from("preview-audio").toString("base64") })
    };
  };
  try {
    const audio = await requestVolcengineSpeech({
      tts: { volcengine: { app_id: "app", access_key: "token", base_url: "https://example.test/tts", speaker: "" } }
    }, "他来到江南一个小村庄", 1.1, DEFAULT_VOLC_VOICE_ID);
    assert.equal(audio.toString(), "preview-audio");
    assert.equal(captured.options.headers["X-Api-Resource-Id"], "seed-tts-2.0");
    assert.equal(JSON.parse(captured.options.body).req_params.speaker, DEFAULT_VOLC_VOICE_ID);
  } finally {
    global.fetch = previousFetch;
  }
}

testTtsRequest().then(() => console.log("voice-preview request routing passed")).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
