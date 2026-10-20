# 侧栏登录身份

## 行为与依据

- Codex 标识上方新增登录身份。ChatGPT 模式显示邮箱，原用量入口不变；邮箱为空时显示“ChatGPT 账号”。API Key 模式显示“API Key”，隐藏账号额度。“自动刷新”控件不变。
- 使用现有 `account/read`，不强制刷新登录令牌。当前目标二进制导出的 `v2/GetAccountResponse.json` 中，ChatGPT 账号含 `email`，API Key 账号只有 `type`。未发现可读取 Key 前后缀的账号接口，因此不展示 Key 片段，不读取凭据文件或环境密钥。
- HTTP 响应仅增加允许显示的类型和邮箱，不透传原始账号对象。沿用每分钟读取；切换连接和断开时清空显示，迟到响应不能覆盖新连接。读取失败显示提示并自动重试，用量读取失败不丢失已核实的身份。
- 沿用系统字体、13px 文字和侧栏色彩。长邮箱自动换行。此次布局依据用户提供的 RCM 截图与现有组件，不声称与 Codex 原生账号入口像素级一致。

## 验证

- 相关账号与状态测试 12 项通过。覆盖字段过滤、API Key 不读额度、未知身份、用量失败、断开后重连、迟到成功与失败、模式切换和退出登录。
- 最终 `npm test`：285 项 Node.js、53 项 Python 测试通过。日志 `/tmp/rcm-account-identity-tests-final-x31ppd93.log`。
- 首次全量测试遇到 Node 测试运行器反序列化错误，位置为 `mobile-session.test.mjs`，日志 `/tmp/rcm-account-identity-tests-7zjf3kza.log`。该文件单独复跑 3 项通过，随后完整重跑通过。未改测试以规避失败，未认定已查明该运行器错误的根因。
- 真实服务：通过现有本机连接只读核对 `account/read` 与用量，确认返回 ChatGPT 类型、邮箱和额度。未切换真实账号，未测试真实 API Key 登录。
- ego-browser 空间 30，预览端口 4327、`RCM_MOBILE=0`，状态目录 `/tmp/rcm-account-preview-cYbAIq`。页面使用真实 HTML/CSS/JS，模拟 API/SSE 验证账号、API Key、加载、失败、断开和恢复。
- 1440×900 桌面和 390×844 窄屏无页面横向溢出。邮箱位于 Codex 与用量上方，长邮箱换行，API Key 不显示额度。Tab 焦点有实线轮廓，Escape 关闭抽屉并恢复入口焦点。
- 已查看截图：`/tmp/rcm-account-desktop.png`、`/tmp/rcm-account-mobile-long.png`、`/tmp/rcm-account-mobile-key.png`。浏览器空间和独立预览已关闭，未删除测试目录。
- 未修改输入流程，未复测中文输入法或实体手机。未向业务会话发送消息、接管会话或中断任务。

## 部署

正式部署结果在完成标准安装及健康检查后补记。
