const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const app = read("src/App.tsx");
const css = read("src/styles.css");
const database = read("electron/database.cjs");
const pipeline = read("electron/pipeline.cjs");
const services = read("electron/services.cjs");

assert.match(app, /STYLE_PREVIEW_ASSETS/);
assert.match(app, /function StyleChoice/);
assert.match(app, /productReferenceImagePath/);
assert.match(app, /disabled=\{Boolean\(templateId\)\}/);
assert.match(app, /画图实验室/);
assert.match(app, /packageInfo\.version/);
assert.match(css, /\.style-hover-card/);
assert.match(database, /product_reference_image_path/);
assert.match(pipeline, /sceneReferencePaths/);
assert.match(services, /产品或物件需保持造型、颜色、包装与关键标识关系/);

console.log("parity-audit-test: passed");
