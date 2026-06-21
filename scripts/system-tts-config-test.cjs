const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('electron/main.cjs');
const services = read('electron/services.cjs');
const preload = read('electron/preload.cjs');
const app = read('src/App.tsx');
const sapi = read('electron/sapi.ps1');
const voiceList = read('electron/sapi-voices.ps1');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['默认 provider 为 system', /provider:\s*"system"/.test(main)],
  ['读取配置不再强制 volcengine', !/merged\.tts\.provider\s*=\s*"volcengine"/.test(main)],
  ['暴露系统音色列表 IPC', /voices:system-list/.test(main) && /listSystemVoices/.test(preload)],
  ['SAPI 支持选择音色', /VoiceName/.test(sapi) && /SelectVoice/.test(sapi)],
  ['系统音色枚举脚本存在', /GetInstalledVoices/.test(voiceList)],
  ['设置页包含本机系统语音', /本机系统语音/.test(app) && /生成试听/.test(app)],
  ['打包包含系统音色枚举脚本', pkg.build.extraResources.some(item => item.from === 'electron/sapi-voices.ps1')]
];

for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '×'} ${name}`);
  if (!ok) process.exitCode = 1;
}
