const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");
const { openDatabase, createTask } = require("../electron/database.cjs");

app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-character-db-"));
  const db = openDatabase(path.join(dir, "test.db"));
  const task = createTask(db, {
    title: "人物一致性测试",
    inputText: "人物故事测试内容".repeat(10),
    track: "character-story",
    style: "cinematic",
    ratio: "9:16",
    characterConsistencyMode: "auto"
  });
  if (task.character_consistency_mode !== "auto") {
    throw new Error("系统九宫格人物卡模式未写入任务");
  }
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("Character consistency database test passed");
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
