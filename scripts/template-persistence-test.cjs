const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../electron/database.cjs"), "utf8");
const openDatabaseBody = source.match(/function openDatabase\(path\) \{([\s\S]*?)\n\}/)?.[1] || "";
assert.doesNotMatch(openDatabaseBody, /refreshBuiltinTemplates\(db\)/);
assert.match(source, /INSERT OR IGNORE INTO draft_templates/);
console.log("template-persistence-test: ok");
