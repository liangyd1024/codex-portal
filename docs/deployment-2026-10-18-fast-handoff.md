# 直显交还按钮与短等待验证（2026-10-18）

已部署 `dbb45bd187c898b1d2db2134ad7eb7ebcf796e8c`。备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T042457063267Z.tar.gz.age`。

## 当前效果

“交还桌面端”作为会话顶部的文字按钮直接显示，不再放入省略号菜单。隔离预览和正式入口均验证按钮显示、点击交还、草稿保留；390px 窄屏无横向溢出，按钮高度 44px，键盘 Enter 可触发，结果焦点正确。

正式入口仅操作专用验收会话 `01a14d38-4bb3-7e51-928d-a938dc3801d4`，最终保留在等待释放状态。原目标引擎 PID 仍为 `12387`，本次没有重启目标引擎，未改实际连接配置。截图：`/tmp/rcm-direct-handoff-deployed.png`。

## 短等待发现与实测

[官方配置 schema](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/config.schema.json)列出 `thread_unload_delay_secs`：默认 1800 秒，0 表示立即卸载，需要重启服务器才生效。本机 CLI 二进制中存在该参数。此前仅检查立即卸载 RPC，遗漏此启动配置；30 分钟不是不可调整的固定限制。

以本机 `0.163.0-alpha.10.2` 启动独立测试引擎，传入 `-c thread_unload_delay_secs=2`。实际退订后约 2043ms 卸载，第二个独立引擎成功恢复同一会话；另一测试会话的 `sleep 12` 继续运行并正常完成。现有正式引擎未参与此测试。证据：`/var/folders/1c/tbrgv3gn6xbc_m1_7qyptt9w0000gn/T/rcm-handoff-fast-ff3hrO/result.json`。

## 生效边界

代码支持连接级可选 `threadUnloadDelaySecs`，只在启动对应专用引擎时通过 CLI 传入，不修改 Codex 全局配置。运行时间从 launchctl 的实际运行参数读取，不将未应用的配置显示为已生效。交还状态按真实运行参数显示时间。

建议正式设为 5 秒。尚待用户确认其他网页/远程入口已断开本机连接；还必须检查所有会话、目标、后台命令和队列空闲后才能执行目标引擎维护重启。未获确认前不改等待设置。这个参数作用于该引擎所有无订阅且无活动的会话，也缩短普通断线的恢复宽限，不是只对某一次交还生效。

`npm test` 通过（59 Node + 23 Python），`git diff --check` 通过。专用浏览器与预览服务已关闭，临时证据未批量清理。
