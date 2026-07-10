const assert = require("node:assert/strict");
const { sanitizeUnsupportedCharacterEthnicity } = require("../electron/llm-planner.cjs");

const source = "一个巴黎来的女硕士，最后死在了广西苗寨的一场大火里。她原本可以留在法国，过安稳平静的日子。她在巴黎长大，后来来到中国。";
const card = sanitizeUnsupportedCharacterEthnicity({
  enabled: true,
  name: "方芳",
  identity: "法籍华裔女性，硕士学历",
  face: "中国面孔，气质知性",
  stable_prompt: "方芳，法籍华裔女性，硕士学历，面容气质知性，具体外貌特征unknown，服装unknown"
}, source);

assert.doesNotMatch(card.stable_prompt, /华裔|华人|中国面孔|中国女孩|亚洲面孔|东亚面孔|unknown/);
assert.match(card.stable_prompt, /法国女性|欧洲女性外貌/);
assert.match(card.identity, /法国女性|欧洲女性外貌|法籍女性/);

const explicitChinese = sanitizeUnsupportedCharacterEthnicity({
  enabled: true,
  stable_prompt: "法籍华裔女性，黑发，青年"
}, "她是一位法籍华裔女性，在巴黎长大。");
assert.match(explicitChinese.stable_prompt, /华裔/);

console.log("character ethnicity guard test passed");
