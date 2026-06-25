const assert = require('node:assert/strict');
const {
  validateSceneNarrationAssignments
} = require('../electron/llm-planner.cjs');

const task = { task_type: 'story', tts_speed: 1 };
const originalParts = [
  '1942年1月，日军占领马尼拉。日方胁迫杨光泩交出相关名单，并要他出任伪职，他当场拒绝，随后被囚。',
  '起初家属还能探望，后来突然失去消息。严幼韵带着三个女儿，和其他外交官的妻儿一起生活，近四十口人挤在同一座房子里。',
  '她把花园改成菜地，带着众人种菜、养鸡养鸭，还学着做肥皂；没有收入，就靠变卖物品维持开支。'
];
const original = originalParts.join('');

// 模拟 Claude 只改了标点、引号和少量措辞；程序应保留 Claude 的三镜结构，
// 但最终 narration 必须恢复为原旁白的精确连续切片。
const claudeScenes = [
  { index: 1, narration: '1942年1月日军占领马尼拉，日方胁迫杨光泩交出相关名单，还要求他担任伪职，他拒绝后被囚。' },
  { index: 2, narration: '起初家属可以探望，后来却突然没了消息。严幼韵带着三个女儿以及其他外交官家属，近四十人住在一起。' },
  { index: 3, narration: '她把花园改成菜地，带大家种菜、养鸡鸭、做肥皂；没有收入时，就变卖物品维持生活。' }
];

const result = validateSceneNarrationAssignments({ scenes: claudeScenes }, task, original, 0);
assert.equal(result.length, 3);
assert.equal(result.map(item => item.narration).join(''), original);
assert.deepEqual(result.map(item => item.narration), originalParts);

console.log('claude-boundary-recovery-test: ok');
