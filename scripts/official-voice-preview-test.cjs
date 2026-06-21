const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const catalog = fs.readFileSync(path.join(root, "src", "volcVoices.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

const expected = [
  "zh_male_dongfanghaoran_uranus_bigtts",
  "zh_male_qingcang_mars_bigtts",
  "portal/bigtts/zh_male_dongfanghaoran_uranus_bigtts.mp3",
  "console/bigtts/zh_male_qingcang_mars_bigtts.mp3"
];

for (const value of expected) {
  if (!catalog.includes(value)) throw new Error(`missing voice preview catalog value: ${value}`);
}
if (!app.includes("playOfficialPreview")) throw new Error("official preview playback handler missing");
if (!app.includes("不需要 Key，不消耗合成额度")) throw new Error("official preview help message missing");
if (!app.includes("tts-official-preview")) throw new Error("official preview button missing");

console.log("official voice preview test passed");
