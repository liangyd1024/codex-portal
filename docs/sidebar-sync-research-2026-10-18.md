# 置灰功能同步通道复核（2026-10-18）

## 结论

对本机 Codex Desktop 26.1013.40934 的桌面主进程、渲染器、随应用分发的 App Tools MCP 服务及目标引擎协议进行复核。桌面确实有管理这些功能的内部服务，也向 Codex 执行器提供管理工具；不能据此推断普通网页服务可以独立、可靠地调用同一服务。

本次没有找到符合当前约束、可直接交付给 Remote Codex Manager 的新增同步通道。因此没有解除置灰、没有增加另一套网页组织状态、没有修改 Codex 数据库或配置，也没有执行身份伪装或复用当前任务的调用上下文。本结论限于所检查的本机版本和通道，并不表示未来版本永远无法支持。

## 逐项实现与限制

| 功能 | 桌面实现依据 | 网页侧结论 |
| --- | --- | --- |
| 自定义分区创建、重命名、删除、项目/会话移入分区 | 主进程 `QF.applySavedCustomSectionCommand` 捕获当前账号及主机连接生命周期，串行执行布局命令，维护账号级分区状态，再通过 transition/reconciliation 同步引擎副本；广播 `persisted-atom-updated` | 单独调用 `threadSection/*` 或 `thread/section/move` 不包含完整布局事务。继续禁用。 |
| 会话移入项目 | 桌面项目服务处理旧项目 ID、显式无项目记录及 `threadAssignmentsMigrated`、`threadAssignmentsReadMigrated`、待迁移记录，再调用 `thread/metadata/update` | 引擎字段更新不能代替尚未完成的桌面归属迁移。不能自动修改迁移标记。继续禁用。 |
| 项目置顶、项目/分区排序、项目内会话排序 | 渲染器使用 `unified-sidebar-project-order-v1`、`unified-sidebar-pinned-order-v1`、`sidebar-project-thread-orders` 等桌面存储；混合排列包含云端和本机对象 | 没有在检查的引擎协议中找到可等价更新全部桌面排列的接口。继续只读。 |
| 分组及全局排序偏好 | 桌面持久化 atom 与共享状态，包括 `flat-project-sidebar-preferences-v1`；由桌面窗口/工具流程更新 | Electron 内部 IPC 不是网页公开 API；不能直接替换文件实现同步。继续只读。 |
| 已读/未读 | 桌面 read-state owner 按 identity、executionHostKey 隔离，生成可退役的 session；接收 `thread-read-state-changed` v3 广播并核对上下文 | 引擎 `thread/readState/update` 不是相同状态。广播本身没有操作接受回执，当前网页也没有可靠的身份会话获取通路。继续禁用，不能把发送成功当作同步成功。 |
| 会话置顶及置顶内排序 | 桌面 pin 服务在启用引擎 pin 数据源时使用 `thread/section/move`，读取原生置顶分区；已有独立会话联动验收 | 保留既有支持。此次未重新执行写入验收。 |

桌面 `list_threads` 本次只读核对返回：项目分组、普通会话按最近更新、置顶按手动顺序，以及 12 个分区条目。没有为了测试而移动业务会话或更改用户排列。

## 核查过的接入方式

### 目标引擎 JSON-RPC

已生成的实际协议包含 `thread/section/move`、`threadSection/list/create/update/delete`、`project/list/read/create/import/update/move/delete`、`thread/readState/update`。方法名称存在不证明具备桌面额外状态的同步语义。此前独立会话测试中“引擎成功、桌面归属/未读未变化”的结果与本次调用链检查一致；此前测试详见 sidebar-parity-2026-10-18.md。

### 随应用分发的 App Tools MCP

文件：`~/.codex/plugins/cache/openai-bundled/codex-app-tools/0.1.6/server.mjs`。

服务从 `CODEX_APP_TOOLS_PIPE_PATH` 获取桌面管道，调用时要求执行器提供 thread metadata，转发 callerSource、hostId、threadId、turnId、callId。主进程管道还包含平台/构建相关的 peer authorization。当前助手拥有这些工具，不等于独立运行的 Remote Codex Manager 服务已经具有对应上下文或授权接入契约。

没有把当前任务 ID、环境注入值或任意构造的身份接入生产服务；没有尝试绕过 peer authorization。未发现独立网页客户端的受支持注册与能力协商流程。

### 本地协调 IPC

共享模块的 IpcClient 支持 initialize、request/discovery、broadcast；用于线程 owner/follower 协作、队列、归档通知及 read-state 广播。读状态消息需要当前身份和执行主机上下文，桌面会在账号/主机变化后退役旧 session。该通道不提供已核实的完整侧边栏布局管理服务；仅把消息送入 socket 无法作为可靠同步的证明。

### Electron 窗口 IPC

`shared-object-set`、`persisted-atom-updated` 等属于桌面 webContents 与主进程内部通信。没有通过注入渲染器脚本、开启远程调试或自动点击桌面来伪装成后端 API；这些方式缺少可交付的隔离、生命周期和错误确认契约。

## 可复核证据

本机 app.asar 只读检查，未修改或重新打包应用：

- `.vite/build/main-CLu1A25j.js` SHA-256：`8aedee047ec0a078e65b24dc917c64ad544220395e773feb6740f4447008a495`
- `.vite/build/src-DsLVGakC.js` SHA-256：`28a0918f01c50b0eb17676e894998ad7182f119d978adf0467ccaac3583f259c`
- 渲染器：`webview/assets/app-initial-90eb42395b7d.js`。

混淆后的符号名仅用于本版本定位，不作为产品依赖。

## 验证与部署决定

- 在侧边栏工作树 `2e697d1` 上执行 `npm test`：32 项 Node、23 项 Python 测试通过。其中覆盖禁用能力不写入、账号/版本冲突、超时不重放及独立读状态保护。该结果是侧边栏分支回归，不能冒充已安装版本的全量验证。
- 本机 `http://127.0.0.1:4317/api/version` 响应正常，实际已安装版本为 `cce024d592ebbf021f96cce0fa739fbd9e4433fe`，包含后续会话交接改动。
- 本轮只新增研究报告，没有可发布的功能改动，因此未重启、未覆盖现有安装、未生成新部署备份，也未做浏览器 UI 变更验收。既有安装备份为 `~/Library/Application Support/RemoteCodexManager/backups/marco-20261018T041423798953Z.tar.gz.age`。

下一次解除置灰必须先取得面向服务的真实桌面接入方式，具有账号/主机上下文、明确操作回执和版本/能力检查，再用独立测试会话核对桌面实际结果、断线与超时行为。无需、也不应通过改写数据库或桌面配置来补足接口语义。
