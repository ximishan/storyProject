# 火山引擎官方公开样音

版本：0.7.6

## 已接入音色

| 音色 | Speaker ID | 版本 | 官方样音 |
|---|---|---:|---|
| 东方浩然 | `zh_male_dongfanghaoran_uranus_bigtts` | 2.0 | `https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/portal/bigtts/zh_male_dongfanghaoran_uranus_bigtts.mp3` |
| 擎苍 | `zh_male_qingcang_mars_bigtts` | 1.0 | `https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/console/bigtts/zh_male_qingcang_mars_bigtts.mp3` |

## 行为说明

1. 点击音色卡片主体会选择正式合成音色。
2. 点击“官方样音”只会在线播放官网公开 MP3，不读取或校验 Key。
3. 页面同一时间只显示一个播放器；切换样音时会重新加载播放器。
4. 点击底部“生成试听”仍然调用火山引擎正式 TTS 接口，会检查 App ID 和 Access Token。
5. 官方样音是远程链接，不会复制或打包第三方音频文件。
