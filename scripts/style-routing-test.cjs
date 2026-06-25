const assert = require("node:assert/strict");
const { BUILTIN_VISUAL_STYLES, resolveVisualStyle, buildStyledPrompt } = require("../electron/visual-styles.cjs");
const { buildPolicySafeImagePrompt } = require("../electron/image-prompt-safety.cjs");

assert.equal(BUILTIN_VISUAL_STYLES.length, 12);
for (const item of BUILTIN_VISUAL_STYLES) {
  const style = resolveVisualStyle(item.id);
  const request = buildStyledPrompt(style, "一位人物站在窗前");
  if (item.id === "black-white") {
    assert.match(request, /纯黑白/);
  } else {
    assert.equal(style.allow_color, true, `${item.id} 应允许彩色`);
    assert.match(request, /彩色/);
    assert.match(request, /禁止黑白|避免纯黑白/);
  }
  const safe = buildPolicySafeImagePrompt(`${request}，正在做手术`, "preflight", { styleConfig: style });
  if (item.id === "black-white") assert.match(safe.prompt, /纯黑白/);
  else {
    assert.match(safe.prompt, /彩色/);
    assert.match(safe.prompt, /禁止黑白|避免纯黑白/);
  }
}
console.log(`style-routing-test: ${BUILTIN_VISUAL_STYLES.length} styles ok`);
