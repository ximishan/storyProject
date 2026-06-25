const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  BUILTIN_VISUAL_STYLES,
  STYLE_REGISTRY_VERSION,
  canonicalStyleId,
  resolveVisualStyle,
  stripKnownStyleLayer,
  buildStyledPrompt
} = require("../electron/visual-styles.cjs");
const {
  buildImageRequestCandidate,
  buildImageRequestCandidates
} = require("../electron/image-prompt-builder.cjs");

assert.equal(BUILTIN_VISUAL_STYLES.length, 12, "原版风格必须完整保留 12 种");
const canonicalRegistryHash = crypto.createHash("sha256")
  .update(JSON.stringify(BUILTIN_VISUAL_STYLES.map(style => Object.fromEntries(Object.entries(style).sort(([a], [b]) => a.localeCompare(b))))))
  .digest("hex");
// Fixed hash of the normalized 12-style registry extracted from Storybound 1.7.0.
assert.equal(canonicalRegistryHash, "6ec1c2033f77599b00214a3f6cf6bf65ccab6b841772bba325012e0e37149e2b");
for (const style of BUILTIN_VISUAL_STYLES) {
  const resolved = resolveVisualStyle(style.id);
  assert.equal(resolved.id, style.id);
  assert.equal(resolved.prefix, style.prefix);
  assert.equal(resolved.suffix, style.suffix);
  assert.equal(resolved.negative_prompt, style.negative_prompt);
  assert.equal(resolved.registry_version, STYLE_REGISTRY_VERSION);
}

assert.equal(canonicalStyleId("retro-film"), "vintage-film");
assert.equal(canonicalStyleId("magazine"), "illustration");
assert.equal(canonicalStyleId("folk-illustration"), "folk-tale-gongbi");
assert.throws(() => resolveVisualStyle("not-a-style"), error => error?.code === "VISUAL_STYLE_NOT_FOUND");

const medicalScene = "1938年华北前线，一位外国医生正在为伤员做手术，伤口流血，极近景，红色纱布";
const realistic = resolveVisualStyle("realistic");
const realisticSet = buildImageRequestCandidates({
  scenePrompt: medicalScene,
  styleConfig: realistic,
  policyFallback: true
});
assert.ok(realisticSet.candidates.length >= 2, "审核兜底候选必须存在");
for (const candidate of realisticSet.candidates) {
  assert.equal(candidate.styleId, "realistic");
  assert.ok(candidate.prompt.startsWith(realistic.prefix), `${candidate.level} 未保留写实彩色前缀`);
  assert.ok(candidate.prompt.endsWith(realistic.suffix), `${candidate.level} 未保留写实彩色后缀`);
  assert.match(candidate.prompt, /自然色彩/);
  assert.doesNotMatch(candidate.prompt, /纯灰阶黑白|完全无彩色|黑白胶片摄影/);
  assert.doesNotMatch(candidate.prompt, /(^|，)历史纪实摄影(，|$)/);
}

for (const styleId of ["oil-painting", "ink-wash", "watercolor", "ghibli", "folk-tale-gongbi"]) {
  const style = resolveVisualStyle(styleId);
  const set = buildImageRequestCandidates({ scenePrompt: medicalScene, styleConfig: style, policyFallback: true });
  for (const candidate of set.candidates) {
    assert.equal(candidate.styleId, styleId);
    assert.ok(candidate.prompt.startsWith(style.prefix), `${styleId}/${candidate.level} 风格前缀丢失`);
    assert.ok(candidate.prompt.endsWith(style.suffix), `${styleId}/${candidate.level} 风格后缀丢失`);
    assert.doesNotMatch(candidate.prompt, /(^|，)历史纪实摄影(，|$)/);
    if (styleId === "oil-painting") assert.doesNotMatch(candidate.prompt, /真实胶片颗粒/);
  }
}

