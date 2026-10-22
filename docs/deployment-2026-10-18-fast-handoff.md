# 直显交还按钮与短等待验证（2026-10-18）

已部署 `dbb45bd187c898b1d2db2134ad7eb7ebcf796e8c`。备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。

## 当前效果

“交还桌面端”作为会话顶部的文字按钮直接显示，不再放入省略号菜单。隔离预览和正式入口均验证按钮显示、点击交还、草稿保留；390px 窄屏无横向溢出，按钮高度 44px，键盘 Enter 可触发，结果焦点正确。

正式入口仅操作专用验收会话 `REDACTED-ID`，最终保留在等待释放状态。原目标引擎 PID 仍为 `12387`，本次没有重启目标引擎，未改实际连接配置。截图：`/tmp/rcm-direct-handoff-deployed.png`。

## 短等待发现与实测

[官方配置 schema](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/config.schema.json)列出 `thread_unload_delay_secs`：默认 1800 秒，0 表示立即卸载，需要重启服务器才生效。本机 CLI 二进制中存在该参数。此前仅检查立即卸载 RPC，遗漏此启动配置；30 分钟不是不可调整的固定限制。

以本机 `0.163.0-alpha.10.2` 启动独立测试引擎，传入 `-c thread_unload_delay_secs=2`。实际退订后约 2043ms 卸载，第二个独立引擎成功恢复同一会话；另一测试会话的 `sleep 12` 继续运行并正常完成。现有正式引擎未参与此测试。证据：`/var/folders/1c/tbrgv3gn6xbc_m1_7qyptt9w0000gn/T/rcm-handoff-fast-ff3hrO/result.json`。

## 生效边界

代码支持连接级可选 `threadUnloadDelaySecs`，只在启动对应专用引擎时通过 CLI 传入，不修改 Codex 全局配置。运行时间从 launchctl 的实际运行参数读取，不将未应用的配置显示为已生效。交还状态按真实运行参数显示时间。

正式已设为 5 秒。用户确认其他网页/远程入口已断开后，分页检查全部已加载的 2 个会话，确认没有活动会话、目标、后台命令或排队输入；既有维护接口再次检查通过后，仅重启本机管理器专用引擎。这个参数作用于该引擎所有无订阅且无活动的会话，也缩短普通断线的恢复宽限，不是只对某一次交还生效。

`npm test` 通过（59 Node + 23 Python），`git diff --check` 通过。专用浏览器与预览服务已关闭，临时证据未批量清理。

## 正式激活与验收

2026-10-18 12:29（北京时间）将本机连接 `threadUnloadDelaySecs` 设为 5，沿用 `dbb45bd187c898b1d2db2134ad7eb7ebcf796e8c` 安装流程重载网页服务。修改前备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`；安装备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。专用引擎 PID 从 12387 变为 26281，运行参数确认等待为 5 秒。未停止桌面应用或远程 机器 B 服务。

使用 ego-browser 在正式入口重新接管专用验收会话后，点击直接显示的“交还桌面端”按钮，6355ms 后页面显示释放完成，草稿保持不变。接管操作尚未完成时首次交还被安全检查拒绝；完成后重试通过。最终只读检查引擎已加载会话为 0，原用户验收会话保持 released，未自动接管。截图：`/tmp/rcm-five-second-handoff.png`。本次没有在桌面 UI 中发送消息；跨引擎恢复能力沿用上述独立引擎实测证据。

已有 3 条找不到 rollout 的旧订阅在重连时继续报错，未修改或删除；连接和专用验收均成功。本次仅修改运行配置及验收记录，没有新增应用代码，沿用已通过的代码测试。

## 机器 B 正式激活与验收

2026-10-18 12:56（北京时间），用户确认其他入口已断开后，核验 机器 B 身份并分页检查全部已加载会话：1 个会话空闲，无活动目标、后台命令和排队输入；切换前复查及现有维护释放检查均通过。仅重启 机器 B 的管理器专用 Codex app-server，PID 7202 → 51520。实际启动参数确认 `thread_unload_delay_secs=5`，本机 机器 A 引擎 PID 保持 26281。

配置备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。安装备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。远程原启动配置保留在 `/Users/remote-user/Library/LaunchAgents/local.remote-codex-manager.app-server.plist.before-five-second-20261018`。沿用正式版本 `dbb45bd187c898b1d2db2134ad7eb7ebcf796e8c` 重载网页配置，未修改应用代码。

创建专用空白测试会话 `REDACTED-ID`（RCM 机器 B 五秒交还验收 20261018），使用 ego-browser 确认文字按钮直接可见、可点击；点击后 5403ms 页面显示释放完成，草稿保留。截图 `/tmp/rcm-machine-b-five-second-handoff.png`。最终实际引擎已加载会话 0，测试交还状态 released，两个连接均无受控会话及待处理请求。未向原有会话发送消息，未在 机器 B 桌面 UI 中验证续聊；未将此项标为通过。浏览器验收空间已关闭。
