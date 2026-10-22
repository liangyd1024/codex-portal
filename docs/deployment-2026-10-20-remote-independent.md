# 机器 B 独立 RCM 部署验收

日期：2026-10-20（Asia/Shanghai）。

## 部署与配置

- 机器 B 源码目录：`/Users/remote-user/.local/share/RemoteCodexManager/dev`。
- 从 GitHub 拉取 `origin/master`，将干净的开发工作树从历史 `feature/portable-backup` 切换到跟踪 `origin/master` 的 `master`。历史分支顶端 `b8dd1471b1ba92f7f58b9a4c2113651ab8d32be7` 已包含在当前主分支，未删除分支或目录。
- 原正式版本：`0a1f9e2bec42e3f3006fe34df2b60102edc7887d`。
- 新正式版本：`c74b0ca68fc8fc493bac9447c262936ae90cf52e`。
- 使用 `node scripts/install-local.mjs --ref c74b0ca68fc8fc493bac9447c262936ae90cf52e` 安装到不可变 release 目录，通过 launchd 保持后台运行；未执行 `npm install`。
- 保留 `machineId=machine-b` 及 `local`、`peer-machine` 连接 ID，将仓库外 `connections.json` 的 `defaultConnection` 从 `peer-machine` 改为 `local`。部署后本机连接成功，机器 A 连接保持断开。
- 手机地址：[机器 B RCM](https://remote.example.invalid/?host=local)。显式 `host=local` 优先于浏览器历史连接偏好。
- 保留 Tailscale HTTPS Serve 的 `443 → http://127.0.0.1:4318` 转发，没有启用公网 Funnel。
- 没有修改应用代码、Codex 原生配置或数据，也没有重启 Codex 桌面、原生引擎或输出采集器。

## 备份与运行状态

- 改默认连接之前的加密备份：`/Users/remote-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。
- 安装器部署前备份：`/Users/remote-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。
- 安装前空闲检查通过；安装器在备份前和网页重启前再次检查。
- 机器 B 专用引擎 PID 部署前后均为 `51520`；网页服务 PID 从 `39206` 变为 `94997`。
- 手机 CA 和服务端证书 SHA-256 部署前后相同。未撤销既有手机会话。
- 旧网页显示的维护错误是历史状态，检查时 `maintenance.json` 已不存在；没有执行维护恢复命令。
- 正式健康接口返回目标版本及 `machineId=machine-b`，默认连接返回 `local`。

## 验证结果

- 机器 A 对同一提交执行 `npm test`：248 项 Node.js、53 项 Python 测试全部通过。
- 机器 B 的 Node.js 为 `v24.19.0`，环境没有 npm；直接执行 README 对应的 `node --test test/*.test.mjs` 和 `python3 -m unittest discover -s test -p 'test_*.py'`，同样全部通过。
- 测试临时目录按约定保留，没有批量清理。
- 机器 B 执行 `node scripts/check-mobile.mjs --tailscale` 通过：可信 TLS、登录页、未配对 API 拒绝、配对登录、认证后读取、退出及退出后拒绝。
- 从 机器 A 使用 `curl --noproxy '*' --resolve remote.example.invalid:443:192.0.2.2` 验证对 机器 B 的 HTTPS 访问：HTTP 200，TLS 校验结果为 0。该检查显式指定了域名对应的 Tailscale IP，不代表 机器 A 默认 DNS 已正常。
- 通过 机器 B 正式 RCM 本机连接创建独立测试会话 `[RCM 验收] 机器 B 独立部署 2026-10-20`，使用目标原生项目 `/Users/remote-user/Documents/Codex`。会话 ID：`REDACTED-ID`；轮次 ID：`REDACTED-ID`。
- 原生轮次状态为 `completed`、无错误，原始助手回复为“机器 B 本机 RCM 收发验证通过。”仅对该独立测试会话发送消息，未对既有工作会话发送或中断任务。

## 未验证项

- 机器 A 默认网络下的域名访问失败；ego-browser 实际打开手机地址返回 `ERR_CONNECTION_CLOSED`。未修改浏览器代理、系统 DNS 或安全检查来绕过问题。
- 本次桌面和 390px 布局、键盘及焦点检查未完成，不能标为通过。本次没有 UI 代码变更。
- 尚未在实体手机上操作配对，也未验证手机的 Tailscale DNS。手机需连接同一 Tailscale 网络，机器 B 需保持开机、联网且未休眠。
- 测试用配对会话已退出；交付配对码在验收结束时单独生成，凭据不记录到仓库。
