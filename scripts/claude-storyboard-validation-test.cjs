const assert = require('node:assert/strict');
const {
  validateSceneAssignmentDensity,
  validateSceneNarrationAssignments
} = require('../electron/llm-planner.cjs');

const task = { task_type: 'story', tts_speed: 1 };
const goodParts = [
  '这是第一段完整旁白，用来测试大模型能否按照自然语义完成合理分镜，不能切得过短，也不能破坏前后关系和完整画面表达。',
  '这是第二段完整旁白，长度接近四十到五十个中文字符，同时保留清楚的动作、时间、地点和情绪变化，形成独立画面。',
  '这是最后一段旁白，虽然位于结尾，但仍要保持语义完整，并与前面的叙事自然衔接起来，让收束画面保持稳定。'
];
const goodNarration = goodParts.join('');
const good = validateSceneNarrationAssignments({ scenes: goodParts.map((narration, index) => ({ index: index + 1, narration })) }, task, goodNarration, 0);
assert.equal(good.length, 3);
assert.equal(good.map(item => item.narration).join(''), goodNarration);

const badParts = [
  '她很害怕。',
  '但没有退缩。',
  '她继续向前走。',
  '这一段故意写得稍微长一些，用来构造一个明显碎片化的错误分镜结果。'
];
const badNarration = badParts.join('');
assert.throws(
  () => validateSceneAssignmentDensity(
    badParts.map((narration, index) => ({ index: index + 1, narration })),
    task,
    badNarration,
    0
  ),
  /碎片化|密度/
);

const manual = validateSceneNarrationAssignments({ scenes: [
  { index: 1, narration: '短句一。' },
  { index: 2, narration: '短句二。' }
] }, task, '短句一。短句二。', 2);
assert.equal(manual.length, 2, '手动指定镜头数时应尊重用户数量');

console.log('claude-storyboard-validation-test: ok');
