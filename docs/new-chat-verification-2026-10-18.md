# 新会话流程验收（2026-10-18）

## 参考与范围

参考 OpenAI 官方 [Codex App quickstart](https://learn.chatgpt.com/docs/quickstart?setup=app) 和 [Projects](https://learn.chatgpt.com/docs/projects)：选择项目与工作位置，在新聊天输入首条请求开始工作。原生 Codex App 访问被 Computer Use 安全策略阻止，因此没有原生界面逐项实测或像素一致性的声明。

本次以已部署 b44e325 为功能基线：新建弹窗改为新会话页，首次发送才创建并发送；项目、模型、档位、图片和技能复用原输入区。执行/默认选择移入工具，启用计划时工具入口显示状态。未新增 worktree、云环境或无项目会话；目标设置需先建立会话。

## 验证

- npm test：101 项 Node、24 项 Python 通过。新增创建未知结果防重、刷新恢复、旧历史迟到响应保护。
- ego-browser，隔离预览 4327 + mock API：打开不创建、返回重开草稿、桌面/390px 无横向溢出、焦点进入输入框、Tab 导航、技能+图片+计划首条请求、明确失败重试、消息失败重试同一会话、未知结果阻止重复提交、用户核对后恢复、进行中防重、断线草稿保留均通过。
- 中文输入法使用 CompositionEvent/KeyboardEvent 模拟确认，不代表真实手机系统输入法验收。未使用真实引擎发送新测试任务。
- 截图：[桌面](new-chat-evidence/desktop.png)、[390px](new-chat-evidence/mobile.png)，模拟检查记录：[browser.json](new-chat-evidence/browser.json)。

正式部署与健康检查结果另记部署记录。
