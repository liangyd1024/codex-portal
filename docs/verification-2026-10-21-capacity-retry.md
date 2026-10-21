# 模型容量不足的原生重试入口

## 原生依据

只读检查本机 ChatGPT.app 的 app.asar，未修改安装文件：

- `app-primary-b4ce9e46e8cf.js` 的 `nZe/rZe/oZe`：仅最新 failed 轮次、`serverOverloaded`、ready 和 owner 条件下提供容量重试，延迟为 10、30、120、300 秒；自动重试受桌面功能开关控制。区分 `capacity_retry_automatic` 与 `capacity_retry_manual`。
- 对应导出 `MLt` 实为 `app-initial-90eb42395b7d.js` 的 `TDo`，调用原生客户端 `startEmptyTurn`。不复制用户消息。
- 本机 `codex app-server generate-ts --experimental` 输出确认 `turn/start` 支持 input 数组、clientUserMessageId、turnTrigger；`ErrorNotification` 有 willRetry。临时协议目录 `/tmp/rcm-retry-protocol-20261021`。

## 实现与边界

网页增加上述有限倒计时、立即重试和取消入口。错误正文原样保留。仅处理当前接管会话的最新明确容量错误；不把配额不足、其他错误、原生处理中间重试或旧失败记录当作新任务。

服务端先核对控制权、原生协议能力、实时空闲状态、最新失败轮次、连接代次和待处理请求，再调用原生 turn/start，input 为 []，保留网页完全访问策略和当前模型/模式选择。为同一失败轮次生成稳定的原生 clientUserMessageId，并复用进行中/完成回执，结果未知禁止自动重放。未创建后台执行器、修改原生会话或建立原生任务副本。

倒计时和取消状态是标签页展示状态，保存在 sessionStorage。页面初次加载先等待可用状态，不因加载过程永久暂停。断线、切换会话、交还控制权或新任务会停止旧倒计时；网页关闭后不执行后台重试。桌面托管入口保持由桌面处理。现有跨入口控制锁限制仍存在，不能宣称跨入口原子互斥。

## 验证

- 新增 8 项 Node 测试：原生空输入、并发防重、过期轮次、运行态、待回答请求、连接切换、配额错误、未知结果防重放、读取失败恢复、退避次数、刷新/取消/断线、迟到响应隔离、初始化与 CSRF。
- 全量 npm test：299 项 Node、55 项 Python 全部通过；日志 `/tmp/rcm-capacity-tests-final.log`。预览使用 4327、独立临时状态，未操作真实用户任务。
- ego-browser space 55：隔离模拟 API，1280×900 桌面实测 10 秒自动触发一次；再次容量失败显示 30 秒；390×844 取消和手动触发各正常，无横向溢出，按钮 44px；Tab 焦点 solid，无 JS 错误。自动与手动请求保留原失败 turnId，原消息没有复制。
- 浏览器窗口最小化，截图未完成。本次不修改文字输入处理，未验证实体手机或真实 IME。
- 未人为制造真实模型容量不足；真实服务验证仅检查版本、静态资源和健康状态，不把模拟重试视为真实过载闭环。

## 发布

部署前正式版本为 `1f629fac28838929a7169e93f7737af46deeb3f5`，新 master 包含此前提问框字体及输入区占位修复。部署结果完成后补录。

- 功能提交及正式版本：`fc1f1270deef6183a9d8ea9c182c7071409735f0`，已推送 origin/master。
- 安装空闲检查通过，仅豁免当前部署会话；未停止目标引擎或其他会话。
- 部署前加密备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261021T074219565613Z.tar.gz.age`。
- 安装健康检查通过；正式 `/api/version` 返回上述版本，`/capacity-retry.js` 返回 200。
- 正式 `/api/status` 显示 connected，`service.protocolValidation.features.capacityRetry.supported` 为 true。此前提问框字体与输入区占位改动同批上线。
- 已关闭验收浏览器空间和本轮 4327 预览服务。后续仅补录文档，不再次部署。
