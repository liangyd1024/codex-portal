# 会话 @ 引用接入调研

调研基线：`master`，`037dca6054db4f0f11b3f88e2e872a99ec813e7b`。

## 需求和结论

用户要求同时支持已有桌面会话和网页新建会话。不能只完成候选列表便标记为支持。

桌面原生支持会话引用。RCM 当前普通会话执行通道尚未具备同等能力。本次没有上线功能，也没有修改原生配置、安装文件或业务数据。

## 已核实的原生行为

- 用户截图确认 `@` 候选可包含会话。
- 只读检查当前桌面安装包的 `app-shared-2eda13eb7044.js`。会话路径为 `thread://<threadId>`，可附带 `hostId` 查询参数。这个路径不等于插件引用协议。
- `app-initial-c95ddb62696e.js` 的 `Qln` 将 `threadReferences` 序列化为引用上下文，明确要求模型对每个引用调用 `read_thread`，并把标题和内容视为不可信上下文。它不直接把整段历史复制进消息。
- 同一模块的 `g3t` 检查动态工具或 Codex App MCP 的启用工具列表是否包含 `read_thread`。新建时要求引用但没有此能力，会报 `thread_references_unavailable`。
- `read_thread` 原生工具支持会话 ID、可选主机 ID、历史游标及有限轮次数量。它由桌面工具执行链提供，并非仅有 `thread/read` RPC 就等于模型拥有该工具。
- 从连接配置读取本机二进制，导出实验 TypeScript 协议。`UserInput` 有通用 `mention`，但没有专用会话引用类型；不能据此推定 `mention.path=thread://...` 会执行桌面的引用流程。

官方 [Codex 平台介绍](https://developers.openai.com/blog/codex-as-a-platform)说明 app-server 可创建会话、启动轮次并处理工具和审批，但没有在该页面建立桌面会话引用工具对第三方入口的接入契约。本次具体引用结论来自本机只读核实。

## 运行时检查

使用连接配置指定的二进制启动独立 stdio app-server，使用独立客户端名称。通过原生 `thread/start` 创建 `ephemeral:true` 的测试会话。未发送模型轮次，没有接管既有会话。

对该临时会话调用 `mcpServerStatus/list`，限定 `serverName:codex_app`，结果为：

```json
{"name":"codex_app","runtimeStatus":"disabled","toolsError":null,"toolNames":[]}
```

探测完成后仅退出本次独立探测进程。这个结果证明按本次普通启动路径建立的临时会话没有获得该 MCP 工具；不代表所有桌面会话或 SSH 目标均不支持。未对正式引擎做配置修改或重启。

## 接入阻塞

- RCM 普通会话通过专用 app-server 执行。当前创建代码未接入桌面的 `read_thread` 动态工具及其执行者。
- 已有 `desktop-session.py` 使用原生 owner discovery 和 follower start-turn，前期只验证了桌面已托管管理会话的发送。不能把它视为网页新建完整桌面会话的证明。
- 桌面工具 MCP 需要原生提供的工具服务连接。只读检查内置 `codex-app-tools` 服务及桌面主进程，确认工具管道有调用方校验；远程桌面 MCP 还有临时 Bearer 身份验证。没有调用受保护的工具管道、提取或复用桌面身份凭据、伪造调用身份。
- 本次工具清单没有可供 RCM 使用的原生桌面创建会话接口。内部 `create_thread` 实现存在，不代表已获得可用的外部调用入口。

## 后续验收条件

1. 验证可用的原生桌面会话创建或工具接入契约，保留调用方身份校验。
2. 在专用测试会话完成原生 `read_thread` 调用。网页新建会话与桌面已有会话分别验证。
3. 再扩展 `@` 候选、同名区分、草稿引用和发送通道。保持插件候选、中文输入法、键盘操作、请求失效及连接隔离。
4. 验证桌面及 390px 窄屏，运行相关回归与 `npm test`，再按安装流程部署。

当前未实施 UI，不宣称浏览器验证、模型读取引用、SSH 引用或正式部署通过。纯调研文档仅检查链接与 `git diff --check`。
