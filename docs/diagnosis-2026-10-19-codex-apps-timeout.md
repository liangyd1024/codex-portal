# codex_apps 启动超时排查

2026-10-19 北京时间约 13:44–13:48。此前扩展提示展示优化不属于底层故障修复，本记录纠正排查范围。

## 已确认的故障位置

独立启动与正式服务同一版本的 Codex app-server，用 ephemeral 测试会话执行 thread/start，不发送模型消息、不接管任何现有会话。四次可用测试均复现 `timed out awaiting tools/list after 30s`。因此不经过网页也会触发故障。

最后一组 trace 记录：

- 05:47:08 UTC 左右创建测试会话成功。
- 05:47:18.516 UTC：远端 plugin-runtime 初始化完成后提交 ListToolsRequest，request id=1。
- 05:47:48.519 UTC：streamable_http_client 被取消；上层记录 MCP server startup failed / timed out awaiting tools/list after 30s。
- 同进程 node_repl、cua_repl 的 ListToolsRequest 收到响应，本地客户端事件处理没有整体停滞。

这是应用连接器工具目录 HTTP 请求未在启动期限内完成；不是前端计时器，也不是新会话创建 RPC 超时。当前证据不能区分远端服务处理缓慢与中间网络链路丢失响应，不能声称已经确定服务端具体故障或修复完成。

## 排除与旁证

- 专用 launchd 引擎没有代理环境变量；终端存在代理。无代理和显式代理两组均复现 tools/list 超时，所以不能把缺少代理认定为唯一根因。
- 不带鉴权的 curl：直连 chatgpt.com/backend-api/ps/mcp 在 TLS 握手超时；代理可返回 HTTP 451，正文 no_biscuit_no_service。此请求不是 Codex 实际鉴权请求，不能用该 451 认定账号或地区限制。
- 实际 Codex 测试能够收到 plugin-runtime 的 MCP 初始化信息，随后工具目录请求超时；没有在这几次测试中发现 401/token_revoked。旧日志 10 月 17 日存在 token_revoked，但不能作为本次根因。
- 当天桌面日志也出现过 codex_apps 初始化响应 id 不匹配，并有之后约 20–23 秒启动成功的记录。说明故障并非仅见于网页入口，但历史不同错误不能混为同一个根因。
- 正式专用引擎同时持续记录模型目录刷新超时，是网络/上游链路异常的旁证，不足以证明两个请求同源故障。

## 边界与后续

未改写登录凭据、代理配置、全局 Codex 配置或正式 release；未重启正式网页/目标引擎。测试进程均为本次独立进程，结束后自行终止。一次尝试通过仅设置 mcp_servers.codex_apps.startup_timeout_sec 调整测试超时被配置校验拒绝（invalid transport），没有写入配置文件，不作为有效对照。

继续定责需要带请求关联信息的 HTTP/服务端诊断或在另一条已确认可用的网络上做同版本同账号对照。不能以增加超时、隐藏错误或关闭应用连接器作为已修复结论。
