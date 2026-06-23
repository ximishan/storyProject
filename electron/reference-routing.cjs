const PRODUCT_REFERENCE_TRACKS = new Set([
  "health-book",
  "culture-knowledge",
  "ecommerce",
  "food-vlog"
]);

function normalizeReferencePaths(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(/[;\n]/);
  return [...new Set(values.map(item => String(item || "").trim()).filter(Boolean))];
}

function joinReferencePaths(...values) {
  return [...new Set(values.flatMap(normalizeReferencePaths))].join(";");
}

function characterReferencePaths(task, generatedCharacterPaths = "") {
  return joinReferencePaths(task?.reference_image_path, generatedCharacterPaths);
}

function productReferencePaths(task) {
  if (task?.product_reference_image_path) return joinReferencePaths(task.product_reference_image_path);
  // 兼容 0.8.x：产品类任务过去只有 reference_image_path 一个字段。
  if (PRODUCT_REFERENCE_TRACKS.has(String(task?.track || "")) && task?.reference_image_path) {
    return joinReferencePaths(task.reference_image_path);
  }
  return "";
}

function taskReferenceAvailable(task, referenceKind = "auto") {
  const kind = String(referenceKind || "auto").toLowerCase();
  const characterAvailable = Boolean(
    task?.reference_image_path
    || task?.character_consistency_mode === "auto"
  );
  const productAvailable = Boolean(productReferencePaths(task));
  if (kind === "character") return characterAvailable;
  if (kind === "product") return productAvailable;
  if (kind === "none") return false;
  return characterAvailable || productAvailable;
}

function sceneReferencePaths({ task, scene, generatedCharacterPaths = "" }) {
  if (!scene?.use_reference) return "";
  const subject = String(scene?.subject_presence || "none").toLowerCase();
  const characterPaths = characterReferencePaths(task, generatedCharacterPaths);
  const productPaths = productReferencePaths(task);

  if (subject === "product") return productPaths;
  if (subject === "character") return characterPaths;
  if (subject === "both") return joinReferencePaths(characterPaths, productPaths);

  // 兼容旧任务：旧分镜没有 subject_presence 时，按赛道优先选择正确类型。
  if (PRODUCT_REFERENCE_TRACKS.has(String(task?.track || ""))) {
    return joinReferencePaths(productPaths, characterPaths);
  }
  return joinReferencePaths(characterPaths, productPaths);
}

function coverReferencePaths(task, referenceKind = "auto") {
  const kind = String(referenceKind || "auto").toLowerCase();
  const characterPaths = characterReferencePaths(task);
  const productPaths = productReferencePaths(task);
  if (kind === "product") return productPaths;
  if (kind === "character") return characterPaths;
  return joinReferencePaths(productPaths, characterPaths);
}

module.exports = {
  PRODUCT_REFERENCE_TRACKS,
  normalizeReferencePaths,
  joinReferencePaths,
  characterReferencePaths,
  productReferencePaths,
  taskReferenceAvailable,
  sceneReferencePaths,
  coverReferencePaths
};
