# 目标模式问答核验

## 结论

现有网页版支持原生同步提问和异步提问。目标模式复用相同问答链路，无需新增业务实现。本次仅补验收记录，不修改应用代码，不重新部署。

“目标待确认”来自 composer 的目标读取错误或未确认状态，不是等待用户回答的标记。普通助手正文不会被转换成问题卡片。仅查看、由桌面控制的会话不能通过网页回答；这项限制仍保留，不能宣称跨入口回答已支持。

## 原生服务验证

使用配置中的本机连接，通过既有本机传输和 RPC 创建独立测试会话。没有接管或修改业务会话，没有重启网页、桌面或目标服务。

- 测试会话：`01a15e7e-3528-7600-bf30-cf074c225779`。
- 测试轮次：`01a15e7e-375b-7520-8b07-34a655548392`。
- `thread/goal/set` 设置专用验收目标，要求调用异步提问工具并等待回答。
- 引擎返回真实 `agentMessage.questions`，题目为“验收代号选哪个？”，选项为 RCM-甲、RCM-乙。
- 调用现有 `Manager.answerQuestions`，以原 item ID、问题 ID 和 expectedTurnId 提交 RCM-乙。该验证使用原生历史读取，没有通过网页 HTTP 提交真实答案。
- 原生历史保存结构化回答。最终助手原文为“已收到：RCM-乙”，轮次 completed，目标 complete。
- 原生历史记录：`/tmp/rcm-goal-question-history-final.json`。测试脚本：`/tmp/rcm-goal-question-probe.mjs`。测试会话与临时目录保留。

## 正式静态资源与模拟接口验证

正式 `/api/version` 为 `e08b6899944a2a520e4a92a145ca6bef8e09799c`。使用 ego-browser space 68，加载正式网页静态资源。注入已有隔离 fixture，全部 API 写入被模拟接口拦截，不向真实业务发送消息。模拟会话附带 active 目标。

- 桌面宽度 1280px：问题卡片、选项、多题自由回答正常，无横向溢出。
- 390px 窄屏：scrollWidth 为 390，输入字号 16px，Tab 到达跳过按钮且焦点轮廓可见。问题区可内部滚动。
- 断线禁用发送并保留草稿；明确失败保留文字，重试成功后撤去卡片；提交保留原问题和轮次关联。
- 同步问题回归使用原 `/api/requests/qa-question/respond` 接口。
- 合成 compositionstart/compositionend 期间 submit 未触发请求；没有验收真实中文输入法或实体手机。
- 没有浏览器 JavaScript 错误。窄屏截图 `/tmp/rcm-goal-question-mobile.png` 已查看，截图处于问题列表滚动中部。
- 浏览器任务空间完成后关闭。

## 自动化与限制

`node --test test/questions.test.mjs test/goal-submit.test.mjs`：14 项通过。日志 `/tmp/rcm-goal-question-tests.log`。本次为纯验收文档，没有运行全量 npm test。

本轮真实服务仅验证本机，未另测 SSH 目标。真实目标闭环和浏览器模拟分别验证，不将两者描述为本轮完成了真实浏览器端到端提交。此前真实浏览器异步问答验收见 `verification-2026-10-19-questions.md`。

开始和结束均保留其他会话对 `docs/verification-2026-10-21-goal-history.md` 的未提交修改。本次验收以 master `f521c25` 为基线；只提交本文件。
