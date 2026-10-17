# 双机部署与验收记录

验收日期：2026-10-18（Asia/Shanghai）。双机部署代码：`0a1f9e2bec42e3f3006fe34df2b60102edc7887d`。

## 仓库和运行位置

私有仓库：https://github.com/liangyd1024/remote-codex-manager 。许可证：Apache 2.0。

Git 基线 `c651501` 直接建立于 Ally 原安装目录。原源码目录保持干净，没有覆盖并行开发者的修改。最初手工复制到 Marco 的文件已按授权清理；当前 Marco 开发目录来自正式 Git 克隆。

| 机器 | 开发目录 | 网页 | 连接 ID |
| --- | --- | --- | --- |
| Ally | `/Users/ally/.local/share/RemoteCodexManager/dev` | 本机 `http://127.0.0.1:4317` | `local`、`work-mac` |
| Marco | `/Users/marco/Downloads/Codex/remote-codex-manager` | 本机 `http://127.0.0.1:4317` | `local`、`ally` |

两台后台网页均运行各自 `~/Library/Application Support/RemoteCodexManager/releases/0a1f9e2bec42e3f3006fe34df2b60102edc7887d`。网页状态与管理器数据库各自独立。Ally 原 `app` 目录保留基线；更新开发目录不会替换运行版本。

## 测试结果

两机均通过 23 项自动化测试：Node.js 9 项、Python 14 项。

- 通用连接配置和路由、未知连接、错误配置、CSRF/Origin 拒绝、SSH 私钥路径隐藏。
- 普通断开仅关闭本入口，停止服务必须明确确认全部入口已断开。
- 浏览器导入验证来源机器、连接映射、格式版本及应用键范围。
- SQLite 并发写入时的 Online Backup；真实 age 加密和隔离恢复。
- 错误密钥、损坏文件、错误机器、越界路径、不兼容版本、校验不符、缺少表及已存在恢复目录均拒绝。
- 模拟恢复失败后原数据库和状态回退；成功恢复后自动连接关闭、手机配对撤销。
- launchd 异步注销等待、注册临时失败重试和有界超时。

真实环境验收结果：

| 项目 | 结果 |
| --- | --- |
| 双向 SSH | 身份与 HOME 正确，使用配置的独立私钥和严格主机校验 |
| 双机模型、项目与历史 | 两机模型各 7 个；Marco 项目 35 个，Ally 项目 3 个 |
| 新建独立验收会话并发送 | Ally 和 Marco 均收到预期回复，轮次正常完成 |
| 正式入口切换 | Marco 本机入口完成一轮后断开；Ally 的远程 Marco 入口继续同一验收会话，前一轮记录保留 |
| 实时事件隔离 | 两次正式测试分别接收 28、26 个事件；另一机器事件流出现该测试线程事件的数量均为 0 |
| 普通断开与部署 | 专用 Codex 引擎 PID 保持 Marco `12387`、Ally `7202`；没有停止引擎或既有输出采集器 |
| 浏览器数据 | ego-lite 实际导出与导入，草稿恢复正确，IndexedDB 详情缓存恢复 1 条；导入不会赋予会话控制权 |
| 安装与回退 | 双机健康接口返回同一代码版本；Marco 故意安装故障历史版本后健康检查失败，自动恢复原版本并重新通过健康检查 |
| Ally 手机入口 | LAN HTTPS 的 CA 校验通过，登录页返回 200；未配对的 API 返回 401；Tailscale 反向代理入口返回登录页 |
| 手机证书 | 现用 CA 和服务端证书 SHA-256 与部署前备份相同 |
| GitHub 恢复链路 | 从私有 Release 下载已上传的 Ally 包，解密后验证 24 个文件，实时数据未变 |
| 仓库检查 | 工作区干净，`git diff --check` 通过；源码未包含运行数据库、实际连接配置、备份包或私钥，常见密钥模式扫描无命中 |

测试只对独立验收会话发送消息。没有接管、发送消息或中断既有工作会话。预览服务和测试端口转发已关闭。测试会话与临时测试数据保留，不执行批量清理。

## 最终加密备份

文件名使用 UTC 时间，因此文件名中的日期为 2026-10-17。

| 来源 | 文件 | 已校验文件数 | 浏览器快照 | Release |
| --- | --- | --- | --- | --- |
| Ally | `ally-20261017T163059664568Z.tar.gz.age` | 25 | 1 | [Ally 最终备份](https://github.com/liangyd1024/remote-codex-manager/releases/tag/backup-ally-final-20261018) |
| Marco | `marco-20261017T163058001325Z.tar.gz.age` | 10 | 1 | [Marco 最终备份](https://github.com/liangyd1024/remote-codex-manager/releases/tag/backup-marco-final-20261018) |

两份包已分别在来源机器的 `restore-staging/final-validation-20261018` 解密、逐文件校验并检查数据库完整性。Release 只包含 age 密文及校验索引。Marco 未配置手机入口，因此其清单将手机文件标为缺失；Ally 未发现当前配对码文件，清单已记录。

恢复私钥的交付副本在 Marco `/Users/marco/RemoteCodexManager-Recovery/`，文件权限均为 600。该目录仍在本机，需要使用者另存到离线介质；私钥没有上传 GitHub。操作命令见仓库 README。

## 验收范围

浏览器备份仅包括本次明确导出的 ego-lite 页面：Ally 预览页面与 Marco 正式页面。其他浏览器、其他标签页和 Cookie 未包含，不能当作完整浏览器备份。

原地恢复和失败回退在隔离测试环境中验证，没有用历史备份覆盖仍在使用的生产数据。手机入口通过实际网络请求和 TLS 校验验证，本次没有在实体手机上操作配对。

没有跨入口控制锁。同一会话仍须人工约定只从一个入口操作。测试结束时 Ally 的 `work-mac` 连接保持断开，Marco 可从本机入口继续验收会话；Ally 的原本机会话保持原入口。
