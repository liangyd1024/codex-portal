# Remote Codex Manager

用本机网页管理本机和远程 Codex。两台机器各有独立的管理器数据库，连接通过 SSH 复用目标机的专用 Codex 服务。源码最初直接从 Ally 当前安装目录建立 Git 基线。许可证为 Apache 2.0。

同一会话同一时间只从一个入口操作，由使用者人工约定。本项目没有跨入口控制锁；`turn_owners` 仅用于输出采集归属。

## 配置与运行

需要 macOS、Node.js 22+、Python 3、Git、age。上传和下载 Release 附件还需要已登录的 GitHub CLI (`gh`)。从官方发行渠道安装工具。

将 `config/connections.example.json` 按本机情况填写为：

```text
~/Library/Application Support/RemoteCodexManager/connections.json
```

实际配置置于仓库外，权限为 `600`。`machineId` 必须稳定；连接的 `id` 用于状态文件、`?host=` 路由及浏览器缓存，后续不要随意修改。Ally 保留 `local`（Ally）和 `work-mac`（Marco）；Marco 使用 `local`（Marco）和 `ally`（Ally）。`alias` 只负责展示。

每个连接需设置真实用户名、HOME、Codex 二进制路径；SSH 连接另需地址、端口和本机私钥路径。私钥不复制到另一台机器、不进入备份。双方主机公钥必须事先核验。SSH 强制使用配置的密钥和严格主机校验。

开发运行：

```sh
node server.mjs
```

默认网页为 `http://127.0.0.1:4317`，开发预览使用 `RCM_PORT=4327 RCM_MOBILE=0 RCM_STATE_DIR=/absolute/new/preview-state node server.mjs`，独立保存网页状态且不绑定手机端口，避免恢复既有订阅。仍连接同一目标引擎，请仅操作独立测试会话。

## 安装指定版本与回退

开发目录、后台版本目录、运行数据目录各自独立。`git pull` 仅更新开发目录。安装前先提交改动，然后：

```sh
node scripts/install-local.mjs --ref <commit>
```

安装会先检查当前网页入口是否空闲、生成加密备份，再将 Git 提交安装到 `~/Library/Application Support/RemoteCodexManager/releases/<commit>`。旧安装、副本和配置不删除。仅重启本机网页服务；不会停止目标机引擎或更新正在运行的输出采集器。新版本健康检查失败会恢复原网页 plist。要回退，使用同一安装命令指定之前的兼容提交；需要回到最初基线时使用 `install-history/` 中保存的旧 plist。

原始基线仍位于 Ally 的 `~/Library/Application Support/RemoteCodexManager/app`。开发代码位于 Git 工作目录；后台服务运行不可变的 release 目录。

已有手机入口继续使用原 `mobile/config.json` 和证书。安装不会自动创建手机入口；在本机正式工作台的“工作区详情 → 手机访问”点击“开启同一 Wi-Fi 访问”，即可创建证书和二维码，并启动 HTTPS 入口，无需重启网页服务。手机需与 Mac 在同一网络，并安装、信任页面提供的证书后扫码配对。未开启入口时不能生成配对码；失败可重试。开发预览（`RCM_MOBILE=0`）不开放此操作。

局域网配置使用 macOS 自带 OpenSSL 和 CoreImage，不依赖 Tailscale 或额外的 Python 二维码包。已有 Tailscale 入口会保留；新建跨网络入口可展开“Tailscale · 跨网络访问”并点击开启；需要两端登录同一 Tailscale 网络。程序核对 HTTPS Serve 转发成功后才公布地址，发现既有服务冲突或公网 Funnel 会拒绝覆盖。

## 连接和维护

当前打开的会话在网页可见且目标连接可用时，每次读取完成后间隔 5 秒自动同步历史；切回浏览器窗口、标签页或恢复网络时立即检查连接并同步。此行为不受“自动刷新项目和模型”开关控制。浏览桌面端会话和已交还会话只读取历史存储，不重新接管或订阅；同步失败会保留当前内容和草稿并自动重试。

切回桌面继续同一会话时，点击网页会话顶部直接显示的“交还桌面端”按钮。程序只检查并退订当前会话，保留历史和网页草稿；有运行轮次、目标、后台命令、待处理请求或排队输入时会说明原因并拒绝交还，不会替用户停止任务。其他会话及目标服务继续运行。

退订成功后显示“等待引擎释放”，只有核对该会话已从本引擎卸载才提示回桌面重试。引擎默认需要在没有订阅和活动后等待约 30 分钟才卸载；其他网页入口仍在使用同一会话时会继续等待。关闭网页或普通断开连接不代表已经交还。交还意图会持久保存，当前入口刷新、重连或重启后不会自动接管该会话；结果未知时可重试交还，需要回到网页时明确点击“在网页继续”。本功能不通过停止整个目标服务来缩短等待时间。

可为连接配置可选的 `threadUnloadDelaySecs`（0–86400 秒），例如 5 秒。程序仅在启动该连接的专用引擎时传入此设置，不修改 Codex 全局配置，也不自动重启运行中的引擎。应用到已有引擎前必须按维护流程确认其他入口断开，并检查所有会话、目标、后台命令和队列空闲；忙时不得重启。此设置适用于该引擎所有无订阅且无活动的会话，不是单次交还的超时，缩短后普通断线的恢复宽限也会缩短。界面仅按实际运行进程的启动参数显示已生效的时间。

