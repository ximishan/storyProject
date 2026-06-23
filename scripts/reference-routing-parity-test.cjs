const assert = require("node:assert/strict");
const {
  taskReferenceAvailable,
  sceneReferencePaths,
  coverReferencePaths,
  productReferencePaths
} = require("../electron/reference-routing.cjs");

const task = {
  track: "ecommerce",
  reference_image_path: "C:/refs/character.png",
  product_reference_image_path: "C:/refs/product.png",
  character_consistency_mode: "upload"
};

assert.equal(taskReferenceAvailable(task, "character"), true);
assert.equal(taskReferenceAvailable(task, "product"), true);
assert.equal(sceneReferencePaths({ task, scene: { use_reference: true, subject_presence: "character" } }), "C:/refs/character.png");
assert.equal(sceneReferencePaths({ task, scene: { use_reference: true, subject_presence: "product" } }), "C:/refs/product.png");
assert.equal(sceneReferencePaths({ task, scene: { use_reference: true, subject_presence: "both" } }), "C:/refs/character.png;C:/refs/product.png");
assert.equal(sceneReferencePaths({ task, scene: { use_reference: false, subject_presence: "both" } }), "");
assert.equal(coverReferencePaths(task, "product"), "C:/refs/product.png");

const autoTask = {
  track: "character-story",
  reference_image_path: "",
  product_reference_image_path: "",
  character_consistency_mode: "auto"
};
assert.equal(taskReferenceAvailable(autoTask, "character"), true);
assert.equal(sceneReferencePaths({
  task: autoTask,
  scene: { use_reference: true, subject_presence: "character" },
  generatedCharacterPaths: "C:/refs/young.png;C:/refs/side.png"
}), "C:/refs/young.png;C:/refs/side.png");

// 兼容旧产品任务：0.8.x 把产品参考图存进 reference_image_path。
const legacyProductTask = {
  track: "health-book",
  reference_image_path: "C:/refs/legacy-book.png",
  product_reference_image_path: "",
  character_consistency_mode: "off"
};
assert.equal(productReferencePaths(legacyProductTask), "C:/refs/legacy-book.png");
assert.equal(taskReferenceAvailable(legacyProductTask, "product"), true);
assert.equal(sceneReferencePaths({
  task: legacyProductTask,
  scene: { use_reference: true, subject_presence: "product" }
}), "C:/refs/legacy-book.png");

console.log("reference-routing-parity-test: passed");
