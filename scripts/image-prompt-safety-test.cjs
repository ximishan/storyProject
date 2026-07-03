const assert = require("node:assert");
const { analyzeImagePromptRisk, buildPolicySafeImagePrompt } = require("../electron/image-prompt-safety.cjs");

const risky = "1939年10月，中国华北前线，黑白纪实摄影，1939年10月华北前线简陋手术室内，极近景特写，白求恩的双手正在为一名伤员的伤口进行缝合操作，左手食指上一道新鲜割口清晰可见，暗红色血液沿指缝渗出滴落，手边散放着金属手术钳、缝合针和染血纱布，煤油灯从侧面投射出强烈明暗对比，手部皮肤纹理和血液细节清晰，微距特写镜头，浅景深，真实颗粒质感，9:16竖构图";
const analysis = analyzeImagePromptRisk(risky);
assert.strictEqual(analysis.risky, true);
assert.ok(analysis.score >= 8);

for (const level of ["preflight", "minimal", "ultra"]) {
  const result = buildPolicySafeImagePrompt(risky, level);
  assert.strictEqual(result.adjusted, true);
  assert.strictEqual(analyzeImagePromptRisk(result.prompt).risky, false, `${level} 仍包含高风险细节`);
  assert.doesNotMatch(result.prompt, /鲜血|血液|染血|伤口|割口|缝合|极近景|微距特写|白求恩/);
  assert.match(result.prompt, /包扎|医疗站|医疗器械/);
}

const normal = "1938年中国南方老城，青年提着旧皮箱走出木质车站，中景，黑白纪实摄影，9:16竖构图";
const normalResult = buildPolicySafeImagePrompt(normal, "preflight");
assert.strictEqual(normalResult.adjusted, false);
assert.strictEqual(normalResult.prompt, normal);

const ironLung = "1950年代美国医院病房，一排巨大金属圆筒铁肺机器整齐排列，每台机器外露出一个孩子的头部，孩子眼睛望向上方的天花板，旁边坐着衣着朴素的父母，9:16构图";
const ironLungAnalysis = analyzeImagePromptRisk(ironLung);
assert.strictEqual(ironLungAnalysis.risky, true);
assert.equal(ironLungAnalysis.category, "minor-medical-restraint");
assert.ok(ironLungAnalysis.reasons.includes("minor-medical-restraint"));
const ironLungSafe = buildPolicySafeImagePrompt(ironLung, "preflight");
assert.strictEqual(ironLungSafe.adjusted, true);
assert.equal(ironLungSafe.category, "minor-medical-restraint");
assert.doesNotMatch(ironLungSafe.prompt, /孩子[^，。；]{0,30}(?:只露出|外露|露出)[^，。；]{0,12}(?:头部|脑袋|头)/);
assert.match(ironLungSafe.prompt, /铁肺设备/);

console.log("Image prompt proactive safety rewrite test passed");
