# Storybound 1.7.0 原版 EXE 解析说明

## 结论先说

本次可以较有把握地列出原版前端中写入的功能，但这仍然属于**静态分析**，不是完整的 Windows 实机验收。

- 功能核对表共拆分：**430 个功能点**
- 已直接解包：NSIS 安装包
- 已提取并分析：Tauri 前端 bundle、风格预览图、配置数组、路由、UI 文案
- 已识别：PyInstaller Sidecar、pyJianYingDraft、内置 FFmpeg 7.1
- 未完成：Rust 主程序完整反编译、draft-generator 全部 Python 字节码反编译、原版私有服务端实测

## 原文件指纹

- 安装包：`f3c043a603413ee850f09ca530871a2659ae388e54d848557df56596372e2e59`
- 主程序：`fcf18bee51cdfb323571705f5a82dcd0a8f78251ad2bf9091f33dd2090ec991f`
- Sidecar：`5a8b3f9d38ca4112df2b60c0a9650066f813417b17424a7007cbf71194d0c63d`

## 实际解析步骤

1. 保存原始 EXE，计算 SHA-256。
2. 使用 7-Zip 26.01 识别为 NSIS 3 Unicode/LZMA 安装包并解包。
3. 得到 `storybound.exe`、`draft-generator.exe`、`resources/default-bgm.mp3`。
4. 检查 PE 架构，确认主程序和 Sidecar 均为 Windows x64。
5. 提取主程序 ASCII/UTF-16 字符串，确认 Tauri 2.10.3、Wry、WebView2、SQLite、Shell、FS、SQL 等插件。
6. 定位 Tauri 内嵌的前端资源，解压得到 `index.html`、主 JS bundle 和 12 张画面风格 WEBP。
7. 从前端 bundle 提取路由、React UI 字面量、配置数组、服务商配置、音色目录、动画目录。
8. 单独解析火山音色逻辑，确认 185 音色、6 分类、最多 5 收藏和真实缓存方式。
9. 提取 Tauri invoke 命令：钥匙串、HTTP、许可证、更新、文件授权、Sidecar 启动等。
10. 分析 `draft-generator.exe` 的 PyInstaller TOC/字符串，确认包含 `pyJianYingDraft`、剪映模板、动画元数据和 FFmpeg 7.1。
11. 用用户提供的截图核对悬浮预览所在页面。
12. 建立证据等级和逐项核对表。

## 我之前说错或说过头的地方

1. 原版试听缓存不是写入 AppData 文件夹，而是浏览器 `localStorage`。
2. 不是所有音色/语速都跨重启缓存；持久化逻辑主要针对收藏音色的默认语速试听。
3. 原版没有找到 Windows 本机系统语音入口。
4. `draft-generator.exe` 尚未被完整反编译，不能声称所有内部参数已经还原。
5. 以前没有建立完整功能矩阵，不能把局部补丁说成“全部功能已经改完”。

## 如何使用核对表

打开 Excel 的“功能核对表”：

- `当前代码状态`：记录你的项目目前实现情况。
- `你的核对结果`：下拉选择“一致 / 部分一致 / 缺失 / 不需要”。
- 灰色项是原版自己标明“预留、开发中、未开放”或静态分析未发现的内容。
- 服务端相关功能即使代码存在，也要在 Windows 原版中实际登录验证。
