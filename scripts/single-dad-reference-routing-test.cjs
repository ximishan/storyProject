const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrV8AAAAASUVORK5CYII=",
  "base64"
);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-single-dad-"));
for (const file of ["DAD-001.png", "CHILD-001.png", "DUO-001.png"]) {
  fs.writeFileSync(path.join(tempDir, file), tinyPng);
}
process.env.STORYBOUND_SINGLE_DAD_ASSET_DIR = tempDir;

const {
  applySingleDadTaskDefaults,
  inferSceneCharacterIds,
  singleDadSceneReferencePaths,
  singleDadReferenceAvailable
} = require("../electron/single-dad-story.cjs");
const {
  taskReferenceAvailable,
  sceneReferencePaths,
  coverReferencePaths
} = require("../electron/reference-routing.cjs");

const defaults = applySingleDadTaskDefaults({
  track: "family-emotion",
  promptTemplateId: "single-dad-story",
  style: "cinematic",
  targetScenes: 0,
  processingMode: "auto",
  pauseMode: "none",
  characterConsistencyMode: "auto",
  bgmId: "builtin",
  videoIntro: -1,
  videoIntroDuration: 8,
  coverImageMode: "titled"
});
assert.equal(defaults.track, "family-emotion");
assert.equal(defaults.style, "single-dad-picturebook");
assert.equal(defaults.targetScenes, 8);
assert.equal(defaults.processingMode, "semi_auto");
assert.equal(defaults.pauseMode, "script");
assert.deepEqual(defaults.pausePoints, [4]);
assert.equal(defaults.characterConsistencyMode, "off");
assert.equal(defaults.bgmId, "none");
assert.equal(defaults.videoIntro, 0);
assert.equal(defaults.videoIntroDuration, 0);
assert.equal(defaults.coverImageMode, "off");
assert.equal(defaults.taskType, "story");

const task = {
  track: "family-emotion",
  prompt_template_id: "single-dad-story",
  reference_image_path: "",
  character_consistency_mode: "off"
};

assert.equal(singleDadReferenceAvailable(task), true);
assert.equal(taskReferenceAvailable(task, "character"), true);

assert.deepEqual(inferSceneCharacterIds({ visual: "爸爸站在厨房门口" }), ["DAD-001"]);
assert.deepEqual(inferSceneCharacterIds({ visual: "女儿坐在餐桌旁写作业" }), ["CHILD-001"]);
assert.deepEqual(inferSceneCharacterIds({ visual: "爸爸和女儿坐在餐桌旁说话" }), ["DAD-001", "CHILD-001"]);
assert.deepEqual(inferSceneCharacterIds({ character_ids: ["CHILD-001"], visual: "爸爸在远处" }), ["CHILD-001"]);

const dad = sceneReferencePaths({ task, scene: { use_reference: false, visual: "爸爸拿着梳子发愣" } });
assert.equal(dad, path.join(tempDir, "DAD-001.png"));

const child = sceneReferencePaths({ task, scene: { use_reference: false, visual: "女儿扶了扶眼镜" } });
assert.equal(child, path.join(tempDir, "CHILD-001.png"));

const duo = sceneReferencePaths({ task, scene: { use_reference: true, visual: "爸爸和女儿面对面说话" } }).split(";");
assert.deepEqual(duo, [
  path.join(tempDir, "DAD-001.png"),
  path.join(tempDir, "CHILD-001.png"),
  path.join(tempDir, "DUO-001.png")
]);

const explicitChild = sceneReferencePaths({
  task,
  scene: { use_reference: true, character_ids: ["CHILD-001"], visual: "爸爸不在镜头里，女儿看着镜子" }
});
assert.equal(explicitChild, path.join(tempDir, "CHILD-001.png"));

assert.equal(sceneReferencePaths({ task, scene: { use_reference: true, visual: "清晨窗外的天空" } }), "");
assert.equal(coverReferencePaths(task).split(";").length, 3);
assert.ok(coverReferencePaths(task).split(";").every(item => item.endsWith(".png")));

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("single-dad-reference-routing-test: passed");
