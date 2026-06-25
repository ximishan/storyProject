const assert = require("node:assert/strict");
const {
  splitNarrationIntoAtomicUnits,
  validateSemiAutoSceneGroups,
  countSceneCharacters
} = require("../electron/llm-planner.cjs");

const narration = `98岁那年，严幼韵被诊断出大肠癌。手术后没几天，她就回家休养。几个月后的生日宴上，她穿着旗袍和金色高跟鞋，和为她做手术的医生跳了一支舞。\n很少有人会把这位精神十足的老太太，和马尼拉的那场战火联系到一起——年轻时，她曾在丈夫生死不明的情况下，独自撑起一个近四十人的大家庭。`;

const units = splitNarrationIntoAtomicUnits(narration);
assert.ok(units.length >= 4, "should create multiple original units");
assert.equal(units.map(item => item.text).join(""), narration, "units must reproduce source exactly");
assert.deepEqual(units.map(item => item.id), Array.from({ length: units.length }, (_, index) => index + 1));

// Build valid consecutive groups targeting roughly 40-70 characters without changing source text.
const groups = [];
let current = [];
let currentLength = 0;
for (const unit of units) {
  const length = countSceneCharacters(unit.text);
  if (current.length && currentLength >= 38 && currentLength + length > 70) {
    groups.push({ unit_ids: current });
    current = [];
    currentLength = 0;
  }
  current.push(unit.id);
  currentLength += length;
}
if (current.length) groups.push({ unit_ids: current });
if (groups.length > 1) {
  const lastLength = groups[groups.length - 1].unit_ids
    .map(id => units[id - 1].characters)
    .reduce((sum, value) => sum + value, 0);
  if (lastLength < 32) groups[groups.length - 2].unit_ids.push(...groups.pop().unit_ids);
}

const task = { task_type: "story", tts_speed: 1 };
const assignments = validateSemiAutoSceneGroups({ groups }, units, task, narration, 0);
assert.equal(assignments.map(item => item.narration).join(""), narration, "assignments must preserve every character");
assert.ok(assignments.every(item => Array.isArray(item.source_unit_ids) && item.source_unit_ids.length));

assert.throws(
  () => validateSemiAutoSceneGroups({ groups: [{ unit_ids: [1, 3] }, { unit_ids: [2] }] }, units, task, narration, 0),
  /按顺序完整覆盖|不连续编号/
);
assert.throws(
  () => validateSemiAutoSceneGroups({ groups: [{ unit_ids: [1] }] }, units, task, narration, 0),
  /按顺序完整覆盖/
);

console.log(`semi-auto locked-text test passed: ${units.length} units -> ${assignments.length} scenes`);
