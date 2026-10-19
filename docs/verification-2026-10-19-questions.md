# 网页问题卡片与异步回答验收（2026-10-19）

## 协议依据

核对本机已安装 Codex 客户端 app.asar 的 `app-initial-90eb42395b7d.js`、`app-primary-b4ce9e46e8cf.js`，仅只读分析：异步问题来自 agentMessage.questions，ID 为 `["request_user_input_async", itemId, questionIndex]` 的 JSON；回答为 `<send_user_message_question_reply>` 包装的 questionItemId/question/answer 数组，通过 send-now 发送。跳过只设置本地 isSkipped，不发送空答案。网页收起按钮明确标为“收起问题”，未声称等同于桌面关闭的全部内部行为。

## 实现

- 同步问题沿用 item/tool/requestUserInput 的原请求响应，和异步问题共用表单，支持选项、自由输入、多题；无语音按钮。
- 异步回答经独立 HTTP 接口核对控制权、历史问题、原轮次、完整答案、连接代次后，使用 turn/steer 的 expectedTurnId 提交，不启动新轮次。
- 同一问题并发防重；已确认成功不重发；明确失败允许重试；结果未知阻止重放，提示核对记录。未增加跨入口控制锁。
- sessionStorage 按连接/会话/问题保存文字、选项、收起及跳过状态；成功后清除答案草稿。跳过和恢复仅修改本地状态。
- 连接中断禁用提交，保留内容；原轮次结束或收到有效回答后撤去问题。迟到结果不会清除另一会话输入或抢焦点。
- 保持原始正文和异步运行语义。只读桌面会话不自动接管；未新增后台全会话问题扫描或桌面端跨入口回答。

## 验证

- `node --test test/questions.test.mjs`：7 项通过，覆盖关联 ID、有效回答过滤、持久草稿、过期/伪造/不完整答案拒绝、连接切换、并发、结果未知防重放、CSRF 与 HTTP 等待结果。
- `npm test`：186 项 Node + 45 项 Python 全部通过，日志 `/tmp/rcm-questions-tests.log`。
- ego-browser task space 102；预览 `http://127.0.0.1:4327`，RCM_MOBILE=0，独立状态 `/tmp/rcm-questions-preview-20261019-1792391900`。
- 模拟浏览器：1280px 桌面、390px 窄屏；无横向溢出，触控按钮48px、输入16px；选项/文本、多题、收起/展开、跳过/恢复、刷新草稿、断线禁用及恢复、失败保留及重试、重复提交只一次、切换会话和迟到成功不覆盖新草稿通过。
- 普通问题回归：选择“选项一”后，原 `/api/requests/qa-question/respond` 收到 `{answers:{choice:{answers:["选项一"]}}}`。模拟浏览器无 JS 错误。
- IME：合成 compositionstart/compositionend、isComposing/229、composition 期间 submit 均未发送；手机 Enter 换行、Tab 焦点可达。未验收原生中文输入法或实体手机。
- 截图 `/tmp/rcm-questions-desktop.png`、`/tmp/rcm-questions-mobile.png`、`/tmp/rcm-questions-mobile-top.png` 已查看；多题区域可纵向滚动。

## 真实服务闭环

仅操作本轮测试会话 `01a152e0-14fc-7ca0-b9c8-1c5eccdc48ef`，名称“RCM 异步问答专项验收”，原轮次 `01a152e0-155b-7031-875b-223c1320b789`。

1. 本机真实引擎生成 `delivery:async`、`questions:[{title:"验收代号是什么？",options:null}]`。
2. 在预览网页接管该专用测试会话并填写代号、点击发送。
3. 原历史保存了带原 itemId 的完整结构化回答；Codex 回复“已收到 RCM-问答-20261019”，原轮次 completed，问题卡片消失。
4. 未操作其他真实会话，未停止任何现有任务。真实 SSH 异步回答未单独验收。

## 提交与部署

部署前正式版本 `6c71e92cc1649fc65268ee5765e72fe813ef86d1` 是当前 master 的祖先。保留其他会话已提交的文件预览功能 `8fde9e9`。完整测试和空闲核对通过后按 README 指定版本安装；最终部署结果另补录。
