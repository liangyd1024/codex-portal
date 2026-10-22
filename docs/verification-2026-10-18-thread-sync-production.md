# 当前会话自动同步：正式部署与真实验收

## 部署版本

- 正式入口：`http://127.0.0.1:4317/?host=local`。
- 提交：`ab2ffc27070f378d1f30bdbfb7f4bbda6f5e617d`，安装时间 2026-10-18 13:01:31（北京时间）。
- 此版本由并行进行的手机优化部署合入并安装。本聊天逐段比对了同步调度、状态版本保护、历史读取和回归测试，确认与已验收的同步修复一致；随后核对正式 `/api/version`、安装记录和正式 `thread-sync.js`，避免重复安装及回退已部署改动。
- 安装遵循现有指定提交流程，包含空闲检查、加密备份、健康检查和失败回退。未改写 release 文件，未停止目标引擎。正式本机引擎 PID 在验收前后均为 26281。
- 加密备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`，已核对文件存在，大小 1,199,402 字节。
- 原网页配置备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/install-history/1792299687930.plist`。
- 合并版本再次执行 `npm test`：72 项 Node、23 项 Python 全部通过；`git diff --check` 通过。日志 `/tmp/rcm-sync-release-tests.log`。

## 真实桌面端到网页端验证

专用会话为“RCM 交还部署验收 20261018”，ID `REDACTED-ID`。开始时该会话已经交还并处于 released 状态，桌面任务空闲。

通过 Codex 桌面应用的原生会话接口向此会话发送两条验收消息，限定不调用工具、不读写文件，只回复验收标记。仅对这个测试会话发消息。网页使用 ego-browser 访问正式 4317 入口，未注入模拟 API；监测代码只记录真实 fetch、浏览器事件和消息 DOM 的出现时间，不改写请求或响应。

### 保持网页可见时自动同步

桌面回复 `RCM_DESKTOP_AUTO_SYNC_20261018_A` 后，网页在下一轮自动读取显示该回复。浏览器记录到约每 5 秒一次的历史 GET，读取均为 200；从发送验收消息到回复出现期间没有 focus、visibility 或刷新操作事件。“自动刷新项目和模型”开关保持关闭。

该轮桌面任务在 13:02:59 完成（桌面接口时间精度为秒），网页在 13:03:04.050 显示回复，符合下一次约 5 秒读取的预期。

### 切回网页立即同步

先把正式网页切到后台，再通过桌面接口发送第二条消息，等待完成。回复标记为 `RCM_DESKTOP_FOCUS_SYNC_20261018_B`。

- 网页进入 hidden：13:03:26.800。
- 切回 visible：13:03:44.430。
- 新回复 DOM 出现：13:03:44.546。
- 从切回到显示用时 **116 ms**；没有等待下一个 5 秒轮询。
- hidden 期间没有启动新的历史读取。

### 交还后保持只读

两轮实测期间，浏览器 API 写请求为 0，输入框和发送按钮保持禁用，没有点击“在网页继续”。正式接口最终确认：

- handoff.state = released，原 requestedAt 不变。
- controlledThreads 不含测试会话，subscribedThreads 不含测试会话。
- detail.controlled = false，历史来源 snapshot。
- 两个桌面回复标记均可读。

网页未重新接管、未重新订阅、未从网页发送消息。其他会话及原有订阅未操作。

## 页面与证据

正式页面在 1440×900 和 390×844 下均已截图查看；390px 页面实际 scrollWidth 为 390，未横向溢出，只读控件状态正确。浏览器未记录页面错误。验收 TaskSpace 已结束。

完整证据目录：`/var/folders/1c/tbrgv3gn6xbc_m1_7qyptt9w0000gn/T/rcm-sync-production-1qwtfl68`，包含：

- `baseline.json`：部署前版本、引擎进程及测试会话。
- `auto.json`：真实定时读取与回复出现记录。
- `focus.json`：真实标签切换、读取和 116ms 结果。
- `final-state.json`：正式版本与只读状态断言。
- `browser-evidence.json`：浏览器事件和请求记录。
- `desktop.png`、`narrow.png`：正式页面截图。

本次验证本机桌面会话到本机正式网页，不包含 SSH 远端新消息的端到端测试。已打开的旧网页需要刷新一次加载新 JS；加载此版本后，消息同步不再依赖手动刷新。