const blackWhite = resolveVisualStyle("black-white");
const bw = buildImageRequestCandidate({ scenePrompt: "红色旗帜下站着穿蓝色衣服的人", styleConfig: blackWhite });
assert.match(bw.prompt, /纯灰阶黑白胶片摄影/);
assert.doesNotMatch(bw.prompt, /红色|蓝色/);

const pollutedOldPrompt = "黑白纪实摄影，真实胶片颗粒，自然光，情绪克制，一位科学家站在实验室，9:16构图，无文字无水印";
assert.equal(stripKnownStyleLayer(pollutedOldPrompt), "一位科学家站在实验室，9:16构图，无文字无水印");
const repaired = buildStyledPrompt(realistic, pollutedOldPrompt);
assert.ok(repaired.startsWith(realistic.prefix));
assert.doesNotMatch(repaired, /黑白纪实摄影/);

const partiallyPollutedPrompt = "一位科学家站在实验室，黑白纪实摄影，完全无彩色，9:16构图，无文字无水印";
const repairedPartial = buildImageRequestCandidate({
  scenePrompt: partiallyPollutedPrompt,
  styleConfig: realistic,
  level: "preflight"
});
assert.ok(repairedPartial.prompt.startsWith(realistic.prefix));
assert.ok(repairedPartial.prompt.endsWith(realistic.suffix));
assert.doesNotMatch(repairedPartial.prompt, /黑白纪实摄影|完全无彩色|纯灰阶/);
assert.match(repairedPartial.prompt, /自然色彩/);

const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shared", "system-prompt-templates.json"), "utf8"));
const validIds = new Set(BUILTIN_VISUAL_STYLES.map(item => item.id));
for (const template of templates) {
  assert.ok(validIds.has(template.style_id), `系统模板 ${template.id} 使用未知风格 ${template.style_id}`);
  assert.doesNotMatch(template.image_prompt_template || "", /黑白纪实摄影|印象派油画|古风电影画面|美食电影摄影/,
    `系统模板 ${template.id} 硬编码了画风`);
}

const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8");
assert.doesNotMatch(appSource, /selectedStyles/,
  "画图实验室仍允许多选互斥画风");
assert.match(appSource, /styleId:\s*selectedStyle/);
assert.match(appSource, /useState\("realistic"\)/, "画图实验室必须有明确默认画风");
assert.doesNotMatch(appSource, /value === item\.id \? ""/, "画图实验室不应通过再次点击清空画风");

const pipelineSource = fs.readFileSync(path.join(__dirname, "..", "electron", "pipeline.cjs"), "utf8");
assert.doesNotMatch(pipelineSource, /scene\.image_prompt\s*=\s*requestSafety\.prompt/,
  "临时审核 Prompt 仍会覆盖永久分镜 Prompt");
assert.match(pipelineSource, /styleConfig:\s*task\.style_config/);
assert.match(pipelineSource, /canResumeVerifiedStyleRequest/, "旧远程任务必须校验画风版本后才能恢复");
assert.match(pipelineSource, /image_style_registry_version === task\.style_config\?\.registry_version/);

const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
assert.doesNotMatch(mainSource, /task\.style \|\| defaultStyleForTrack/, "任务加载不能静默回退默认风格");
assert.match(mainSource, /任务没有保存画面风格/);

const databaseSource = fs.readFileSync(path.join(__dirname, "..", "electron", "database.cjs"), "utf8");
assert.match(databaseSource, /style TEXT DEFAULT ''/, "数据库不能把缺失画风静默写成黑白摄影");
assert.match(databaseSource, /if \(!rawStyle\) throw new Error/, "创建任务必须强制校验画风");

const safetySource = fs.readFileSync(path.join(__dirname, "..", "electron", "image-prompt-safety.cjs"), "utf8");
assert.doesNotMatch(safetySource, /历史纪实摄影/,
  "安全重写模块不应自行指定历史纪实摄影风格");
assert.doesNotMatch(safetySource, /真实胶片颗粒/,
  "安全重写模块不应把其他风格污染成胶片摄影");

console.log("Style integrity regression test passed");
