# 手机技能输入对齐及验收

## 官方证据

2026-10-18 查阅并打开 OpenAI 官方资料：
- https://developers.openai.com/blog/mastering-codex-remote-for-engineering （2026-06-23）明确介绍手机 Remote 输入区的技能与插件行内引用。
- 官方截图 https://developers.openai.com/images/blog/mastering-codex-remote-skills-plugins.jpg 已在 ego-browser 打开并截图检查：多个蓝色技能/插件名称嵌在提示词句子内，不是输入区外的长期选择标签。
- https://learn.chatgpt.com/docs/reference/slash-commands 为命令入口参考。手机候选菜单完整操作视频未找到，本项目候选列表结合用户给出的截图实现。

## 本次实现

从当前正式版 c695f10 的后续纯文档提交 7b980a3 建立隔离发布工作树，仅叠加本次输入改动，保留完全访问、图片及手机登录修复。

输入 `/` 或 `$` 查询目标项目技能；方向键、Enter、Tab 和触控选择，Escape 关闭。技能和插件选择插入当前光标处，蓝色引用与文字一起编辑；删除引用则从结构化发送选项移除。选择只随当前草稿生效，不作为会话长期偏好；发送失败保留、成功清空、刷新恢复草稿。模式菜单“执行”改为“默认”，增加既有目标设置入口，未新增虚假的 collaborationMode。

网页版保留原生 textarea，以同文本镜像给引用着色，避免改用 contenteditable 后影响原生中文输入、图片粘贴及草稿机制。可编辑的 `$技能名` / `@插件名` 与官方图标式富文本引用存在视觉及逐字删除方式差异；没有声称原生界面逐像素一致。插件仍沿用原有服务端的显式指令机制。

## 验证

- 发布工作树 npm test：96 项 Node、24 项 Python 全部通过；git diff --check 通过。
- ego-browser 空间 59，完整实际页面 + 拦截全部 API 的模拟 fixture；不是替换 DOM 的独立表单。桌面 1440px、390×844 和 390×440 可视区检查通过，390px scrollWidth=390。截图及主要结果见 skill-mentions-evidence/。
- 验证多个行内引用、`/` 和 `$` 查询、触控、Enter/Tab、Escape、目标弹窗、插件插入后焦点回输入框、Tab 到图片按钮且焦点可见。
- 验证模拟发送失败保留、成功清空、下一条不携带旧技能、目录失败后重试、删除引用取消结构化参数、请求迟到不覆盖草稿、会话切换关闭候选、连接中断保留草稿、刷新恢复引用。
- compositionstart + Enter + compositionend 模拟没有发送消息，草稿保留。尚未使用实体手机原生输入法与候选窗验证。
- 真实预览服务读取本机目标 `/api/composer` HTTP 200，184 项技能（183 项启用），未向真实引擎发送任务。结构化发送参数经模拟浏览器和后端单元测试验证。
- 侧栏模拟会话选择使用 DOM click：ego 高层点击出现 element not connected；本次不宣称侧栏触控重新通过验收。

## 尚未验证

实体 iPhone / Android、系统键盘、真实模型使用所选技能/插件的完整任务。原生应用图标引用与当前可编辑文本引用的差异已说明。
