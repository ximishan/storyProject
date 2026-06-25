const assert = require('node:assert/strict');
const {
  countSceneCharacters,
  inferAutoSceneCount,
  estimateNarrationDurationSeconds,
  splitNarrationForScenePlan
} = require('../electron/llm-planner.cjs');

assert.equal(countSceneCharacters('甲，乙。'), 4, '中文标点必须计入字符数');
assert.equal(countSceneCharacters('甲，\n 乙。'), 4, '空格和换行不应计入字符数');
assert.equal(inferAutoSceneCount('字'.repeat(46), 1), 1);
assert.equal(inferAutoSceneCount('字'.repeat(92), 1), 2);
assert.equal(inferAutoSceneCount('字'.repeat(460), 1), 10);
assert.equal(inferAutoSceneCount('字'.repeat(920), 1), 20);
assert.equal(Math.round(estimateNarrationDurationSeconds('字'.repeat(230), 1)), 60);
assert.equal(inferAutoSceneCount('字'.repeat(230), 1), 5, '默认语速下一分钟旁白应约 5 镜');
assert.equal(inferAutoSceneCount('字'.repeat(230), 1.15), 4, '更快语速下同样文字时长更短，镜头数应相应减少');

const narration = Array.from({ length: 10 }, (_, index) => `这是第${index + 1}段旁白，用来验证自然语义切分和完整覆盖，每段都有清楚的标点。`).join('');
const autoScenes = splitNarrationForScenePlan(narration);
assert.equal(autoScenes.length, inferAutoSceneCount(narration));
assert.equal(autoScenes.join(''), narration, '自动切分不得漏字、添字或改变标点');

const manualScenes = splitNarrationForScenePlan(narration, 4);
assert.equal(manualScenes.length, 4, '手动目标分镜数必须优先');
assert.equal(manualScenes.join(''), narration);

console.log('scene-density-test: ok', {
  characters: countSceneCharacters(narration),
  autoScenes: autoScenes.length,
  average: Math.round(countSceneCharacters(narration) / autoScenes.length)
});
