const assert = require("node:assert");
const templates = require("../shared/system-prompt-templates.json");

assert.equal(templates.length, 9, "应保留 9 个系统赛道模板");
for (const item of templates) {
  assert.equal(item.prompt_revision, "2026-06-21-integrated", `${item.name} 未标记新版提示词`);
  assert.match(item.step1_rewrite_system_prompt, /程序输出适配规则/, `${item.name} 文案提示词缺少 JSON 适配规则`);
  assert.match(item.step1_metadata_system_prompt, /publish\.title/, `${item.name} 封面提示词未接入 publish 字段`);
  assert.match(item.step3_system_prompt, /程序输出适配规则/, `${item.name} 分镜提示词缺少 scenes 适配规则`);
  assert.doesNotMatch(item.step3_system_prompt, /02-sentences\.json|STYLE_PREFIX|STYLE_SUFFIX/, `${item.name} 仍含旧程序专用字段`);
  assert.ok(item.step1_rewrite_system_prompt.length > 1000, `${item.name} 文案规则疑似未导入完整`);
  assert.ok(item.step3_system_prompt.length > 4000, `${item.name} 分镜规则疑似未导入完整`);
}

const health = templates.find(item => item.id === "health-book");
const culture = templates.find(item => item.id === "culture-knowledge");
assert.equal(health.reference_kind, "product");
assert.equal(culture.reference_kind, "product");
assert.match(health.image_prompt_template, /\{product_card\}/);
assert.match(culture.image_prompt_template, /\{product_card\}/);

console.log("Imported prompt templates and runtime adapters test passed");