“断开本机连接”只断当前入口，专用服务和任务继续运行。“停止目标服务”会影响所有入口：先结束目标上的任务、目标模式、后台命令和排队输入，并断开其他入口，再明确确认。服务会写入维护标记，兼容版本的入口不会自动重连；这不是跨入口控制锁，旧版入口不识别此标记。

完成维护后在目标机器运行：

```sh
python3 scripts/restore-apply.py resume
```

该命令归档维护标记，随后在网页手动连接。不要用停止服务或恢复命令打断其他入口的任务。

## 加密备份

```sh
python3 scripts/data-backup.py key-init
python3 scripts/data-backup.py backup
python3 scripts/data-backup.py backup --browser /absolute/path/browser-export.json
```

恢复私钥在仓库外的 `~/Library/Application Support/RemoteCodexManager/keys/backup-identity.txt`，权限 `600`。请另存到离线介质；丢失私钥后无法解密。私钥不上传 GitHub。默认备份目录为同级 `backups/`。

备份范围严格限定为：

- `output-journal.sqlite` 的 SQLite Online Backup API 快照，含所有表，并检查完整性。不会复制运行中的 WAL/SHM。
- `web-titles-*.json` 及 subscriptions、handoffs、notices、connection 状态（标题状态可能含消息上下文）。
- 实际连接配置、手机访问配置、配对状态、本项目 CA 和服务端证书/私钥。
- 管理器服务日志，以及显式提供的浏览器导出文件。

排除 Codex 原生数据库、完整聊天文件、Codex 登录文件、SSH 私钥、其他项目或技能凭据、Cookie、socket 和临时文件。输出日志和浏览器详情缓存可能包含已显示过的会话内容；这是管理器自身数据，不代表完整聊天历史。

每份包包含来源机器、UTC 时间、代码提交、格式版本、文件大小、SHA-256、数据库表和缺失项清单。age 加密包超过 1 GiB 时生成分卷，索引记录顺序及校验值；原加密包保留。无定时任务，不自动删除历史备份。

```sh
python3 scripts/data-backup.py publish /absolute/path/backup.age.index.json --repo OWNER/remote-codex-manager --tag backup-MACHINE-TIME
python3 scripts/data-backup.py download --repo OWNER/remote-codex-manager --tag backup-MACHINE-TIME --destination /absolute/new/download-directory
```

上传前强制核验仓库为私有。普通 Git 克隆不会下载 Release 数据。上传同名附件会报错，不覆盖历史附件。

## 浏览器数据

在网页右侧“设置 → 浏览器数据备份”导出或导入。范围为当前 origin 的本应用 `rcm.*` 设置、当前标签页 sessionStorage（草稿、视图、输出位置、展开状态）及 `rcm.recovery.v2` IndexedDB 详情缓存。导出前会刷新当前草稿状态；不读取 Cookie。

导出文件记录时间及覆盖范围。其他浏览器、其他标签页和不支持的旧缓存库明确标记为未包含；请分别导出。文件含草稿与缓存内容，交给 `backup --browser` 加密保存。导入前核对来源机器和每个连接指向的目标；不匹配时拒绝。导入合并本应用数据，恢复的缓存不会获得会话控制权，也不会代替网络最新状态。

## 恢复

先下载，解密、校验并在一个不存在的新目录中验证：

```sh
python3 scripts/data-backup.py restore /absolute/path/backup.age.index.json --identity /absolute/path/backup-identity.txt --machine MACHINE --destination /absolute/new/restore-directory
```

这一步不改实时数据。错误密钥、错误来源机器、损坏文件、路径越界或不兼容格式在覆盖前拒绝。不支持自动把 Ally 数据覆盖到 Marco。验证目录是权限受限的明文数据，使用后按你的文件管理规则手动清理。

确需原地恢复时，先结束任务并断开两台网页的全部连接，再在目标机器运行：

```sh
python3 scripts/restore-apply.py apply /absolute/restore-directory --entrances-disconnected
```

程序再次校验文件和本机身份，读取专用服务确认空闲，生成恢复前备份，进入维护模式，再停止本项目网页和专用服务。当前文件、WAL/SHM 均移动到 `restore-history/` 保留；不执行批量删除。替换失败时恢复旧文件和服务。恢复后关闭自动连接、撤销手机配对并保留证书；浏览器数据需另行导入。Codex 原生数据不会迁移。

## 验证

```sh
node --test test/*.test.mjs
python3 -m unittest discover -s test -p 'test_*.py'
```

测试覆盖可配置连接路由、CSRF/Origin 防护、普通断开语义、维护确认、浏览器来源限制、并发 SQLite 备份、隔离恢复、错误密钥、损坏、错误机器、版本、路径越界、校验失败、恢复失败回退和手机配对撤销。测试只使用独立的临时目录；为遵守不批量删除的约束，测试目录保留并输出路径，需手动清理。

参考：[SQLite Online Backup API](https://www.sqlite.org/backup.html)、[age](https://github.com/FiloSottile/age)、[GitHub 大文件说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)。

实际部署版本、测试结果和最终备份位置见 [2026-10-18 双机验收记录](docs/verification-2026-10-18.md)。
