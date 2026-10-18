# 真实语音服务诊断

## 已确认

- 正式入口 4317，ego-lite / Chromium 154，安全上下文有效，麦克风权限 granted。
- 原实现使用浏览器 SpeechRecognition，无本项目后端转写请求。
- 云端路径三次事件序列均为 start → audiostart → error(network) → end，采集开始后约 0.2–0.4 秒出错；无 result。错误 message 为空，不能仅凭 network 判定 DNS、TLS、代理或服务鉴权的具体原因。
- 将 7.53 秒中文 WAV 音轨直接传入真实 SpeechRecognition.start(track)，同样复现 network。不是模拟 onresult。
- 本地识别 SODA Library 与 cmn-Hans-CN 中文模型完成安装。available(zh-CN, processLocally=true) 返回 available。
- 实测本地音轨（16 kHz / 单声道）、麦克风采集电脑播放测试句，均出现 soundstart / speechstart，但无 result；最终输入框为空。
- 浏览器 quality 默认为 command；available(zh-CN, processLocally=true, quality=dictation) 返回 unavailable。尝试 cmn-Hans-CN、单次识别也未获得文字。

## 结论与限制

云端语音服务链路失败已复现，具体网络/鉴权根因仍未知；本地识别在此环境尚不能完成中文听写，不能作为已验证修复发布。原正式版本保持不变，本地识别优先的实验代码已撤回。

真实音频为系统 Tingting 语音合成的“你好，这是一段语音输入测试。请把这句话转换成文字，保留在输入框中。”，并验证有非静音信号（平均 -18.1 dB）。尚未取得成功的真实语音到输入框转写结果。没有发送会话消息。

需要选择可用的替代转写引擎：本机离线模型，或配置云端转写服务；选择后继续端到端验证。
