const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _voiceTest } = require("../electron/services.cjs");

const config = { tts: { system: { voice: "Microsoft Huihui Desktop" } } };
assert.equal(_voiceTest.resolveSystemVoiceName({ config }), "Microsoft Huihui Desktop", "未提供任务音色时应使用设置页默认音色");
assert.equal(_voiceTest.resolveSystemVoiceName({ config, speaker: "" }), "", "任务明确选择系统默认时不得回退到设置页音色");
assert.equal(_voiceTest.resolveSystemVoiceName({ config, speaker: "Microsoft Yaoyao Desktop" }), "Microsoft Yaoyao Desktop", "任务选择的系统音色应优先");
assert.equal(_voiceTest.resolveSystemVoiceName({ config, speaker: "zh_female_xiaohe_uranus_bigtts" }), "", "火山音色 ID 不得传给 Windows SAPI");

const app = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
const db = fs.readFileSync(path.join(__dirname, "../electron/database.cjs"), "utf8");
const pipeline = fs.readFileSync(path.join(__dirname, "../electron/pipeline.cjs"), "utf8");
assert.match(app, /storybound\.lastVoiceSelection\.v2/);
assert.match(app, /speaker, ttsProvider/);
assert.match(db, /target_scenes,tts_provider,tts_speed/);
assert.match(db, /speaker LIKE '%_bigtts%'/);
assert.match(pipeline, /taskVoiceProvider\(task, config\)/);
console.log("voice selection regression test passed");
