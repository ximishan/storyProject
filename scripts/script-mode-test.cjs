const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { preparePipeline } = require("../electron/pipeline.cjs");

async function prepare(inputText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-script-mode-"));
  return preparePipeline({
    task: {
      id: Math.random().toString(36).slice(2),
      title: "播客模式测试",
      input_text: inputText,
      track: "culture-knowledge",
      style: "cinematic",
      ratio: "9:16",
      processing_mode: "semi_auto",
      task_type: "podcast",
      podcast_speakers: "mizai-dayi"
    },
    config: { llm: { provider: "local", protocol: "local" }, task_storage_path: root },
    baseOutputDir: root,
    emit: () => {}
  });
}

async function main() {
  let invalidRejected = false;
  try {
    await prepare("[A] 第一行\n第二行没有角色标签");
  } catch (error) {
    invalidRejected = /每一行/.test(String(error?.message || error));
  }
  const result = await prepare("[A] 为什么天空是蓝色？\n[B] 因为光在空气中发生散射。");
  const checks = {
    invalidRejected,
    twoScenes: result.script.scenes.length === 2,
    rolesPreserved: result.script.scenes.map(scene => scene.speaker_role).join("") === "AB",
    speakersMapped: result.script.scenes.map(scene => scene.speaker_name).join("/") === "咪仔/大壹",
    sourceTextPreserved: result.script.scenes[0].narration === "为什么天空是蓝色？"
  };
  if (Object.values(checks).some(value => !value)) throw new Error(JSON.stringify(checks, null, 2));
  console.log(JSON.stringify({ checks }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
