# 可选运行资源

将以下可再分发文件放到对应位置后，安装包会自动带入：

- `resources/bin/ffmpeg.exe`：Windows 版 FFmpeg。
- `resources/draft-generator.exe`：你自行实现或有权分发的剪映草稿生成器。
- `resources/default-bgm.mp3`：默认背景音乐。

未提供这些文件时，程序仍可完成前端构建；运行时会尝试调用系统 PATH 中的 `ffmpeg`，剪映草稿功能会记录错误但不会阻断 MP4 输出。

不要直接复制没有分发权的第三方程序或音乐。
