const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const files = [
  "black-white-D1QqPH8b.webp",
  "realistic-Atk_pZhY.webp",
  "oil-painting-8NyuzxAO.webp",
  "cinematic-BdXqwPs4.webp",
  "ancient-cinematic-COp7S7MP.webp",
  "vintage-film-CrPRxEWS.webp",
  "watercolor-DPPl-c7w.webp",
  "illustration-Dx-tzI7d.webp",
  "pixar-3d-DqhR0fI-.webp",
  "ink-wash-n6PE-maw.webp",
  "folk-tale-gongbi-D-GnOj_N.webp",
  "ghibli-CLd8wrdG.webp"
];

for (const file of files) {
  const target = path.join(__dirname, "..", "public", "style-previews", file);
  assert.ok(fs.existsSync(target), `missing ${file}`);
  const data = fs.readFileSync(target);
  assert.equal(data.subarray(0, 4).toString("ascii"), "RIFF", `${file} is not RIFF`);
  assert.equal(data.subarray(8, 12).toString("ascii"), "WEBP", `${file} is not WEBP`);
}
console.log(`style-preview-assets-test: ${files.length} previews passed`);
