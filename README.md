本地打包成exe发给别人的命令

在 powershell 中执行

Set-Location "D:\storybound\source"

Remove-Item ".\release" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item ".\dist" -Recurse -Force -ErrorAction SilentlyContinue

npm install
npx electron-builder install-app-deps

npm run test:caption
npm run test:llm-planner
npm run test:reference-routing
npm run test:character-db
npm run build


$env:HTTP_PROXY="http://127.0.0.1:7897" 
$env:HTTPS_PROXY="http://127.0.0.1:7897" 
npx electron-builder --win nsis

会在当前的目录release中生成exe文件